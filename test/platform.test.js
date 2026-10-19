import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server.js";
import {
  defaultPars,
  defaultIndexes,
  strokesOnHole,
  cardTotals,
  leaderboard,
} from "../public/scoring.js";

test("handicap allocation uses stroke indexes, including plus handicaps", () => {
  assert.equal(strokesOnHole(20, 1), 2);
  assert.equal(strokesOnHole(20, 3), 1);
  assert.equal(strokesOnHole(-2, 18), -1);
  assert.equal(strokesOnHole(-2, 1), 0);
  assert.equal(
    cardTotals(defaultPars, defaultPars, defaultIndexes, 18).points,
    54,
  );
});
test("unplayed entries do not lead a gross competition and ties share a place", () => {
  const state = {
    players: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ],
    entries: ["a", "b", "c"].map((playerId) => ({
      eventId: "e",
      playerId,
      status: "Registered",
      handicap: 0,
    })),
    rounds: [
      {
        id: "r",
        eventId: "e",
        number: 1,
        pars: defaultPars,
        indexes: defaultIndexes,
      },
    ],
    cards: ["b", "c"].map((playerId) => ({
      roundId: "r",
      playerId,
      scores: [5, ...Array(17).fill(null)],
    })),
  };
  const rows = leaderboard(state, { id: "e", format: "Stroke play" });
  assert.deepEqual(
    rows.map((r) => r.name),
    ["B", "C", "A"],
  );
  assert.deepEqual(
    rows.map((r) => r.position),
    [1, 1, null],
  );
});

test("multi-user club platform lifecycle and access controls", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "apex-test-")),
    database = path.join(dir, "test.sqlite");
  let server = createApp({ database, secure: false });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
  };
  t.after(async () => {
    if (server.listening) await close();
    await rm(dir, { recursive: true, force: true });
  });
  function client() {
    return {
      cookie: "",
      csrf: "",
      async request(route, method = "GET", body, expected = 200, headers = {}) {
        const res = await fetch(base + "/api/" + route, {
          method,
          headers: {
            "Content-Type": "application/json",
            Cookie: this.cookie,
            "X-CSRF-Token": this.csrf,
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const d = await res.json();
        assert.equal(
          res.status,
          expected,
          `${method} ${route}: ${JSON.stringify(d)}`,
        );
        const cookie = res.headers.getSetCookie()[0];
        if (cookie) this.cookie = cookie.split(";")[0];
        if (d.csrf) this.csrf = d.csrf;
        return d;
      },
    };
  }
  const admin = client(),
    outsider = client(),
    scorer = client(),
    golfer = client();
  let org, course, event, round, player, second;
  await t.test(
    "accounts, sessions, validation, origin and CSRF checks",
    async () => {
      await admin.request("orgs", "GET", undefined, 401);
      await admin.request(
        "auth/register",
        "POST",
        {
          email: "owner@example.com",
          password: "short",
          name: "Owner",
          organisation: "Apex Club",
        },
        400,
      );
      const d = await admin.request("auth/register", "POST", {
        email: "owner@example.com",
        password: "owner-password-123",
        name: "Owner",
        organisation: "Apex Club",
      });
      org = d.organisations[0].id;
      assert.equal((await admin.request("auth/me")).user.name, "Owner");
      await admin.request("orgs/" + org + "/seed", "POST", {}, 403, {
        "X-CSRF-Token": "",
      });
      await admin.request("orgs/" + org + "/seed", "POST", {}, 403, {
        Origin: "https://evil.example",
      });
      await outsider.request("auth/register", "POST", {
        email: "other@example.com",
        password: "another-password-123",
        name: "Other",
        organisation: "Other Club",
      });
      await outsider.request(`orgs/${org}/state`, "GET", undefined, 403);
    },
  );
  const route = (p) => `orgs/${org}/${p}`;
  await t.test(
    "course, players and tournament use validated persistent records",
    async () => {
      await admin.request(
        route("courses"),
        "POST",
        {
          name: "Invalid",
          tee: "White",
          pars: defaultPars,
          indexes: Array(18).fill(1),
        },
        400,
      );
      course = await admin.request(route("courses"), "POST", {
        name: "Apex Links",
        tee: "White",
        pars: defaultPars,
        indexes: defaultIndexes,
      });
      player = await admin.request(route("players"), "POST", {
        name: "Golfer",
        email: "golfer@example.com",
        club: "Apex",
        handicap: 18,
      });
      second = await admin.request(route("players"), "POST", {
        name: "Second",
        club: "Apex",
        handicap: 2,
      });
      event = await admin.request(route("events"), "POST", {
        name: "Championship",
        date: "2027-06-10",
        format: "Stableford",
        capacity: 2,
        fee: 2500,
      });
      await admin.request(route("events/" + event.id), "PATCH", {
        ...event,
        status: "Open",
      });
      round = await admin.request(route("rounds"), "POST", {
        eventId: event.id,
        courseId: course.id,
        date: "2027-06-10",
      });
      await admin.request(route("entries"), "POST", {
        eventId: event.id,
        playerId: player.id,
        team: "A",
      });
      await admin.request(route("entries"), "POST", {
        eventId: event.id,
        playerId: second.id,
        team: "A",
      });
      await admin.request(
        route("entries"),
        "POST",
        { eventId: event.id, playerId: player.id },
        409,
      );
      assert.equal(
        (await admin.request(route("state"))).state.invoices.length,
        2,
      );
    },
  );
  await t.test("pairings, bookings and conflict prevention", async () => {
    await admin.request(route("pairings"), "POST", {
      roundId: round.id,
      groupSize: 2,
      interval: 10,
      start: "2027-06-10T09:00:00Z",
      order: "Handicap",
    });
    const state = (await admin.request(route("state"))).state;
    assert.equal(state.teeTimes[0].playerIds[0], second.id);
    await admin.request(
      route("bookings"),
      "POST",
      {
        courseId: course.id,
        playerIds: [player.id],
        start: "2027-06-10T09:00:00Z",
      },
      409,
    );
    const b = await admin.request(route("bookings"), "POST", {
      courseId: course.id,
      playerIds: [player.id],
      start: "2027-06-11T09:00:00Z",
    });
    await admin.request(
      route("bookings"),
      "POST",
      {
        courseId: course.id,
        playerIds: [second.id],
        start: "2027-06-11T09:05:00Z",
      },
      409,
    );
    await admin.request(route("bookings/" + b.id), "DELETE", {});
    await admin.request(route("bookings"), "POST", {
      courseId: course.id,
      playerIds: [second.id],
      start: "2027-06-11T09:00:00Z",
    });
  });
  await t.test(
    "invite redemption checks recipient and assigns limited roles",
    async () => {
      await golfer.request("auth/register", "POST", {
        email: "golfer@example.com",
        password: "golfer-password-123",
        name: "Golfer",
        organisation: "Golfer Personal",
      });
      const invite = await admin.request(route("invites"), "POST", {
        email: "golfer@example.com",
        role: "player",
      });
      await outsider.request("join", "POST", { code: invite.code }, 400);
      await golfer.request("join", "POST", { code: invite.code });
      await golfer.request("join", "POST", { code: invite.code }, 400);
      await golfer.request(route("courses"), "POST", {}, 403);
      await golfer.request(route("members"), "GET", undefined, 403);
      const state = (await golfer.request(route("state"))).state;
      assert.equal(state.invoices.length, 1);
      assert.equal(state.invoices[0].playerId, player.id);
      assert.equal(
        state.players.find((p) => p.id === player.id).email,
        "golfer@example.com",
      );
      await scorer.request("auth/register", "POST", {
        email: "scorer@example.com",
        password: "scorer-password-123",
        name: "Marker",
        organisation: "Marker Club",
      });
      const i = await admin.request(route("invites"), "POST", {
        email: "scorer@example.com",
        role: "scorer",
      });
      await scorer.request("join", "POST", { code: i.code });
    },
  );
  await t.test(
    "players cannot override handicaps during self-registration",
    async () => {
      const e = await admin.request(route("events"), "POST", {
        name: "Self registration",
        date: "2027-07-01",
        format: "Stableford",
        capacity: 2,
      });
      await admin.request(route("events/" + e.id), "PATCH", {
        ...e,
        status: "Open",
      });
      const entry = await golfer.request(route("entries"), "POST", {
        eventId: e.id,
        playerId: player.id,
        handicap: -10,
      });
      assert.equal(entry.handicap, player.handicap);
    },
  );
  await t.test(
    "shared scoring handles validation, stale versions, permissions and attestation",
    async () => {
      await golfer.request(
        route("cards"),
        "POST",
        {
          roundId: round.id,
          playerId: second.id,
          scores: defaultPars,
          version: 0,
        },
        403,
      );
      await admin.request(
        route("cards"),
        "POST",
        {
          roundId: round.id,
          playerId: player.id,
          scores: [0, ...defaultPars.slice(1)],
          version: 0,
        },
        400,
      );
      const card = await scorer.request(route("cards"), "POST", {
        roundId: round.id,
        playerId: player.id,
        scores: defaultPars,
        version: 0,
        submit: true,
      });
      assert.equal(card.version, 1);
      await admin.request(
        route("cards"),
        "POST",
        {
          roundId: round.id,
          playerId: player.id,
          scores: defaultPars,
          version: 0,
        },
        409,
      );
      await scorer.request(
        route("cards/_/attest"),
        "POST",
        { roundId: round.id, playerId: player.id, version: 1 },
        403,
      );
      await admin.request(route("cards/_/attest"), "POST", {
        roundId: round.id,
        playerId: player.id,
        version: 1,
      });
      await admin.request(
        route("cards"),
        "POST",
        {
          roundId: round.id,
          playerId: player.id,
          scores: defaultPars,
          version: 2,
        },
        409,
      );
      await admin.request(
        route("rounds/" + round.id),
        "PATCH",
        { status: "Closed" },
        409,
      );
      await admin.request(route("cards"), "POST", {
        roundId: round.id,
        playerId: second.id,
        scores: defaultPars,
        version: 0,
        submit: true,
      });
      await scorer.request(route("cards/_/attest"), "POST", {
        roundId: round.id,
        playerId: second.id,
        version: 1,
      });
      const board = await golfer.request(
        route("leaderboard/" + event.id + "?round=" + round.id),
      );
      assert.equal(board.rows[0].playerId, player.id);
      assert.equal(board.rows[0].points, 54);
      assert.equal(board.teams[0].players, 2);
      await admin.request(route("rounds/" + round.id), "PATCH", {
        status: "Closed",
      });
      await golfer.request(
        route("cards"),
        "POST",
        {
          roundId: round.id,
          playerId: player.id,
          scores: defaultPars,
          version: 2,
        },
        409,
      );
      await admin.request(route("events/" + event.id), "PATCH", {
        ...event,
        status: "Completed",
      });
    },
  );
  await t.test("memberships, invoice records, notices and audit", async () => {
    const plan = await admin.request(route("plans"), "POST", {
      name: "Annual",
      amount: 100000,
    });
    await admin.request(route("subscriptions"), "POST", {
      playerId: player.id,
      planId: plan.id,
      start: "2027-01-01",
      end: "2027-12-31",
    });
    await admin.request(
      route("subscriptions"),
      "POST",
      {
        playerId: player.id,
        planId: plan.id,
        start: "2027-06-01",
        end: "2028-06-01",
      },
      409,
    );
    let state = (await admin.request(route("state"))).state;
    await golfer.request(
      route("invoices/" + state.invoices[0].id + "/paid"),
      "POST",
      { reference: "unauthorised" },
      403,
    );
    await admin.request(
      route("invoices/" + state.invoices[0].id + "/paid"),
      "POST",
      { reference: "Bank receipt 123" },
    );
    await admin.request(
      route("invoices/" + state.invoices[0].id + "/paid"),
      "POST",
      { reference: "Duplicate" },
      409,
    );
    await admin.request(route("announcements"), "POST", {
      title: "Club notice",
      body: "Welcome to the championship.",
    });
    state = (await admin.request(route("state"))).state;
    assert.equal(state.invoices[0].status, "Paid");
    assert.equal(state.announcements.length, 1);
    assert.ok(state.audit.length > 10);
    await admin.request(
      route("members/" + (await admin.request("auth/me")).user.id),
      "PATCH",
      { role: "player" },
      409,
    );
  });
  await t.test(
    "public leaderboard sharing is opt-in, limited and revocable",
    async () => {
      const guest = client();
      await guest.request("public/invalid", "GET", undefined, 404);
      await golfer.request(
        route("sharing"),
        "POST",
        { eventId: event.id, enabled: true },
        403,
      );
      const shared = await admin.request(route("sharing"), "POST", {
        eventId: event.id,
        enabled: true,
      });
      const d = await guest.request("public/" + shared.code);
      assert.equal(d.event.name, "Championship");
      assert.equal(d.rows.length, 2);
      assert.equal(JSON.stringify(d).includes("golfer@example.com"), false);
      assert.equal(d.audit, undefined);
      await admin.request(route("sharing"), "POST", {
        eventId: event.id,
        enabled: false,
      });
      await guest.request("public/" + shared.code, "GET", undefined, 404);
    },
  );
  await t.test(
    "tee sheet generation rejects slots already booked",
    async () => {
      const e = await admin.request(route("events"), "POST", {
        name: "Second event",
        date: "2027-06-11",
        format: "Stroke play",
        capacity: 2,
      });
      const r = await admin.request(route("rounds"), "POST", {
        eventId: e.id,
        courseId: course.id,
        date: "2027-06-11",
      });
      await admin.request(route("entries"), "POST", {
        eventId: e.id,
        playerId: player.id,
      });
      await admin.request(
        route("pairings"),
        "POST",
        {
          roundId: r.id,
          groupSize: 2,
          interval: 10,
          start: "2027-06-11T09:00:00Z",
          order: "Name",
        },
        409,
      );
      assert.equal(
        (await admin.request(route("state"))).state.teeTimes.filter(
          (t) => t.roundId === r.id,
        ).length,
        0,
      );
    },
  );
  await t.test("database and sessions survive server restart", async () => {
    await close();
    server = createApp({ database, secure: false });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
    const state = (await admin.request(route("state"))).state;
    assert.equal(state.players.length, 2);
    assert.equal(state.events[0].status, "Completed");
    assert.equal(state.announcements[0].title, "Club notice");
    await admin.request("auth/logout", "POST", {});
    await admin.request(route("state"), "GET", undefined, 401);
  });
});
