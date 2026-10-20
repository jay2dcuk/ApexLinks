import { randomUUID } from "node:crypto";
import { fail, email } from "./validation.js";
const liveStatuses = [
  "Creating",
  "Checkout",
  "Awaiting payment",
  "Active",
  "Past due",
];
const objectId = (value) =>
  typeof value === "string" ? value : value?.id || "";
const isoDate = (seconds) =>
  new Date(seconds * 1000).toISOString().slice(0, 10);
export function createBilling(
  db,
  { key, appURL, fetcher = fetch, configured },
) {
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const get = (orgId, id) => {
    if (typeof orgId !== "string" || typeof id !== "string")
      fail(400, "Missing membership identifiers.");
    const row = db
      .prepare("SELECT * FROM billing WHERE org_id=? AND id=?")
      .get(orgId, id);
    if (!row) fail(404, "Online membership not found.");
    return row;
  };
  const state = (orgId) =>
    JSON.parse(
      db.prepare("SELECT state FROM orgs WHERE id=?").get(orgId).state,
    );
  const save = (orgId, s, actor, action) => {
    s.version++;
    s.audit.unshift({
      id: randomUUID(),
      actor,
      action,
      time: new Date().toISOString(),
    });
    s.audit = s.audit.slice(0, 1000);
    db.prepare("UPDATE orgs SET state=? WHERE id=?").run(
      JSON.stringify(s),
      orgId,
    );
  };
  const baseURL = () => {
    try {
      const base = new URL(appURL);
      if (base.protocol !== "https:") throw Error();
      return base;
    } catch {
      fail(503, "Configure a public HTTPS APP_URL for membership billing.");
    }
  };
  async function stripe(path, body, idempotencyKey) {
    if (!configured) fail(503, "Stripe membership billing is not configured.");
    let response;
    try {
      response = await fetcher("https://api.stripe.com/v1/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + key,
          "Stripe-Version": "2024-06-20",
          ...(body
            ? {
                "Content-Type": "application/x-www-form-urlencoded",
                "Idempotency-Key": idempotencyKey,
              }
            : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      fail(
        502,
        "Stripe response is unconfirmed. Retry the existing membership attempt.",
      );
    }
    if (!response.ok) {
      const error = new Error(
        "Stripe did not confirm this membership request.",
      );
      error.status = 502;
      error.definitive =
        response.status >= 400 &&
        response.status < 500 &&
        ![409, 429].includes(response.status);
      throw error;
    }
    return response.json();
  }
  function bind(row, subscriptionId, customerId) {
    if (
      !/^sub_[A-Za-z0-9_]+$/.test(subscriptionId) ||
      !/^cus_[A-Za-z0-9_]+$/.test(customerId) ||
      (row.subscription_id && row.subscription_id !== subscriptionId) ||
      (row.customer_id && row.customer_id !== customerId)
    )
      fail(400, "Subscription or customer does not match this membership.");
    db.prepare(
      "UPDATE billing SET subscription_id=?,customer_id=? WHERE id=?",
    ).run(subscriptionId, customerId, row.id);
  }
  function acknowledge(event) {
    db.prepare("INSERT OR IGNORE INTO webhooks VALUES(?)").run(event.id);
    return { received: true };
  }
  return {
    list(orgId) {
      return db
        .prepare(
          "SELECT id,player_id AS playerId,plan_id AS planId,plan_name AS planName,amount,status,cancel_at_end AS cancelAtEnd FROM billing WHERE org_id=? ORDER BY created DESC",
        )
        .all(orgId);
    },
    get(orgId, id) {
      return this.list(orgId).find((r) => r.id === get(orgId, id).id);
    },
    hasPending(orgId, playerId) {
      return db
        .prepare("SELECT status FROM billing WHERE org_id=? AND player_id=?")
        .all(orgId, playerId)
        .some((r) => liveStatuses.includes(r.status));
    },
    async checkout(orgId, planId, playerId, actor) {
      if (!configured)
        fail(503, "Stripe membership billing is not configured.");
      const base = baseURL(),
        s = state(orgId),
        plan = s.plans.find((p) => p.id === planId),
        player = s.players.find((p) => p.id === playerId);
      if (!plan || !player) fail(404, "Plan or golfer not found.");
      if (
        !Number.isInteger(plan.amount) ||
        plan.amount < 50 ||
        plan.currency !== "GBP"
      )
        fail(409, "Online annual plans require a GBP price of at least £0.50.");
      const address = email(player.email);
      let row = tx(() => {
        const rows = db
            .prepare(
              "SELECT * FROM billing WHERE org_id=? AND player_id=? ORDER BY created DESC",
            )
            .all(orgId, playerId),
          existing = rows.find((r) => liveStatuses.includes(r.status));
        if (existing) {
          if (
            existing.plan_id !== planId ||
            !["Creating", "Checkout"].includes(existing.status)
          )
            fail(
              409,
              "An online membership already exists. Manage it before subscribing again.",
            );
          return existing;
        }
        const fresh = state(orgId),
          today = new Date().toISOString().slice(0, 10);
        if (
          fresh.subscriptions.some(
            (m) =>
              m.playerId === playerId &&
              m.status === "Active" &&
              (m.paidUntil
                ? Date.parse(m.paidUntil) > Date.now()
                : m.end >= today),
          )
        )
          fail(
            409,
            "An active membership already covers this golfer. Resolve it before enabling recurring billing.",
          );
        const id = randomUUID(),
          attempt = randomUUID();
        db.prepare(
          "INSERT INTO billing(id,org_id,player_id,plan_id,plan_name,amount,status,attempt,created,session_id,url,expires,customer_id,subscription_id,cancel_at_end,event_time) VALUES(?,?,?,?,?,?,'Creating',?,?,?,'',0,'',NULL,0,0)",
        ).run(
          id,
          orgId,
          playerId,
          planId,
          plan.name,
          plan.amount,
          attempt,
          Date.now(),
          "",
        );
        save(orgId, fresh, actor, "Started annual membership checkout " + id);
        return get(orgId, id);
      });
      if (row.status === "Checkout") {
        if (row.expires > Date.now() && row.url) return { url: row.url };
        const session = await stripe(
          "checkout/sessions/" + encodeURIComponent(row.session_id),
        );
        if (session.id !== row.session_id)
          fail(502, "Unexpected checkout status response.");
        if (session.status !== "expired" || session.payment_status !== "unpaid")
          fail(
            409,
            "The existing membership checkout must be resolved in Stripe before another can start.",
          );
        tx(() => {
          const current = get(orgId, row.id);
          if (current.status !== "Checkout" || current.subscription_id)
            fail(409, "Membership status changed. Reload before continuing.");
          db.prepare(
            "UPDATE billing SET status='Expired',url='' WHERE id=?",
          ).run(row.id);
          save(
            orgId,
            state(orgId),
            actor,
            "Verified expired membership checkout " + row.id,
          );
        });
        return this.checkout(orgId, planId, playerId, actor);
      }
      if (Date.now() - row.created > 23 * 3600000)
        fail(
          409,
          "This unknown checkout is too old to retry automatically. Review it in Stripe first.",
        );
      const success = new URL("/", base);
      success.searchParams.set("membership", "return");
      const body = new URLSearchParams({
        mode: "subscription",
        success_url: success.href,
        cancel_url: base.href,
        customer_email: address,
        "payment_method_types[0]": "card",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "gbp",
        "line_items[0][price_data][unit_amount]": String(row.amount),
        "line_items[0][price_data][recurring][interval]": "year",
        "line_items[0][price_data][product_data][name]": row.plan_name,
      });
      for (const [name, value] of Object.entries({
        apexMembershipId: row.id,
        orgId,
        attempt: row.attempt,
      })) {
        body.set(`metadata[${name}]`, value);
        body.set(`subscription_data[metadata][${name}]`, value);
      }
      let session;
      try {
        session = await stripe(
          "checkout/sessions",
          body,
          `apex-membership:${row.id}:${row.attempt}`,
        );
      } catch (error) {
        if (error.definitive)
          db.prepare(
            "UPDATE billing SET status='Failed' WHERE id=? AND status='Creating'",
          ).run(row.id);
        throw error;
      }
      let url;
      try {
        url = new URL(session.url);
        if (
          url.protocol !== "https:" ||
          url.hostname !== "checkout.stripe.com" ||
          !/^cs_/.test(session.id) ||
          !Number.isInteger(session.expires_at)
        )
          throw Error();
      } catch {
        fail(502, "Unexpected membership checkout response.");
      }
      db.prepare(
        "UPDATE billing SET status='Checkout',session_id=?,url=?,expires=? WHERE id=? AND status='Creating'",
      ).run(session.id, url.href, session.expires_at * 1000, row.id);
      return { url: url.href };
    },
    async portal(orgId, id) {
      const row = get(orgId, id);
      if (!row.customer_id || !row.subscription_id)
        fail(409, "Complete the membership checkout first.");
      const result = await stripe(
        "billing_portal/sessions",
        new URLSearchParams({
          customer: row.customer_id,
          return_url: new URL("/", baseURL()).href,
        }),
        "apex-portal:" + randomUUID(),
      );
      let url;
      try {
        url = new URL(result.url);
        if (url.protocol !== "https:" || url.hostname !== "billing.stripe.com")
          throw Error();
      } catch {
        fail(502, "Unexpected customer portal URL.");
      }
      return { url: url.href };
    },
    async cancel(orgId, id, actor) {
      const row = get(orgId, id);
      if (!row.subscription_id)
        fail(
          409,
          "Resolve the pending checkout in Stripe before cancelling renewal.",
        );
      if (row.status === "Cancelled" || row.cancel_at_end)
        return { message: "Membership renewal is already stopped." };
      const result = await stripe(
        "subscriptions/" + encodeURIComponent(row.subscription_id),
        new URLSearchParams({ cancel_at_period_end: "true" }),
        // Setting this boolean is naturally idempotent. Use a fresh request key
        // so a cancellation after a portal resumption cannot replay an old result.
        "apex-cancel-renewal:" + randomUUID(),
      );
      if (
        result.id !== row.subscription_id ||
        objectId(result.customer) !== row.customer_id ||
        result.cancel_at_period_end !== true
      )
        fail(502, "Stripe did not confirm renewal cancellation.");
      tx(() => {
        db.prepare("UPDATE billing SET cancel_at_end=1 WHERE id=?").run(id);
        save(
          orgId,
          state(orgId),
          actor,
          "Stopped renewal for membership " + id,
        );
      });
      return {
        message:
          "Renewal cancelled in Stripe. The paid membership period remains available.",
      };
    },
    handles(event) {
      return (
        (["checkout.session.completed", "checkout.session.expired"].includes(
          event.type,
        ) &&
          (event.data?.object?.mode === "subscription" ||
            event.data?.object?.metadata?.apexMembershipId)) ||
        [
          "invoice.paid",
          "invoice.payment_failed",
          "customer.subscription.updated",
          "customer.subscription.deleted",
        ].includes(event.type)
      );
    },
    async webhook(event) {
      let object = event.data?.object;
      if (!object) fail(400, "Missing billing event data.");
      let row, subscriptionId, customerId;
      if (event.type.startsWith("checkout.session.")) {
        const metadata = object.metadata || {};
        if (!metadata.apexMembershipId) return acknowledge(event);
        row = get(metadata.orgId, metadata.apexMembershipId);
        if (
          metadata.attempt !== row.attempt ||
          (row.session_id && row.session_id !== object.id) ||
          object.amount_total !== row.amount ||
          object.currency !== "gbp"
        )
          fail(400, "Membership checkout does not match.");
        if (event.type.endsWith("expired"))
          return tx(() => {
            const current = get(row.org_id, row.id);
            if (
              ["Creating", "Checkout"].includes(current.status) &&
              !current.subscription_id
            ) {
              db.prepare(
                "UPDATE billing SET status='Expired',url='' WHERE id=?",
              ).run(row.id);
              save(
                row.org_id,
                state(row.org_id),
                "Stripe",
                "Membership checkout expired " + row.id,
              );
            }
            return acknowledge(event);
          });
        subscriptionId = objectId(object.subscription);
        customerId = objectId(object.customer);
        return tx(() => {
          const current = get(row.org_id, row.id);
          bind(current, subscriptionId, customerId);
          db.prepare(
            "UPDATE billing SET status=CASE WHEN status IN ('Creating','Checkout') THEN 'Awaiting payment' ELSE status END,session_id=?,url='' WHERE id=?",
          ).run(object.id, row.id);
          save(
            row.org_id,
            state(row.org_id),
            "Stripe",
            "Verified membership checkout " + row.id,
          );
          return acknowledge(event);
        });
      }
      if (event.type.startsWith("customer.subscription.")) {
        subscriptionId = object.id;
        customerId = objectId(object.customer);
        row = db
          .prepare("SELECT * FROM billing WHERE subscription_id=?")
          .get(subscriptionId);
        if (!row) {
          const metadata = object.metadata || {};
          if (!metadata.apexMembershipId) return acknowledge(event);
          row = get(metadata.orgId, metadata.apexMembershipId);
          if (metadata.attempt !== row.attempt)
            fail(400, "Subscription attempt does not match.");
        }
        if (event.type === "customer.subscription.updated") {
          object = await stripe(
            "subscriptions/" + encodeURIComponent(subscriptionId),
          );
          if (
            object.id !== subscriptionId ||
            objectId(object.customer) !== customerId
          )
            fail(400, "Subscription status response does not match.");
        }
        return tx(() => {
          if (db.prepare("SELECT 1 FROM webhooks WHERE id=?").get(event.id))
            return { received: true };
          const current = get(row.org_id, row.id);
          bind(current, subscriptionId, customerId);
          if (
            (event.created || 0) >= current.event_time &&
            current.status !== "Cancelled"
          ) {
            const status =
              event.type.endsWith("deleted") ||
              ["canceled", "incomplete_expired"].includes(object.status)
                ? "Cancelled"
                : ["past_due", "unpaid"].includes(object.status)
                  ? "Past due"
                  : object.status === "active"
                    ? "Active"
                    : "Awaiting payment";
            db.prepare(
              "UPDATE billing SET status=?,cancel_at_end=?,event_time=? WHERE id=?",
            ).run(
              status,
              object.cancel_at_period_end || status === "Cancelled" ? 1 : 0,
              event.created || 0,
              row.id,
            );
            save(
              row.org_id,
              state(row.org_id),
              "Stripe",
              "Membership billing status " + status + ": " + row.id,
            );
          }
          return acknowledge(event);
        });
      }
      subscriptionId = objectId(
        object.subscription ||
          object.parent?.subscription_details?.subscription,
      );
      if (!subscriptionId) return acknowledge(event);
      customerId = objectId(object.customer);
      row = db
        .prepare("SELECT * FROM billing WHERE subscription_id=?")
        .get(subscriptionId);
      if (!row) {
        // Invoice callbacks may precede checkout completion. Resolve through Stripe,
        // rather than trusting an unbound customer/subscription identifier.
        const subscription = await stripe(
          "subscriptions/" + encodeURIComponent(subscriptionId),
        );
        const metadata = subscription.metadata || {};
        if (!metadata.apexMembershipId) return acknowledge(event);
        row = get(metadata.orgId, metadata.apexMembershipId);
        if (
          subscription.id !== subscriptionId ||
          objectId(subscription.customer) !== customerId ||
          metadata.attempt !== row.attempt
        )
          fail(400, "Invoice subscription metadata does not match.");
      }
      return tx(() => {
        if (db.prepare("SELECT 1 FROM webhooks WHERE id=?").get(event.id))
          return { received: true };
        const current = get(row.org_id, row.id);
        bind(current, subscriptionId, customerId);
        if (event.type === "invoice.payment_failed") {
          if (
            db
              .prepare("SELECT 1 FROM billing_invoices WHERE provider_id=?")
              .get(object.id)
          )
            return acknowledge(event);
          if (
            current.status !== "Cancelled" &&
            (event.created || 0) >= current.event_time
          )
            db.prepare(
              "UPDATE billing SET status='Past due',event_time=? WHERE id=?",
            ).run(event.created || 0, row.id);
          const failedState = state(row.org_id);
          if (
            object.amount_due === current.amount &&
            object.currency === "gbp" &&
            !failedState.invoices.some((i) => i.id === "stripe_" + object.id)
          ) {
            failedState.invoices.push({
              id: "stripe_" + object.id,
              playerId: row.player_id,
              description: row.plan_name + " annual membership",
              amount: current.amount,
              currency: "GBP",
              status: "Unpaid",
              reference: "Stripe " + object.id,
              created: new Date().toISOString(),
              billingId: row.id,
            });
          }
          save(
            row.org_id,
            failedState,
            "Stripe",
            "Membership invoice payment failed " + row.id,
          );
          return acknowledge(event);
        }
        if (
          db
            .prepare("SELECT 1 FROM billing_invoices WHERE provider_id=?")
            .get(object.id)
        )
          return acknowledge(event);
        if (
          object.paid !== true ||
          object.status !== "paid" ||
          object.amount_paid !== current.amount ||
          object.amount_due !== current.amount ||
          object.currency !== "gbp"
        )
          fail(
            400,
            "Membership invoice amount or currency does not match the annual plan.",
          );
        const lines = object.lines?.data || [],
          line = lines.find(
            (l) =>
              l.type === "subscription" ||
              l.parent?.subscription_item_details ||
              l.price?.recurring,
          );
        const period = line?.period;
        if (
          !period ||
          !Number.isInteger(period.start) ||
          !Number.isInteger(period.end) ||
          period.end <= period.start ||
          lines.length !== 1 ||
          object.lines?.has_more === true ||
          line.amount !== current.amount ||
          period.end - period.start > 370 * 86400 ||
          period.end - period.start < 360 * 86400
        )
          fail(
            400,
            "Membership invoice must contain one full annual period without adjustments.",
          );
        const s = state(row.org_id),
          player = s.players.find((p) => p.id === row.player_id);
        if (!player) fail(409, "The billed golfer profile is missing.");
        const invoiceId = "stripe_" + object.id,
          intent = objectId(object.payment_intent);
        const invoiceData = {
          id: invoiceId,
          playerId: row.player_id,
          description: row.plan_name + " annual membership",
          amount: current.amount,
          currency: "GBP",
          status: "Paid",
          paymentIntent: intent,
          reference: "Stripe " + (intent || object.id),
          created: new Date().toISOString(),
          paidAt: new Date(
            (object.status_transitions?.paid_at ||
              event.created ||
              Math.floor(Date.now() / 1000)) * 1000,
          ).toISOString(),
          recordedBy: "Stripe verified subscription invoice",
          billingId: row.id,
        };
        const existingInvoice = s.invoices.find((i) => i.id === invoiceId);
        if (existingInvoice && existingInvoice.billingId !== row.id)
          fail(400, "Billing invoice ownership does not match.");
        if (existingInvoice) Object.assign(existingInvoice, invoiceData);
        else s.invoices.push(invoiceData);
        let membership = s.subscriptions.find((m) => m.billingId === row.id);
        const start = isoDate(period.start),
          end = isoDate(period.end - 1);
        if (!membership) {
          membership = {
            id: randomUUID(),
            playerId: row.player_id,
            planId: row.plan_id,
            start,
            end,
            status: "Active",
            billingId: row.id,
            paidFrom: new Date(period.start * 1000).toISOString(),
            paidUntil: new Date(period.end * 1000).toISOString(),
          };
          s.subscriptions.push(membership);
        } else {
          membership.start =
            membership.start < start ? membership.start : start;
          membership.end = membership.end > end ? membership.end : end;
          membership.status = "Active";
          const paidUntil = new Date(period.end * 1000).toISOString();
          const paidFrom = new Date(period.start * 1000).toISOString();
          if (!membership.paidFrom || membership.paidFrom > paidFrom)
            membership.paidFrom = paidFrom;
          if (!membership.paidUntil || membership.paidUntil < paidUntil)
            membership.paidUntil = paidUntil;
        }
        if (intent)
          db.prepare(
            "INSERT INTO payments(org_id,invoice_id,attempt,status,url,expires,session_id) VALUES(?,?,?,'Paid','',0,?)",
          ).run(row.org_id, invoiceId, object.id, object.id);
        db.prepare("INSERT INTO billing_invoices VALUES(?,?,?,?,?)").run(
          object.id,
          row.id,
          invoiceId,
          period.start,
          period.end,
        );
        if (
          current.status !== "Cancelled" &&
          (event.created || 0) >= current.event_time
        )
          db.prepare(
            "UPDATE billing SET status='Active',event_time=? WHERE id=?",
          ).run(event.created || 0, row.id);
        save(
          row.org_id,
          s,
          "Stripe",
          "Verified annual membership payment " + object.id,
        );
        return acknowledge(event);
      });
    },
  };
}
