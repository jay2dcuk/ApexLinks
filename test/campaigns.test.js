import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore, emptyState } from "../lib/store.js";
import { createCampaigns } from "../lib/campaigns.js";
function setup(sendCampaign) {
  const db = openStore(":memory:"),
    s = emptyState();
  s.players.push(
    { id: "p", email: "golfer@example.com", name: "Golfer" },
    { id: "q", email: "other@example.com", name: "Other" },
  );
  s.events.push({ id: "e", name: "Cup" });
  s.entries.push({ eventId: "e", playerId: "p", status: "Registered" });
  db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
    "o",
    "Club",
    JSON.stringify(s),
  );
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    "u",
    "golfer@example.com",
    "Golfer",
    "unused",
    new Date().toISOString(),
  );
  const service = createCampaigns(db, { configured: true, sendCampaign });
  return {
    db,
    s,
    service,
    user: { user_id: "u", email: "golfer@example.com" },
  };
}
test("campaigns require verified, individual consent and recheck opt-out at delivery", async () => {
  const sent = [];
  const { db, service, user } = setup(async (message) => {
    sent.push(message);
    return "email_1";
  });
  try {
    const draft = service.draft(
      "o",
      { subject: "Club briefing", body: "Please arrive early", eventId: "e" },
      "Admin",
    );
    assert.equal(service.preview("o", draft.id).eligible, 0);
    assert.throws(
      () => service.schedule("o", draft.id, "", "Admin"),
      /No golfers/,
    );
    assert.throws(
      () => service.setPreference("o", user, "q", true),
      /Only the golfer/,
    );
    assert.throws(() => service.setPreference("o", user, "p", true), /Verify/);
    db.prepare("INSERT INTO verified_emails VALUES(?,?,?)").run(
      "u",
      user.email,
      new Date().toISOString(),
    );
    service.setPreference("o", user, "p", true);
    assert.equal(service.preview("o", draft.id).eligible, 1);
    service.schedule("o", draft.id, "", "Admin");
    const queuedVersion = JSON.parse(
      db.prepare("SELECT state FROM orgs WHERE id='o'").get().state,
    ).version;
    assert.throws(
      () => service.schedule("o", draft.id, "", "Admin"),
      /Only a draft/,
    );
    await service.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].address, user.email);
    assert.equal(service.list("o")[0].counts.Accepted, 1);
    assert.ok(
      JSON.parse(db.prepare("SELECT state FROM orgs WHERE id='o'").get().state)
        .version > queuedVersion,
    );
    assert.equal(
      JSON.stringify(service.list("o")).includes(sent[0].token),
      false,
    );
    const next = service.draft(
      "o",
      { subject: "Follow-up", body: "Update" },
      "Admin",
    );
    service.schedule("o", next.id, "", "Admin");
    service.unsubscribe(sent[0].token);
    await service.tick();
    assert.equal(sent.length, 1);
    assert.equal(
      service.list("o").find((c) => c.id === next.id).counts.Skipped,
      1,
    );
    assert.equal(service.preferences("o", user)[0].consented, false);
  } finally {
    await service.stop();
    db.close();
  }
});
test("campaign retry keys survive timeouts, schedules wait, cancellation stops unsent work", async () => {
  const keys = [];
  let timeout = true;
  const { db, service, user } = setup(async (message) => {
    keys.push(message.idempotencyKey);
    if (timeout) {
      const error = new Error("timeout");
      error.retryable = true;
      throw error;
    }
    return "email_2";
  });
  try {
    db.prepare("INSERT INTO verified_emails VALUES(?,?,?)").run(
      "u",
      user.email,
      new Date().toISOString(),
    );
    service.setPreference("o", user, "p", true);
    const draft = service.draft(
      "o",
      { subject: "Scheduled", body: "Later" },
      "Admin",
    );
    service.schedule(
      "o",
      draft.id,
      new Date(Date.now() + 3600000).toISOString(),
      "Admin",
    );
    await service.tick();
    assert.equal(keys.length, 0);
    db.prepare("UPDATE campaigns SET scheduled=0 WHERE id=?").run(draft.id);
    await service.tick();
    assert.equal(keys.length, 1);
    assert.equal(service.list("o")[0].counts.Retry, 1);
    timeout = false;
    db.prepare("UPDATE campaign_recipients SET retry_at=0").run();
    await service.tick();
    assert.equal(keys[0], keys[1]);
    const cancelled = service.draft(
      "o",
      { subject: "Cancelled", body: "Unsent" },
      "Admin",
    );
    service.schedule("o", cancelled.id, "", "Admin");
    service.cancel("o", cancelled.id, "Admin");
    await service.tick();
    assert.equal(keys.length, 2);
    assert.equal(
      service.list("o").find((c) => c.id === cancelled.id).counts.Cancelled,
      1,
    );
  } finally {
    await service.stop();
    db.close();
  }
});
