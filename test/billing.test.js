import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openStore, emptyState } from "../lib/store.js";
import { createPayments } from "../lib/providers.js";
function fixture(fetcher) {
  const db = openStore(":memory:"),
    s = emptyState();
  s.players.push({ id: "p", name: "Golfer", email: "golfer@example.com" });
  s.plans.push({
    id: "plan",
    name: "Annual Club",
    amount: 12000,
    currency: "GBP",
  });
  db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
    "o",
    "Club",
    JSON.stringify(s),
  );
  db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
    "other",
    "Other Club",
    JSON.stringify(s),
  );
  const provider = createPayments(db, {
    key: "test-key",
    webhookSecret: "test-secret",
    appURL: "https://app.example",
    fetcher,
  });
  const state = () =>
    JSON.parse(db.prepare("SELECT state FROM orgs WHERE id='o'").get().state);
  const emit = async (event) => {
    const raw = Buffer.from(JSON.stringify(event)),
      stamp = Math.floor(Date.now() / 1000);
    return provider.webhook(
      raw,
      `t=${stamp},v1=${createHmac("sha256", "test-secret")
        .update(stamp + ".")
        .update(raw)
        .digest("hex")}`,
    );
  };
  return { db, provider, state, emit };
}
const start = Date.parse("2027-01-01T00:00:00Z") / 1000,
  end = Date.parse("2028-01-01T00:00:00Z") / 1000;
const paidInvoice = (
  id = "in_annual",
  periodStart = start,
  periodEnd = end,
) => ({
  id,
  type: "invoice.paid",
  created: periodStart,
  data: {
    object: {
      id,
      subscription: "sub_annual",
      customer: "cus_golfer",
      paid: true,
      status: "paid",
      amount_paid: 12000,
      amount_due: 12000,
      currency: "gbp",
      payment_intent: "pi_annual",
      status_transitions: { paid_at: periodStart },
      lines: {
        data: [
          {
            type: "subscription",
            amount: 12000,
            period: { start: periodStart, end: periodEnd },
          },
        ],
      },
    },
  },
});

test("annual billing resolves invoice-before-checkout, grants only paid periods, deduplicates and retains paid access after cancellation", async () => {
  let metadata,
    subscriptionCalls = 0,
    providerCancel = false;
  const cancelKeys = [];
  const { db, provider, state, emit } = fixture(async (url, opts) => {
    assert.equal(opts.headers["Stripe-Version"], "2024-06-20");
    if (url.endsWith("checkout/sessions")) {
      assert.equal(opts.body.get("mode"), "subscription");
      assert.equal(
        opts.body.get("line_items[0][price_data][recurring][interval]"),
        "year",
      );
      metadata = Object.fromEntries(
        ["apexMembershipId", "orgId", "attempt"].map((k) => [
          k,
          opts.body.get(`subscription_data[metadata][${k}]`),
        ]),
      );
      return {
        ok: true,
        json: async () => ({
          id: "cs_annual",
          url: "https://checkout.stripe.com/c/pay/annual",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      };
    }
    if (url.endsWith("billing_portal/sessions")) {
      assert.equal(opts.body.get("customer"), "cus_golfer");
      return {
        ok: true,
        json: async () => ({
          url: "https://billing.stripe.com/p/session/test",
        }),
      };
    }
    assert.equal(url, "https://api.stripe.com/v1/subscriptions/sub_annual");
    subscriptionCalls++;
    if (opts.method === "POST") {
      providerCancel = true;
      cancelKeys.push(opts.headers["Idempotency-Key"]);
    }
    return {
      ok: true,
      json: async () => ({
        id: "sub_annual",
        customer: "cus_golfer",
        metadata,
        cancel_at_period_end: providerCancel,
        status: "active",
      }),
    };
  });
  try {
    await provider.billing.checkout("o", "plan", "p", "Admin");
    assert.equal(state().subscriptions.length, 0);
    const invalid = paidInvoice("evt_wrong");
    invalid.data.object.amount_paid = 1;
    await assert.rejects(() => emit(invalid), /amount or currency/);
    assert.equal(state().subscriptions.length, 0);
    const paid = paidInvoice();
    await emit(paid);
    assert.equal(state().subscriptions[0].end, "2027-12-31");
    assert.equal(state().invoices[0].status, "Paid");
    assert.equal(state().invoices[0].paymentIntent, "pi_annual");
    await emit(paid);
    await emit({ ...paid, id: "evt_duplicate_invoice" });
    assert.equal(state().invoices.length, 1);
    await emit({
      id: "evt_checkout",
      type: "checkout.session.completed",
      created: start,
      data: {
        object: {
          id: "cs_annual",
          mode: "subscription",
          subscription: "sub_annual",
          customer: "cus_golfer",
          amount_total: 12000,
          currency: "gbp",
          metadata,
        },
      },
    });
    assert.equal(provider.billing.list("o")[0].status, "Active");
    await emit({
      id: "evt_failed",
      type: "invoice.payment_failed",
      created: end,
      data: {
        object: {
          id: "in_renewal",
          subscription: "sub_annual",
          customer: "cus_golfer",
          amount_due: 12000,
          currency: "gbp",
        },
      },
    });
    assert.equal(provider.billing.list("o")[0].status, "Past due");
    assert.equal(state().subscriptions[0].end, "2027-12-31");
    assert.equal(
      state().invoices.find((i) => i.id === "stripe_in_renewal").status,
      "Unpaid",
    );
    const nextEnd = Date.parse("2029-01-01T00:00:00Z") / 1000;
    await emit(paidInvoice("in_renewal", end, nextEnd));
    assert.equal(state().invoices.length, 2);
    assert.equal(
      state().invoices.find((i) => i.id === "stripe_in_renewal").status,
      "Paid",
    );
    assert.equal(state().subscriptions[0].end, "2028-12-31");
    const id = provider.billing.list("o")[0].id;
    await provider.billing.cancel("o", id, "Admin");
    assert.equal(provider.billing.list("o")[0].cancelAtEnd, 1);
    providerCancel = false;
    await emit({
      id: "evt_resumed",
      type: "customer.subscription.updated",
      created: end + 100,
      data: {
        object: {
          id: "sub_annual",
          customer: "cus_golfer",
          metadata,
          status: "active",
          cancel_at_period_end: true,
        },
      },
    });
    assert.equal(provider.billing.list("o")[0].cancelAtEnd, 0);
    await provider.billing.cancel("o", id, "Admin");
    assert.equal(cancelKeys.length, 2);
    assert.notEqual(cancelKeys[0], cancelKeys[1]);
    await emit({
      id: "evt_old_failure",
      type: "invoice.payment_failed",
      created: end + 200,
      data: {
        object: {
          id: "in_renewal",
          subscription: "sub_annual",
          customer: "cus_golfer",
        },
      },
    });
    assert.equal(provider.billing.list("o")[0].status, "Active");

    assert.equal(state().subscriptions[0].status, "Active");
    assert.equal(state().subscriptions[0].end, "2028-12-31");
    assert.match(
      (await provider.billing.portal("o", id)).url,
      /billing.stripe.com/,
    );
    await assert.rejects(
      () => provider.billing.portal("other", id),
      /not found/,
    );
    assert.ok(subscriptionCalls >= 2);
  } finally {
    db.close();
  }
});

test("annual checkout reuses durable attempts after timeouts and never expires a live checkout using local time alone", async () => {
  const keys = [];
  let timeout = true,
    expired = false;
  const { db, provider, state } = fixture(async (url, opts) => {
    if (opts.method === "GET")
      return {
        ok: true,
        json: async () => ({
          id: "cs_retry",
          status: expired ? "expired" : "open",
          payment_status: "unpaid",
        }),
      };
    keys.push(opts.headers["Idempotency-Key"]);
    if (timeout) throw Error("response lost");
    return {
      ok: true,
      json: async () => ({
        id: "cs_retry",
        url: "https://checkout.stripe.com/c/pay/retry",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    };
  });
  try {
    await assert.rejects(
      () => provider.billing.checkout("o", "plan", "p", "Admin"),
      /unconfirmed/,
    );
    timeout = false;
    await provider.billing.checkout("o", "plan", "p", "Admin");
    assert.equal(keys[0], keys[1]);
    await provider.billing.checkout("o", "plan", "p", "Admin");
    assert.equal(keys.length, 2);
    db.prepare("UPDATE billing SET expires=0").run();
    await assert.rejects(
      () => provider.billing.checkout("o", "plan", "p", "Admin"),
      /must be resolved/,
    );
    assert.equal(keys.length, 2);
    assert.equal(state().subscriptions.length, 0);
    expired = true;
    await provider.billing.checkout("o", "plan", "p", "Admin");
    assert.notEqual(keys[2], keys[1]);
    assert.equal(provider.billing.list("o").length, 2);
  } finally {
    db.close();
  }
});
