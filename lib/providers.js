import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { fail } from "./validation.js";
export function createMailer({
  key = process.env.RESEND_API_KEY,
  from = process.env.EMAIL_FROM,
  appURL = process.env.APP_URL,
  fetcher = fetch,
} = {}) {
  return {
    configured: Boolean(key && from && appURL),
    async sendRecovery(address, token) {
      if (!key || !from || !appURL)
        fail(
          503,
          "Password recovery requires the club to configure email delivery.",
        );
      let base;
      try {
        base = new URL(appURL);
        if (base.protocol !== "https:") throw Error();
      } catch {
        fail(503, "Configure a public HTTPS APP_URL for recovery.");
      }
      const url = new URL("/", base);
      url.searchParams.set("reset", token);
      let res;
      try {
        res = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [address],
            subject: "Reset your ApexLinks password",
            text: `Reset your ApexLinks password using this single-use link within 30 minutes:\n${url}\nIf you did not request this, ignore this email.`,
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        fail(502, "Email delivery is temporarily unavailable.");
      }
      if (!res.ok)
        fail(
          502,
          "The email provider did not accept the message. Check the sender configuration.",
        );
    },
  };
}
export function createPayments(
  db,
  {
    key = process.env.STRIPE_SECRET_KEY,
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET,
    appURL = process.env.APP_URL,
    fetcher = fetch,
  } = {},
) {
  const configured = Boolean(key && webhookSecret && appURL);
  return {
    configured,
    async checkout(orgId, invoiceId) {
      if (!configured) fail(503, "Stripe checkout is not configured.");
      let base;
      try {
        base = new URL(appURL);
        if (base.protocol !== "https:") throw Error();
      } catch {
        fail(503, "Configure a public HTTPS APP_URL for checkout.");
      }
      const org = db.prepare("SELECT state FROM orgs WHERE id=?").get(orgId),
        s = JSON.parse(org.state),
        invoice = s.invoices.find((i) => i.id === invoiceId);
      if (!invoice || invoice.status !== "Unpaid" || invoice.amount < 50)
        fail(409, "Checkout requires an unpaid invoice of at least £0.50.");
      let payment = db
        .prepare("SELECT * FROM payments WHERE org_id=? AND invoice_id=?")
        .get(orgId, invoiceId);
      if (payment?.status === "Paid")
        fail(409, "This invoice is already paid.");
      if (
        payment &&
        ["Open", "Creating"].includes(payment.status) &&
        payment.expires <= Date.now()
      )
        fail(
          409,
          "Reconcile the previous checkout status before starting a new payment.",
        );
      if (payment?.url && payment.expires > Date.now())
        return { url: payment.url };
      const attempt =
        payment && payment.status !== "Expired" && payment.expires > Date.now()
          ? payment.attempt
          : randomUUID();
      db.prepare(
        "INSERT INTO payments VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,invoice_id) DO UPDATE SET attempt=excluded.attempt,status=excluded.status,url=excluded.url,expires=excluded.expires,session_id=excluded.session_id",
      ).run(
        orgId,
        invoiceId,
        attempt,
        "Creating",
        "",
        Date.now() + 86400000,
        "",
      );
      const body = new URLSearchParams({
        mode: "payment",
        "line_items[0][price_data][currency]": "gbp",
        "line_items[0][price_data][unit_amount]": String(invoice.amount),
        "line_items[0][price_data][product_data][name]": invoice.description,
        "line_items[0][quantity]": "1",
        "payment_method_types[0]": "card",
        success_url: new URL("/?payment=return", base).href,
        cancel_url: new URL("/?payment=cancelled", base).href,
        "metadata[orgId]": orgId,
        "metadata[invoiceId]": invoiceId,
        "metadata[attempt]": attempt,
      });
      let res;
      try {
        res = await fetcher("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": `apex:${orgId}:${invoiceId}:${attempt}`,
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        fail(
          502,
          "Stripe is unavailable. Retrying uses the same payment attempt.",
        );
      }
      if (!res.ok) {
        db.prepare(
          "UPDATE payments SET status='Failed' WHERE org_id=? AND invoice_id=? AND attempt=?",
        ).run(orgId, invoiceId, attempt);
        fail(502, "Stripe rejected checkout. Check the payment configuration.");
      }
      const session = await res.json();
      let url;
      try {
        url = new URL(session.url);
        if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
          throw Error();
      } catch {
        fail(502, "Stripe returned an invalid checkout URL.");
      }
      db.prepare(
        "UPDATE payments SET status=?,url=?,expires=?,session_id=? WHERE org_id=? AND invoice_id=? AND attempt=? AND status<>'Paid'",
      ).run(
        "Open",
        url.href,
        session.expires_at * 1000,
        session.id,
        orgId,
        invoiceId,
        attempt,
      );
      return { url: url.href };
    },
    async reconcile(orgId, invoiceId) {
      if (!configured) fail(503, "Stripe is not configured.");
      const payment = db
        .prepare("SELECT * FROM payments WHERE org_id=? AND invoice_id=?")
        .get(orgId, invoiceId);
      if (!payment) return { message: "No online checkout exists." };
      if (payment.status === "Paid")
        return { message: "Payment already recorded." };
      if (!payment.session_id)
        fail(
          409,
          "Retry checkout to recover the original payment attempt before reconciling.",
        );
      let res;
      try {
        res = await fetcher(
          "https://api.stripe.com/v1/checkout/sessions/" +
            encodeURIComponent(payment.session_id),
          {
            headers: { Authorization: "Bearer " + key },
            signal: AbortSignal.timeout(10000),
          },
        );
      } catch {
        fail(502, "Stripe status is temporarily unavailable.");
      }
      if (!res.ok) fail(502, "Could not verify the Stripe checkout status.");
      const session = await res.json();
      if (session.id !== payment.session_id)
        fail(502, "Unexpected payment status response.");
      if (session.status === "expired" && session.payment_status === "unpaid") {
        db.prepare(
          "UPDATE payments SET status='Expired',url='' WHERE org_id=? AND invoice_id=? AND attempt=?",
        ).run(orgId, invoiceId, payment.attempt);
        return {
          message:
            "Checkout expiry verified. An external payment may now be recorded, or a new checkout started.",
        };
      }
      return {
        message:
          session.payment_status === "paid"
            ? "Stripe reports payment received. Waiting for the verified webhook."
            : "Checkout is still active. Complete it or expire it in Stripe before recording an external payment.",
      };
    },
    webhook(raw, signature) {
      if (!configured) fail(503, "Stripe webhooks are not configured.");
      const parts = String(signature || "")
          .split(",")
          .map((x) => x.split("=")),
        stamp = parts.find((x) => x[0] === "t")?.[1],
        expected = createHmac("sha256", webhookSecret)
          .update(stamp + ".")
          .update(raw)
          .digest();
      const valid = parts
        .filter((x) => x[0] === "v1")
        .some((x) => {
          if (!/^[a-f0-9]{64}$/i.test(x[1] || "")) return false;
          return timingSafeEqual(expected, Buffer.from(x[1], "hex"));
        });
      if (
        !valid ||
        !/^\d+$/.test(stamp || "") ||
        Math.abs(Date.now() / 1000 - Number(stamp)) > 300
      )
        fail(400, "Invalid webhook signature.");
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        fail(400, "Invalid webhook body.");
      }
      if (typeof event.id !== "string") fail(400, "Missing webhook ID.");
      if (db.prepare("SELECT id FROM webhooks WHERE id=?").get(event.id))
        return { received: true };
      if (
        ![
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
        ].includes(event.type) ||
        event.data?.object?.payment_status !== "paid"
      )
        return { received: true };
      const session = event.data.object,
        { orgId, invoiceId, attempt } = session.metadata || {};
      if (!orgId || !invoiceId || !attempt)
        fail(400, "Missing payment metadata.");
      db.exec("BEGIN IMMEDIATE");
      try {
        const org = db.prepare("SELECT state FROM orgs WHERE id=?").get(orgId),
          payment = db
            .prepare("SELECT * FROM payments WHERE org_id=? AND invoice_id=?")
            .get(orgId, invoiceId);
        if (!org || !payment || payment.attempt !== attempt)
          fail(400, "Payment attempt does not match.");
        const s = JSON.parse(org.state),
          invoice = s.invoices.find((i) => i.id === invoiceId);
        if (
          !invoice ||
          invoice.amount !== session.amount_total ||
          session.currency !== "gbp" ||
          (payment.session_id && payment.session_id !== session.id)
        )
          fail(
            400,
            "Payment amount, currency, or session does not match the invoice.",
          );
        if (invoice.status === "Void")
          fail(
            409,
            "Payment received for a void invoice. Review the payment in Stripe.",
          );
        if (invoice.status !== "Paid") {
          invoice.status = "Paid";
          invoice.reference =
            "Stripe " + (session.payment_intent || session.id);
          invoice.paidAt = new Date().toISOString();
          invoice.recordedBy = "Stripe verified webhook";
          s.version++;
          s.audit.unshift({
            id: randomUUID(),
            actor: "Stripe",
            action: "Verified invoice payment " + invoice.id,
            time: new Date().toISOString(),
          });
          db.prepare("UPDATE orgs SET state=? WHERE id=?").run(
            JSON.stringify(s),
            orgId,
          );
        }
        db.prepare(
          "UPDATE payments SET status=? WHERE org_id=? AND invoice_id=?",
        ).run("Paid", orgId, invoiceId);
        db.prepare("INSERT INTO webhooks VALUES(?)").run(event.id);
        db.exec("COMMIT");
        return { received: true };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
