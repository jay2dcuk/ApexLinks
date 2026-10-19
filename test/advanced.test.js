import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac, scryptSync } from "node:crypto";
import { openStore, emptyState } from "../lib/store.js";
import { seedDemoAccounts, demoUsers } from "../lib/demo.js";
import { createPayments } from "../lib/providers.js";
import {
  competitionOperation,
  validateBookingRules,
} from "../lib/competition-api.js";
import { defaultPars, defaultIndexes, leaderboard } from "../public/scoring.js";
import { matchResult, teamStandings } from "../public/competition.js";
import { createApp } from "../server.js";
const admin = { user_id: "u", name: "Admin", email: "admin@example.com" };
function fixture(format = "Stableford") {
  const s = emptyState();
  s.courses.push({
    id: "c",
    name: "Links",
    tee: "White",
    pars: defaultPars,
    indexes: defaultIndexes,
    rating: 72,
    slope: 125,
  });
  s.events.push({
    id: "e",
    format,
    name: "Competition",
    status: "Open",
    fee: 2500,
    capacity: 2,
  });
  s.rounds.push({
    id: "r",
    eventId: "e",
    number: 1,
    status: "Open",
    courseId: "c",
    pars: defaultPars,
    indexes: defaultIndexes,
  });
  for (let i = 0; i < 4; i++) {
    s.players.push({
      id: "p" + i,
      name: "Player " + i,
      email: `p${i}@example.com`,
      handicap: i,
    });
    s.entries.push({
      id: "entry" + i,
      eventId: "e",
      playerId: "p" + i,
      handicap: i,
      division: "Open",
      team: i < 2 ? "Green" : "Blue",
      status: "Registered",
    });
  }
  return s;
}
function op(s, resource, b = {}, options = {}) {
  return competitionOperation(s, {
    resource,
    b,
    role: "admin",
    user: admin,
    method: "POST",
    ...options,
  }).result;
}
test("countback resolves equal full rounds by final-nine scores", () => {
  const s = fixture("Stroke play");
  s.events[0].tiebreak = "Countback";
  s.entries = s.entries.slice(0, 2);
  const a = [...defaultPars],
    b = [...defaultPars];
  a[0]++;
  a[17]--;
  b[0]--;
  b[17]++;
  for (const [i, scores] of [a, b].entries())
    s.cards.push({ playerId: "p" + i, roundId: "r", scores });
  const rows = leaderboard(s, s.events[0]);
  assert.equal(rows[0].playerId, "p0");
  assert.deepEqual(
    rows.map((r) => r.position),
    [1, 2],
  );
  s.events[0].tiebreak = "Shared";
  assert.deepEqual(
    leaderboard(s, s.events[0]).map((r) => r.position),
    [1, 1],
  );
});
test("match play handles early wins, ties and handicap differences", () => {
  const s = fixture(),
    r = s.rounds[0];
  const winner = matchResult(Array(18).fill(3), Array(18).fill(4), r, 0, 0);
  assert.equal(winner.label, "10 & 8");
  assert.equal(winner.winner, "A");
  assert.equal(matchResult(defaultPars, defaultPars, r, 0, 0).winner, null);
  assert.equal(matchResult([4], [4], r, 0, 18).lead, -1);
});
test("knockout bracket must finish before advancing and records concessions", () => {
  const s = fixture("Match play");
  op(s, "matches", { roundId: "r" });
  assert.equal(s.matches.length, 2);
  assert.equal(s.matches[0].playerA, "p0");
  assert.equal(s.matches[0].playerB, "p3");
  s.rounds.push({ ...s.rounds[0], id: "r2", number: 2 });
  assert.throws(() => op(s, "matches", { roundId: "r2" }), /Finalise/);
  for (const m of s.matches)
    op(
      s,
      "matches",
      { winner: m.playerA, reason: "Opponent conceded" },
      { resourceId: m.id, action: "finalise" },
    );
  op(s, "matches", { roundId: "r2" });
  assert.equal(s.matches.length, 3);
  assert.deepEqual([s.matches[2].playerA, s.matches[2].playerB], ["p0", "p1"]);
  assert.throws(
    () =>
      op(s, "matches", {}, { resourceId: s.matches[0].id, action: "reopen" }),
    /Later bracket/,
  );
});
test("team cards are shared, versioned, role-checked, attested and ranked", () => {
  const s = fixture("Scramble");
  const payload = {
    roundId: "r",
    team: "Green",
    handicap: 5,
    scores: defaultPars,
    version: 0,
  };
  assert.throws(
    () => op(s, "team-cards", payload, { role: "scorer" }),
    /initialise/,
  );
  let c = op(s, "team-cards", payload);
  assert.equal(c.handicap, 5);
  assert.throws(
    () =>
      op(
        s,
        "team-cards",
        { ...payload, version: 1 },
        { role: "player", user: { ...admin, email: "p2@example.com" } },
      ),
    /own team/,
  );
  c = op(
    s,
    "team-cards",
    { ...payload, version: 1, submit: true },
    {
      role: "player",
      user: { ...admin, user_id: "p0", email: "p0@example.com" },
    },
  );
  assert.throws(
    () => op(s, "team-cards", { ...payload, version: 1 }),
    /changed/,
  );
  op(
    s,
    "team-cards",
    { ...payload, version: 2 },
    { role: "scorer", action: "attest" },
  );
  assert.equal(c.status, "Attested");
  const rows = teamStandings(s, s.events[0]);
  assert.equal(rows[0].name, "Green");
  assert.equal(rows[0].net, 67);
  assert.equal(rows[0].attested, 1);
  assert.throws(
    () => op(s, "team-cards", { ...payload, version: 3 }),
    /unlock/,
  );
});
test("withdrawal promotes first waiting player, invoices admission, and excludes DQ standings", () => {
  const s = fixture();
  s.entries[2].status = "Waitlisted";
  s.entries[3].status = "Waitlisted";
  op(
    s,
    "entry-status",
    { status: "Withdrawn", reason: "Unable to attend" },
    { resourceId: "entry0" },
  );
  assert.equal(s.entries[2].status, "Registered");
  assert.equal(s.entries[3].status, "Waitlisted");
  assert.equal(s.invoices[0].playerId, "p2");
  s.cards.push({ roundId: "r", playerId: "p1", scores: defaultPars });
  op(
    s,
    "entry-status",
    { status: "Disqualified", reason: "Rules decision" },
    { resourceId: "entry1" },
  );
  assert.equal(
    leaderboard(s, s.events[0]).find((r) => r.playerId === "p1").position,
    null,
  );
});
test("booking hours respect course timezone, holidays and slot intervals", () => {
  const s = fixture();
  op(s, "booking-rules", {
    courseId: "c",
    timezone: "Europe/London",
    open: "08:00",
    close: "18:00",
    interval: 15,
    closedDays: [0],
    closedDates: ["2027-06-12"],
  });
  assert.doesNotThrow(() =>
    validateBookingRules(s, "c", "2027-06-11T07:00:00Z", 15),
  );
  assert.throws(
    () => validateBookingRules(s, "c", "2027-06-11T06:45:00Z", 15),
    /outside/,
  );
  assert.throws(
    () => validateBookingRules(s, "c", "2027-06-11T07:05:00Z", 15),
    /interval/,
  );
  assert.throws(
    () => validateBookingRules(s, "c", "2027-06-12T07:00:00Z", 15),
    /closed/,
  );
  assert.throws(
    () =>
      op(s, "booking-rules", {
        courseId: "c",
        timezone: "Europe/London",
        open: "08:90",
        close: "18:00",
        interval: 15,
        closedDays: [],
        closedDates: [],
      }),
    /valid/,
  );
});
test("supplied handicap records are explicitly unverified and calculate course allowance", () => {
  const s = fixture();
  const r = op(s, "handicap-records", {
    playerId: "p0",
    provider: "USGA / GHIN",
    membershipId: "12345",
    index: 12.4,
    asOf: "2026-10-19",
    courseId: "c",
    allowance: 95,
  });
  assert.equal(r.verified, false);
  assert.equal(r.source, "Organiser-provided record");
  assert.equal(r.playingHandicap, 13);
  assert.equal(s.players[0].handicap, 13);
  assert.equal(s.entries[0].handicap, 0);
  assert.throws(
    () =>
      op(s, "handicap-records", {
        playerId: "p0",
        provider: "USGA / GHIN",
        index: 12.44,
      }),
    /decimal/,
  );
});
test("demo seeding is explicit, idempotent, cannot overwrite real accounts, and scopes roles", () => {
  const db = openStore(":memory:");
  try {
    assert.throws(() => seedDemoAccounts(db, "short"), /16/);
    const password = "test-only-password-12345";
    const d = seedDemoAccounts(db, password);
    assert.equal(d.accounts.length, 7);
    assert.equal(db.prepare("SELECT count(*) n FROM orgs").get().n, 2);
    for (const a of demoUsers) {
      const u = db.prepare("SELECT * FROM users WHERE email=?").get(a.email),
        [salt, key] = u.password.split(":");
      assert.equal(scryptSync(password, salt, 64).toString("hex"), key);
      assert.equal(
        db.prepare("SELECT count(*) n FROM members WHERE user_id=?").get(u.id)
          .n,
        a.both ? 2 : 1,
      );
      assert.equal(
        db.prepare("SELECT role FROM members WHERE user_id=? LIMIT 1").get(u.id)
          .role,
        a.role,
      );
    }
    const original = db
      .prepare("SELECT password FROM users LIMIT 1")
      .get().password;
    seedDemoAccounts(db, "a-different-password-123");
    assert.equal(
      db.prepare("SELECT password FROM users LIMIT 1").get().password,
      original,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 7);
  } finally {
    db.close();
  }
  const other = openStore(":memory:");
  try {
    other
      .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
      .run(
        "real",
        "admin@demo.apexlinks.test",
        "Real owner",
        "unchanged",
        "2026-01-01",
      );
    assert.throws(
      () => seedDemoAccounts(other, "test-only-password-12345"),
      /unmanaged/,
    );
    assert.equal(other.prepare("SELECT count(*) n FROM orgs").get().n, 0);
  } finally {
    other.close();
  }
});
test("Stripe checkout uses idempotency, validates signatures/amount, and processes webhooks once", async () => {
  const db = openStore(":memory:");
  try {
    const s = emptyState();
    s.invoices.push({
      id: "i",
      amount: 2500,
      currency: "GBP",
      description: "Entry",
      status: "Unpaid",
    });
    db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
      "o",
      "Club",
      JSON.stringify(s),
    );
    let calls = 0;
    const payments = createPayments(db, {
      key: "unit-test-key",
      webhookSecret: "unit-webhook-secret",
      appURL: "https://app.example",
      fetcher: async (url, options) => {
        calls++;
        assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
        assert.equal(
          options.body.get("line_items[0][price_data][unit_amount]"),
          "2500",
        );
        assert.ok(options.headers["Idempotency-Key"]);
        return {
          ok: true,
          json: async () => ({
            id: "cs_test",
            url: "https://checkout.stripe.com/c/pay/test",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        };
      },
    });
    await payments.checkout("o", "i");
    await payments.checkout("o", "i");
    assert.equal(calls, 1);
    const p = db.prepare("SELECT * FROM payments").get();
    const event = {
      id: "evt_test",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test",
          payment_status: "paid",
          amount_total: 2500,
          currency: "gbp",
          metadata: { orgId: "o", invoiceId: "i", attempt: p.attempt },
          payment_intent: "pi_test",
        },
      },
    };
    const sign = (body, stamp = Math.floor(Date.now() / 1000)) =>
      `t=${stamp},v1=${createHmac("sha256", "unit-webhook-secret")
        .update(stamp + ".")
        .update(body)
        .digest("hex")}`;
    let raw = Buffer.from(JSON.stringify(event));
    assert.throws(() => payments.webhook(raw, "t=1,v1=invalid"), /signature/);
    assert.throws(() => payments.webhook(raw, sign(raw, 1)), /signature/);
    const tampered = Buffer.from(
      JSON.stringify({
        ...event,
        data: { object: { ...event.data.object, amount_total: 1 } },
      }),
    );
    assert.throws(() => payments.webhook(tampered, sign(tampered)), /amount/);
    assert.equal(
      JSON.parse(db.prepare("SELECT state FROM orgs").get().state).invoices[0]
        .status,
      "Unpaid",
    );
    payments.webhook(raw, sign(raw));
    payments.webhook(raw, sign(raw));
    assert.equal(db.prepare("SELECT count(*) n FROM webhooks").get().n, 1);
    assert.equal(
      JSON.parse(db.prepare("SELECT state FROM orgs").get().state).invoices[0]
        .status,
      "Paid",
    );
    await assert.rejects(
      () => payments.checkout("o", "i"),
      /unpaid|already paid/,
    );
  } finally {
    db.close();
  }
});
test("recovery email reset tokens are single-use and revoke existing sessions", async () => {
  let message;
  const server = createApp({
    database: ":memory:",
    secure: false,
    mailOptions: {
      key: "unit-test-key",
      from: "Club <test@example.com>",
      appURL: "https://app.example",
      fetcher: async (url, opts) => {
        assert.equal(url, "https://api.resend.com/emails");
        message = JSON.parse(opts.body);
        return { ok: true };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  let cookie = "",
    csrf = "";
  const request = async (route, body, expected = 200, useSession = false) => {
    const res = await fetch(base + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(useSession ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    assert.equal(res.status, expected, JSON.stringify(d));
    return { res, d };
  };
  try {
    const login = await request("auth/register", {
      name: "Recover User",
      email: "recover@example.com",
      password: "original-password-123",
      organisation: "Recovery Club",
    });
    cookie = login.res.headers.getSetCookie()[0].split(";")[0];
    csrf = login.d.csrf;
    await request("auth/recover", { email: "recover@example.com" });
    assert.deepEqual(message.to, ["recover@example.com"]);
    const token = new URL(
      message.text.match(/https:\/\/app.example\/\?reset=[a-f0-9]+/)[0],
    ).searchParams.get("reset");
    await request("auth/reset", { token, password: "new-password-12345" });
    await request(
      "auth/reset",
      { token, password: "another-password-123" },
      400,
    );
    await request(
      "auth/login",
      { email: "recover@example.com", password: "original-password-123" },
      401,
    );
    await request("auth/login", {
      email: "recover@example.com",
      password: "new-password-12345",
    });
    const res = await fetch(base + "auth/me", { headers: { Cookie: cookie } });
    assert.equal((await res.json()).user, null);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("demo disable revokes access and startup cannot re-enable it", async () => {
  const { disableDemoAccounts } = await import("../lib/demo.js"),
    db = openStore(":memory:");
  try {
    seedDemoAccounts(db, "test-only-password-12345");
    const user = db.prepare("SELECT id FROM users LIMIT 1").get();
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      "token",
      user.id,
      "csrf",
      Date.now() + 60000,
    );
    assert.equal(disableDemoAccounts(db), 7);
    assert.equal(db.prepare("SELECT count(*) n FROM members").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM sessions").get().n, 0);
    assert.equal(
      seedDemoAccounts(db, "test-only-password-12345").disabled,
      true,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM orgs").get().n, 2);
  } finally {
    db.close();
  }
});
test("expired payment attempts require Stripe reconciliation before reuse", async () => {
  const db = openStore(":memory:");
  try {
    const s = emptyState();
    s.invoices.push({
      id: "i",
      amount: 2500,
      description: "Entry",
      status: "Unpaid",
    });
    db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
      "o",
      "Club",
      JSON.stringify(s),
    );
    db.prepare("INSERT INTO payments VALUES(?,?,?,?,?,?,?)").run(
      "o",
      "i",
      "old-attempt",
      "Open",
      "https://checkout.stripe.com/c/old",
      Date.now() - 60000,
      "cs_old",
    );
    let calls = 0;
    const payments = createPayments(db, {
      key: "unit-key",
      webhookSecret: "unit-webhook",
      appURL: "https://app.example",
      fetcher: async (url, options) => {
        calls++;
        if (url.endsWith("/cs_old"))
          return {
            ok: true,
            json: async () => ({
              id: "cs_old",
              status: "expired",
              payment_status: "unpaid",
            }),
          };
        assert.equal(options.body.get("metadata[invoiceId]"), "i");
        return {
          ok: true,
          json: async () => ({
            id: "cs_new",
            url: "https://checkout.stripe.com/c/new",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        };
      },
    });
    await assert.rejects(() => payments.checkout("o", "i"), /Reconcile/);
    assert.equal(calls, 0);
    await payments.reconcile("o", "i");
    assert.equal(
      db.prepare("SELECT status FROM payments").get().status,
      "Expired",
    );
    await payments.checkout("o", "i");
    const p = db.prepare("SELECT * FROM payments").get();
    assert.notEqual(p.attempt, "old-attempt");
    assert.equal(p.session_id, "cs_new");
    assert.equal(p.status, "Open");
    assert.equal(calls, 2);
  } finally {
    db.close();
  }
});
