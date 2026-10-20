import { randomUUID } from "node:crypto";
import { fail, integer, text } from "./validation.js";

// Durable reservations keep a retry from creating a second refund after a timeout.
export function createRefunds(db, { key, fetcher = fetch, configured }) {
  const transaction = (fn) => {
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
    const row = db
      .prepare("SELECT * FROM refunds WHERE org_id=? AND id=?")
      .get(orgId, id);
    if (!row) fail(404, "Refund not found.");
    return row;
  };
  function update(id, refund, eventId) {
    return transaction(() => {
      const row = db.prepare("SELECT * FROM refunds WHERE id=?").get(id);
      if (!row) fail(400, "Unknown refund attempt.");
      if (
        refund.amount !== row.amount ||
        refund.currency !== "gbp" ||
        refund.payment_intent !== row.payment_intent ||
        !/^re_/.test(refund.id || "") ||
        (row.provider_id && row.provider_id !== refund.id)
      )
        fail(400, "Refund response does not match the reserved payment.");
      const statuses = {
        pending: "Pending",
        requires_action: "Pending",
        succeeded: "Succeeded",
        failed: "Failed",
        canceled: "Cancelled",
      };
      const status = statuses[refund.status];
      if (!status)
        fail(502, "Unrecognised refund status. Check Stripe before retrying.");
      // Provider events can arrive out of order. Terminal outcomes cannot regress.
      if (!["Succeeded", "Failed", "Cancelled"].includes(row.status)) {
        db.prepare(
          "UPDATE refunds SET status=?,provider_id=?,updated=? WHERE id=?",
        ).run(status, refund.id, new Date().toISOString(), id);
        const org = db
          .prepare("SELECT state FROM orgs WHERE id=?")
          .get(row.org_id);
        const state = JSON.parse(org.state),
          invoice = state.invoices.find((i) => i.id === row.invoice_id);
        if (!invoice) fail(409, "Refund invoice is missing.");
        const total = db
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS amount FROM refunds WHERE org_id=? AND invoice_id=? AND status='Succeeded'",
          )
          .get(row.org_id, row.invoice_id).amount;
        invoice.refundedAmount = total;
        state.version++;
        state.audit.unshift({
          id: randomUUID(),
          actor: "Stripe",
          action: `Refund ${id}: ${status} (${row.amount}p)`,
          time: new Date().toISOString(),
        });
        state.audit = state.audit.slice(0, 1000);
        db.prepare("UPDATE orgs SET state=? WHERE id=?").run(
          JSON.stringify(state),
          row.org_id,
        );
      }
      if (eventId)
        db.prepare("INSERT OR IGNORE INTO webhooks VALUES(?)").run(eventId);
      return get(row.org_id, id);
    });
  }
  async function submit(row) {
    if (!configured) fail(503, "Stripe refunds are not configured.");
    if (row.status !== "Creating")
      return { refund: row, message: "Refund status already recorded." };
    if (Date.now() - Date.parse(row.created) > 23 * 3600000)
      fail(
        409,
        "This unconfirmed refund is too old to retry automatically. Review it in Stripe before making another refund.",
      );
    const body = new URLSearchParams({
      payment_intent: row.payment_intent,
      amount: String(row.amount),
      "metadata[apexRefundId]": row.id,
      "metadata[orgId]": row.org_id,
      "metadata[invoiceId]": row.invoice_id,
    });
    let response;
    try {
      response = await fetcher("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Idempotency-Key": "apex-refund:" + row.id,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return {
        refund: get(row.org_id, row.id),
        message:
          "Stripe response is unconfirmed. Retry this same refund to check safely.",
      };
    }
    if (!response.ok) {
      if (
        response.status >= 400 &&
        response.status < 500 &&
        ![409, 429].includes(response.status)
      )
        db.prepare(
          "UPDATE refunds SET status='Failed',updated=? WHERE id=? AND status='Creating'",
        ).run(new Date().toISOString(), row.id);
      return {
        refund: get(row.org_id, row.id),
        message:
          "Stripe did not confirm this refund. Review its status before another attempt.",
      };
    }
    const refund = update(row.id, await response.json());
    return {
      refund,
      message:
        refund.status === "Succeeded"
          ? "Refund confirmed by Stripe."
          : "Refund submitted. Final status will arrive through the signed webhook.",
    };
  }
  return {
    list(orgId) {
      return db
        .prepare(
          "SELECT id,invoice_id AS invoiceId,amount,reason,status,provider_id AS providerId,created,updated FROM refunds WHERE org_id=? ORDER BY created DESC",
        )
        .all(orgId);
    },
    async create(orgId, invoiceId, amount, reason, actor) {
      if (!configured) fail(503, "Stripe refunds are not configured.");
      integer(amount, "Refund amount", 1, 100000000);
      reason = text(reason, "Refund reason", 240);
      const row = transaction(() => {
        const org = db.prepare("SELECT state FROM orgs WHERE id=?").get(orgId);
        const invoice =
          org && JSON.parse(org.state).invoices.find((i) => i.id === invoiceId);
        const payment = db
          .prepare("SELECT * FROM payments WHERE org_id=? AND invoice_id=?")
          .get(orgId, invoiceId);
        const intent =
          invoice?.paymentIntent ||
          (payment?.status === "Paid" &&
            invoice?.reference?.match(/^Stripe (pi_[A-Za-z0-9_]+)$/)?.[1]);
        if (
          !invoice ||
          invoice.status !== "Paid" ||
          payment?.status !== "Paid" ||
          !/^pi_[A-Za-z0-9_]+$/.test(intent || "")
        )
          fail(409, "Only a verified Stripe invoice can be refunded here.");
        const active = db
          .prepare(
            "SELECT * FROM refunds WHERE org_id=? AND invoice_id=? AND status IN ('Creating','Pending')",
          )
          .get(orgId, invoiceId);
        if (active)
          fail(
            409,
            "An existing refund is unconfirmed. Check or retry that refund first.",
          );
        const refunded = db
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS amount FROM refunds WHERE org_id=? AND invoice_id=? AND status='Succeeded'",
          )
          .get(orgId, invoiceId).amount;
        if (amount > invoice.amount - refunded)
          fail(409, "Refund exceeds the remaining paid amount.");
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare("INSERT INTO refunds VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
          id,
          orgId,
          invoiceId,
          amount,
          reason,
          "Creating",
          "",
          intent,
          actor,
          now,
          now,
        );
        const state = JSON.parse(org.state);
        state.version++;
        state.audit.unshift({
          id: randomUUID(),
          actor,
          action: `Requested refund ${id}: ${amount}p`,
          time: now,
        });
        state.audit = state.audit.slice(0, 1000);
        db.prepare("UPDATE orgs SET state=? WHERE id=?").run(
          JSON.stringify(state),
          orgId,
        );
        return get(orgId, id);
      });
      return submit(row);
    },
    async retry(orgId, id) {
      return submit(get(orgId, id));
    },
    async reconcile(orgId, id) {
      if (!configured) fail(503, "Stripe refunds are not configured.");
      const row = get(orgId, id);
      if (!row.provider_id) return submit(row);
      let response;
      try {
        response = await fetcher(
          "https://api.stripe.com/v1/refunds/" +
            encodeURIComponent(row.provider_id),
          {
            headers: { Authorization: "Bearer " + key },
            signal: AbortSignal.timeout(10000),
          },
        );
      } catch {
        fail(502, "Stripe status is temporarily unavailable.");
      }
      if (!response.ok) fail(502, "Stripe could not confirm refund status.");
      return {
        refund: update(id, await response.json()),
        message: "Refund status checked with Stripe.",
      };
    },
    webhook(event) {
      if (
        !["refund.created", "refund.updated", "refund.failed"].includes(
          event.type,
        )
      )
        return false;
      const refund = event.data?.object;
      if (!refund?.metadata?.apexRefundId) return true;
      const row = db
        .prepare("SELECT * FROM refunds WHERE id=?")
        .get(refund.metadata.apexRefundId);
      if (
        !row ||
        row.org_id !== refund.metadata.orgId ||
        row.invoice_id !== refund.metadata.invoiceId
      )
        fail(400, "Refund metadata does not match.");
      update(row.id, refund, event.id);
      return true;
    },
  };
}
