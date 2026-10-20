import { test } from "node:test";
import assert from "node:assert/strict";
import { accountingLedger, ledgerColumns } from "../public/accounting.js";
test("accounting ledger filters cash dates, separates confirmed refunds and exposes only prescribed columns", () => {
  const state = {
    players: [{ id: "p", name: "Golfer", email: "private@example.com" }],
    invoices: [
      {
        id: "i",
        playerId: "p",
        description: "Membership",
        status: "Paid",
        amount: 5000,
        paidAt: "2026-10-20T10:00:00.000Z",
        reference: "Stripe pi_test",
        secret: "private",
      },
      {
        id: "unpaid",
        playerId: "p",
        status: "Unpaid",
        amount: 5000,
        paidAt: "2026-10-20T10:00:00.000Z",
      },
      {
        id: "old",
        status: "Paid",
        amount: 100,
        paidAt: "2025-10-20T10:00:00.000Z",
      },
      { id: "free", status: "Paid", amount: 0 },
    ],
  };
  const refund = {
    id: "r",
    invoiceId: "i",
    amount: 1500,
    reason: "Adjustment",
    status: "Succeeded",
    providerId: "re_test",
    updated: "2026-10-21T10:00:00.000Z",
  };
  const rows = accountingLedger(
    state,
    [refund, { ...refund, id: "pending", status: "Pending" }],
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, ledgerColumns.length);
  assert.equal(rows[0][9], "50.00");
  assert.equal(rows[1][9], "-15.00");
  assert.equal(JSON.stringify(rows).includes("private"), false);
  assert.equal(
    accountingLedger(state, [refund], "2026-10-21", "2026-10-21").length,
    1,
  );
});
