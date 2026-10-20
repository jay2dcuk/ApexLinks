import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fail, text, timestamp } from "./validation.js";
const hash = (token) => createHash("sha256").update(token).digest("hex");
export function createCampaigns(db, mailer) {
  let active = null,
    stopped = false;
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const state = (orgId) =>
    JSON.parse(
      db.prepare("SELECT state FROM orgs WHERE id=?").get(orgId).state,
    );
  const find = (orgId, id) => {
    const row = db
      .prepare("SELECT * FROM campaigns WHERE org_id=? AND id=?")
      .get(orgId, id);
    if (!row) fail(404, "Campaign not found.");
    return row;
  };
  const audit = (orgId, actor, action) => {
    const s = state(orgId);
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
  const consented = (orgId, p) =>
    Boolean(
      p?.email &&
      db
        .prepare(
          "SELECT 1 FROM email_consents WHERE org_id=? AND player_id=? AND email=? AND consented=1",
        )
        .get(orgId, p.id, p.email),
    );
  const eligible = (s, c, p) =>
    p &&
    consented(c.org_id, p) &&
    (!c.event_id ||
      s.entries.some(
        (e) =>
          e.eventId === c.event_id &&
          e.playerId === p.id &&
          e.status === "Registered",
      ));
  async function deliver() {
    if (stopped || !mailer.configured) return;
    const row = tx(() => {
      const now = Date.now();
      const row = db
        .prepare(
          "SELECT r.*,c.org_id,c.subject,c.body,c.event_id FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE c.status='Queued' AND c.scheduled<=? AND r.status IN ('Queued','Retry') AND r.retry_at<=? AND r.lease<=? ORDER BY c.scheduled,r.id LIMIT 1",
        )
        .get(now, now, now);
      if (!row) return null;
      const s = state(row.org_id),
        p = s.players.find((p) => p.id === row.player_id);
      if (!eligible(s, row, p) || p.email !== row.email) {
        db.prepare(
          "UPDATE campaign_recipients SET status='Skipped' WHERE id=?",
        ).run(row.id);
        audit(
          row.org_id,
          "Campaign worker",
          "Skipped ineligible campaign recipient " + row.id,
        );
        return null;
      }
      if (
        row.first_attempt &&
        (now - row.first_attempt > 23 * 3600000 || row.attempts >= 5)
      ) {
        db.prepare(
          "UPDATE campaign_recipients SET status='Review' WHERE id=?",
        ).run(row.id);
        audit(
          row.org_id,
          "Campaign worker",
          "Campaign attempt requires review " + row.id,
        );
        return null;
      }
      db.prepare(
        "UPDATE campaign_recipients SET lease=?,attempts=attempts+1,first_attempt=CASE WHEN first_attempt=0 THEN ? ELSE first_attempt END WHERE id=?",
      ).run(now + 120000, now, row.id);
      return row;
    });
    if (row) {
      try {
        const providerId = await mailer.sendCampaign({
          address: row.email,
          subject: row.subject,
          body: row.body,
          token: row.unsubscribe_token,
          idempotencyKey: "apex-campaign:" + row.id,
        });
        db.prepare(
          "UPDATE campaign_recipients SET status='Accepted',provider_id=?,lease=0 WHERE id=?",
        ).run(providerId, row.id);
        audit(
          row.org_id,
          "Email provider",
          "Accepted campaign recipient " + row.id,
        );
      } catch (error) {
        db.prepare(
          "UPDATE campaign_recipients SET status=?,retry_at=?,lease=0 WHERE id=?",
        ).run(
          error.retryable === false ? "Failed" : "Retry",
          Date.now() + Math.min(3600000, 60000 * 2 ** row.attempts),
          row.id,
        );
        audit(
          row.org_id,
          "Campaign worker",
          "Campaign recipient awaiting retry or review " + row.id,
        );
      }
    }
    db.prepare(
      "UPDATE campaigns SET status='Finished' WHERE status='Queued' AND NOT EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.campaign_id=campaigns.id AND r.status IN ('Queued','Retry'))",
    ).run();
  }
  return {
    tick() {
      if (active || stopped) return active || Promise.resolve();
      active = deliver().finally(() => {
        active = null;
      });
      return active;
    },
    async stop() {
      stopped = true;
      if (active) await active;
    },
    unsubscribe(token) {
      const row = db
        .prepare(
          "SELECT r.*,c.org_id FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.unsubscribe_hash=?",
        )
        .get(hash(text(token, "Unsubscribe code", 100)));
      if (!row) fail(400, "This email preference link is invalid.");
      db.prepare(
        "INSERT INTO email_consents VALUES(?,?,?,?,?) ON CONFLICT(org_id,player_id) DO UPDATE SET consented=0,updated=excluded.updated WHERE email_consents.email=excluded.email",
      ).run(row.org_id, row.player_id, row.email, 0, new Date().toISOString());
      return { message: "Club campaign emails are disabled for this address." };
    },
    preferences(orgId, user) {
      return state(orgId)
        .players.filter((p) => p.email === user.email)
        .map((p) => ({
          playerId: p.id,
          name: p.name,
          consented: consented(orgId, p),
        }));
    },
    setPreference(orgId, user, playerId, value) {
      if (typeof value !== "boolean") fail(400, "Choose an email preference.");
      const player = state(orgId).players.find(
        (p) => p.id === playerId && p.email === user.email,
      );
      if (!player)
        fail(403, "Only the golfer can change consent for their linked email.");
      if (
        value &&
        !db
          .prepare("SELECT 1 FROM verified_emails WHERE user_id=? AND email=?")
          .get(user.user_id, user.email)
      )
        fail(409, "Verify your account email in Settings before subscribing.");
      db.prepare(
        "INSERT INTO email_consents VALUES(?,?,?,?,?) ON CONFLICT(org_id,player_id) DO UPDATE SET email=excluded.email,consented=excluded.consented,updated=excluded.updated",
      ).run(
        orgId,
        player.id,
        player.email,
        value ? 1 : 0,
        new Date().toISOString(),
      );
      return { consented: value };
    },
    list(orgId) {
      return db
        .prepare(
          "SELECT id,subject,body,event_id AS eventId,status,scheduled,created FROM campaigns WHERE org_id=? ORDER BY created DESC",
        )
        .all(orgId)
        .map((c) => ({
          ...c,
          counts: Object.fromEntries(
            db
              .prepare(
                "SELECT status,COUNT(*) AS count FROM campaign_recipients WHERE campaign_id=? GROUP BY status",
              )
              .all(c.id)
              .map((r) => [r.status, r.count]),
          ),
        }));
    },
    draft(orgId, b, actor) {
      return tx(() => {
        const subject = text(b.subject, "Subject", 180),
          body = text(b.body, "Message", 10000),
          eventId = b.eventId || "";
        if (eventId && !state(orgId).events.some((e) => e.id === eventId))
          fail(404, "Audience event not found.");
        const id = randomUUID();
        db.prepare("INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?)").run(
          id,
          orgId,
          subject,
          body,
          eventId,
          "Draft",
          0,
          new Date().toISOString(),
        );
        audit(orgId, actor, "Created email campaign " + subject);
        return { id };
      });
    },
    preview(orgId, id) {
      const c = find(orgId, id),
        s = state(orgId),
        addresses = new Set(
          s.players.filter((p) => eligible(s, c, p)).map((p) => p.email),
        );
      return {
        eligible: addresses.size,
        scheduled: new Date(c.scheduled || Date.now()).toISOString(),
      };
    },
    schedule(orgId, id, sendAt, actor) {
      if (!mailer.configured) fail(503, "Email delivery is not configured.");
      const scheduled = sendAt ? Date.parse(timestamp(sendAt)) : Date.now();
      if (
        scheduled < Date.now() - 60000 ||
        scheduled > Date.now() + 30 * 86400000
      )
        fail(400, "Schedule within the next 30 days.");
      return tx(() => {
        const c = find(orgId, id);
        if (c.status !== "Draft") fail(409, "Only a draft can be scheduled.");
        const s = state(orgId),
          recipients = s.players.filter((p) => eligible(s, c, p));
        if (!recipients.length)
          fail(
            409,
            "No golfers in this audience have verified, opted-in email addresses.",
          );
        if (recipients.length > 1000)
          fail(400, "Campaigns support up to 1,000 recipients.");
        for (const p of recipients) {
          const token = randomBytes(32).toString("hex");
          db.prepare(
            "INSERT OR IGNORE INTO campaign_recipients VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            randomUUID(),
            id,
            p.id,
            p.email,
            "Queued",
            "",
            token,
            hash(token),
            0,
            0,
            0,
            0,
          );
        }
        db.prepare(
          "UPDATE campaigns SET status='Queued',scheduled=? WHERE id=?",
        ).run(scheduled, id);
        audit(orgId, actor, "Scheduled email campaign " + c.subject);
        return this.preview(orgId, id);
      });
    },
    cancel(orgId, id, actor) {
      return tx(() => {
        const c = find(orgId, id);
        if (!["Draft", "Queued"].includes(c.status))
          fail(409, "This campaign has already finished.");
        db.prepare("UPDATE campaigns SET status='Cancelled' WHERE id=?").run(
          id,
        );
        db.prepare(
          "UPDATE campaign_recipients SET status='Cancelled' WHERE campaign_id=? AND status IN ('Queued','Retry') AND lease<=?",
        ).run(id, Date.now());
        audit(orgId, actor, "Cancelled email campaign " + c.subject);
        return {
          message:
            "Campaign cancelled. An email already being accepted by the provider cannot be recalled.",
        };
      });
    },
  };
}
