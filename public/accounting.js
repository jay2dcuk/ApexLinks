// A cash-movement ledger, not a tax calculation or direct accounting integration.
export const ledgerColumns = [
  "Date (UTC)",
  "Type",
  "Transaction ID",
  "Invoice ID",
  "Player",
  "Description",
  "Currency",
  "Gross GBP",
  "Refund GBP",
  "Net GBP",
  "Reference",
];
export function accountingLedger(state, refunds, from, to) {
  const rows = [];
  const inRange = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    value.slice(0, 10) >= from &&
    value.slice(0, 10) <= to;
  const name = (invoice) =>
    state.players.find((p) => p.id === invoice.playerId)?.name || "";
  for (const invoice of state.invoices) {
    if (
      invoice.status !== "Paid" ||
      !invoice.amount ||
      !inRange(invoice.paidAt)
    )
      continue;
    rows.push([
      invoice.paidAt.slice(0, 10),
      "Payment",
      invoice.id,
      invoice.id,
      name(invoice),
      invoice.description,
      "GBP",
      (invoice.amount / 100).toFixed(2),
      "0.00",
      (invoice.amount / 100).toFixed(2),
      invoice.reference || "",
    ]);
  }
  for (const refund of refunds) {
    const invoice = state.invoices.find((i) => i.id === refund.invoiceId);
    if (!invoice || refund.status !== "Succeeded" || !inRange(refund.updated))
      continue;
    rows.push([
      refund.updated.slice(0, 10),
      "Refund",
      refund.id,
      invoice.id,
      name(invoice),
      refund.reason,
      "GBP",
      "0.00",
      (refund.amount / 100).toFixed(2),
      (-refund.amount / 100).toFixed(2),
      refund.providerId || "",
    ]);
  }
  return rows.sort(
    (a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]),
  );
}
