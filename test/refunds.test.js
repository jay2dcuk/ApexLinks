import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openStore, emptyState } from "../lib/store.js";
import { createPayments } from "../lib/providers.js";
function setup(fetcher) {
  const db = openStore(":memory:"),
    state = emptyState();
  state.invoices.push({
    id: "i",
    playerId: "p",
    amount: 5000,
    currency: "GBP",
    status: "Paid",
    paymentIntent: "pi_test",
    reference: "Stripe pi_test",
  });
  db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
    "o",
    "Test Club",
    JSON.stringify(state),
  );
  db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
    "other",
    "Other Club",
    JSON.stringify(state),
  );
  db.prepare("INSERT INTO payments VALUES(?,?,?,?,?,?,?)").run(
    "o",
    "i",
    "attempt",
    "Paid",
    "",
    0,
    "cs_test",
  );
  const provider = createPayments(db, {
    key: "test-key",
    webhookSecret: "test-secret",
    appURL: "https://app.example",
    fetcher,
  });
  return {
    db,
    provider,
    state: () =>
      JSON.parse(db.prepare("SELECT state FROM orgs WHERE id='o'").get().state),
  };
}
const signed = (provider, event) => {
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
test("Stripe refunds reserve partial amounts, retry timeouts safely and reconcile signed outcomes once", async () => {
  let calls = [],
    timeout = true;
  const { db, provider, state } = setup(async (url, options) => {
    calls.push({
      url,
      key: options.headers["Idempotency-Key"],
      body: options.body,
    });
    if (timeout) throw new Error("timeout after request accepted");
    return {
      ok: true,
      json: async () => ({
        id: "re_test",
        amount: 1500,
        currency: "gbp",
        payment_intent: "pi_test",
        status: "pending",
      }),
    };
  });
  try {
    await assert.rejects(
      () =>
        provider.refunds.create("other", "i", 100, "Not our payment", "Admin"),
      /verified Stripe/,
    );
    const first = await provider.refunds.create(
      "o",
      "i",
      1500,
      "Rain cancellation",
      "Admin",
    );
    assert.equal(first.refund.status, "Creating");
    assert.equal(state().invoices[0].refundedAmount, undefined);
    await assert.rejects(
      () => provider.refunds.create("o", "i", 1500, "Second request", "Admin"),
      /existing refund/,
    );
    timeout = false;
    const second = await provider.refunds.retry("o", first.refund.id);
    assert.equal(second.refund.status, "Pending");
    assert.equal(calls[0].key, calls[1].key);
    assert.equal(calls[1].body.get("payment_intent"), "pi_test");
    await assert.rejects(
      () => provider.refunds.retry("other", first.refund.id),
      /not found/,
    );
    const object = {
      id: "re_test",
      amount: 1500,
      currency: "gbp",
      payment_intent: "pi_test",
      status: "succeeded",
      metadata: { apexRefundId: first.refund.id, orgId: "o", invoiceId: "i" },
    };
    assert.throws(
      () =>
        signed(provider, {
          id: "evt_wrong",
          type: "refund.updated",
          data: { object: { ...object, amount: 5000 } },
        }),
      /does not match/,
    );
    signed(provider, {
      id: "evt_refund",
      type: "refund.updated",
      data: { object },
    });
    const version = state().version;
    signed(provider, {
      id: "evt_refund",
      type: "refund.updated",
      data: { object },
    });
    assert.equal(state().version, version);
    assert.equal(state().invoices[0].refundedAmount, 1500);
    signed(provider, {
      id: "evt_old_pending",
      type: "refund.updated",
      data: { object: { ...object, status: "pending" } },
    });
    assert.equal(provider.refunds.list("o")[0].status, "Succeeded");
    assert.equal(state().invoices[0].refundedAmount, 1500);
    await assert.rejects(
      () => provider.refunds.create("o", "i", 3501, "Too much", "Admin"),
      /exceeds/,
    );
    assert.equal(state().invoices[0].status, "Paid");
  } finally {
    db.close();
  }
});
test("failed refunds release reservations, old unknown attempts cannot duplicate money movement", async () => {
  const { db, provider } = setup(async () => ({ ok: false, status: 400 }));
  try {
    const first = await provider.refunds.create(
      "o",
      "i",
      1000,
      "Refund reason",
      "Admin",
    );
    assert.equal(first.refund.status, "Failed");
    const second = await provider.refunds.create(
      "o",
      "i",
      5000,
      "Full refund",
      "Admin",
    );
    assert.notEqual(second.refund.id, first.refund.id);
    db.prepare("UPDATE refunds SET status='Creating',created=? WHERE id=?").run(
      new Date(Date.now() - 25 * 3600000).toISOString(),
      second.refund.id,
    );
    await assert.rejects(
      () => provider.refunds.retry("o", second.refund.id),
      /too old/,
    );
    await assert.rejects(
      () => provider.refunds.create("o", "i", 1, "Another", "Admin"),
      /existing refund/,
    );
  } finally {
    db.close();
  }
});
