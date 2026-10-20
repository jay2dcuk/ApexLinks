import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../lib/store.js";
import { operationsOperation } from "../lib/operations-api.js";
import { competitionOperation } from "../lib/competition-api.js";
import { defaultPars, defaultIndexes, leaderboard } from "../public/scoring.js";
import {
  eventReadiness,
  paceStatus,
  reportRows,
} from "../public/operations.js";
function fixture(format = "Stroke play") {
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
    name: "Cup",
    date: "2027-06-10",
    format,
    status: "Open",
    capacity: 72,
    fee: 0,
    tiebreak: "Shared",
  });
  s.rounds.push({
    id: "r",
    eventId: "e",
    number: 1,
    date: "2027-06-10",
    courseId: "c",
    pars: defaultPars,
    indexes: defaultIndexes,
    status: "Open",
  });
  for (let i = 0; i < 3; i++) {
    s.players.push({
      id: "p" + i,
      name: "Player " + i,
      email: `p${i}@example.com`,
      handicap: 0,
    });
    s.entries.push({
      id: "e" + i,
      eventId: "e",
      playerId: "p" + i,
      handicap: 0,
      status: "Registered",
    });
  }
  return s;
}
const user = { user_id: "u", name: "Admin", email: "admin@example.com" };
test("report layouts validate options, edit in place and delete with staff permissions", () => {
  const s = fixture();
  const body = {
    name: "Roster",
    dataset: "players",
    columns: ["name", "handicap"],
    orientation: "landscape",
    subtitle: "Morning field",
    footer: "Starter copy",
    showTotals: true,
  };
  const view = op(s, "report-views", body);
  assert.equal(view.orientation, "landscape");
  assert.throws(() =>
    op(s, "report-views", { ...body, orientation: "arbitrary" }),
  );
  assert.throws(() => op(s, "report-views", body, { role: "player" }));
  op(
    s,
    "report-views",
    { ...body, name: "Revised roster" },
    { resourceId: view.id },
  );
  assert.equal(s.reportViews.length, 1);
  assert.equal(s.reportViews[0].name, "Revised roster");
  assert.throws(() =>
    op(
      s,
      "report-views",
      {},
      { resourceId: view.id, method: "DELETE", role: "viewer" },
    ),
  );
  op(s, "report-views", {}, { resourceId: view.id, method: "DELETE" });
  assert.equal(s.reportViews.length, 0);
});
function op(s, resource, b, extra = {}) {
  return operationsOperation(s, {
    resource,
    b,
    role: "admin",
    user,
    method: "POST",
    ...extra,
  }).result;
}
function comp(s, resource, b, extra = {}) {
  return competitionOperation(s, {
    resource,
    b,
    role: "admin",
    user,
    method: "POST",
    ...extra,
  }).result;
}
test("odd knockout fields receive top-seed byes and valid next stages", () => {
  const s = fixture("Match play");
  comp(s, "matches", { roundId: "r" });
  assert.equal(s.matches.length, 2);
  assert.equal(s.matches[0].winner, "p0");
  assert.equal(s.matches[0].result, "Bye");
  assert.throws(
    () =>
      comp(s, "matches", {}, { resourceId: s.matches[0].id, action: "reopen" }),
    /bye/,
  );
  const actual = s.matches.find((m) => m.status === "Active");
  comp(
    s,
    "matches",
    { winner: actual.playerA, reason: "Conceded" },
    { resourceId: actual.id, action: "finalise" },
  );
  s.rounds.push({ ...s.rounds[0], id: "r2", number: 2 });
  comp(s, "matches", { roundId: "r2" });
  assert.equal(s.matches[2].playerA, "p0");
  assert.ok(s.matches[2].playerB);
});
test("a tied regulation match can record and finalise actual extra holes", () => {
  const s = fixture("Match play");
  s.entries.pop();
  comp(s, "matches", { roundId: "r" });
  for (const p of ["p0", "p1"])
    s.cards.push({
      roundId: "r",
      playerId: p,
      scores: [...defaultPars],
      version: 1,
      status: "Submitted",
    });
  const match = s.matches[0];
  op(s, "playoff-holes", {
    matchId: match.id,
    version: 0,
    hole: 1,
    scoreA: 4,
    scoreB: 4,
  });
  assert.throws(
    () =>
      op(s, "playoff-holes", {
        matchId: match.id,
        version: 0,
        hole: 2,
        scoreA: 3,
        scoreB: 4,
      }),
    /changed/,
  );
  op(s, "playoff-holes", {
    matchId: match.id,
    version: 1,
    hole: 2,
    scoreA: 3,
    scoreB: 4,
  });
  comp(s, "matches", {}, { resourceId: match.id, action: "finalise" });
  assert.equal(match.winner, "p0");
  assert.match(match.result, /playoff hole 2/);
});
test("shotgun generation assigns unique groups, protects reservations, and locks after scoring", () => {
  const s = fixture();
  const start = "2027-06-10T09:00:00Z";
  op(s, "shotgun", {
    roundId: "r",
    start,
    groupSize: 2,
    groupsPerHole: 1,
    holes: [1, 10],
  });
  assert.deepEqual(
    s.teeTimes.map((t) => t.hole),
    [1, 10],
  );
  assert.equal(new Set(s.teeTimes.flatMap((t) => t.playerIds)).size, 3);
  s.bookings.push({
    courseId: "c",
    status: "Confirmed",
    start: "2027-06-10T10:00:00Z",
  });
  assert.throws(
    () =>
      op(s, "shotgun", { roundId: "r", start, groupSize: 2, holes: [1, 10] }),
    /overlaps/,
  );
  s.bookings = [];
  s.cards.push({ roundId: "r" });
  assert.throws(
    () =>
      op(s, "shotgun", { roundId: "r", start, groupSize: 2, holes: [1, 10] }),
    /locked/,
  );
});
test("individual tee snapshots affect scoring, but cannot be changed after play", () => {
  const s = fixture();
  s.courses.push({
    ...s.courses[0],
    id: "yellow",
    tee: "Yellow",
    pars: defaultPars.map((p, i) => (i === 0 ? 3 : p)),
  });
  op(s, "round-tees", {
    roundId: "r",
    playerId: "p0",
    courseId: "yellow",
    handicap: 18,
  });
  s.cards.push({
    roundId: "r",
    playerId: "p0",
    scores: [3, ...Array(17).fill(null)],
  });
  const row = leaderboard(s, s.events[0]).find((p) => p.playerId === "p0");
  assert.equal(row.toPar, 0);
  assert.equal(row.points, 3);
  assert.throws(
    () =>
      op(s, "round-tees", {
        roundId: "r",
        playerId: "p0",
        courseId: "yellow",
        handicap: 10,
      }),
    /locked/,
  );
});
test("marker assignment validates identity and organisation membership", () => {
  const s = fixture();
  assert.throws(
    () =>
      op(s, "markers", { roundId: "r", playerId: "p0", markerPlayerId: "p0" }),
    /different/,
  );
  assert.throws(
    () =>
      op(s, "markers", { roundId: "r", playerId: "p0", markerPlayerId: "p1" }),
    /organisation/,
  );
  op(
    s,
    "markers",
    { roundId: "r", playerId: "p0", markerPlayerId: "p1" },
    { orgMembers: [{ email: "p1@example.com", role: "player" }] },
  );
  assert.equal(s.markerAssignments[0].markerPlayerId, "p1");
});
test("template application copies configuration and dates without private entries or public links", () => {
  const s = fixture();
  s.events[0].publicCode = "private-link";
  const template = op(s, "templates", { eventId: "e", name: "Monthly cup" });
  const event = op(
    s,
    "templates",
    { name: "July Cup", date: "2027-07-10" },
    { resourceId: template.id, action: "apply" },
  );
  assert.equal(event.status, "Draft");
  assert.equal(event.publicCode, null);
  assert.equal(s.entries.filter((e) => e.eventId === event.id).length, 0);
  assert.equal(s.rounds.find((r) => r.eventId === event.id).date, "2027-07-10");
});
test("pace checkpoints are monotonic, enforce group ownership, and reflect actual delay", () => {
  const s = fixture(),
    start = new Date(Date.now() - 90 * 60000).toISOString();
  s.teeTimes.push({ id: "t", roundId: "r", playerIds: ["p0"], start });
  assert.throws(
    () =>
      op(
        s,
        "checkpoints",
        { teeId: "t", completed: 4, at: new Date().toISOString() },
        { role: "player", user: { ...user, email: "p1@example.com" } },
      ),
    /own group/,
  );
  op(s, "checkpoints", {
    teeId: "t",
    completed: 4,
    at: new Date().toISOString(),
  });
  assert.throws(
    () =>
      op(s, "checkpoints", {
        teeId: "t",
        completed: 3,
        at: new Date().toISOString(),
      }),
    /advance/,
  );
  assert.equal(paceStatus(s, "t").risk, "Behind pace");
  assert.equal(paceStatus(s, "t").delay, 34);
});
test("reports constrain datasets and columns; tasks, messages and incidents are role checked", () => {
  const s = fixture();
  assert.throws(
    () =>
      op(s, "report-views", {
        name: "Leak",
        dataset: "users",
        columns: ["password"],
      }),
    /dataset/,
  );
  const view = op(s, "report-views", {
    name: "Roster",
    dataset: "players",
    columns: ["name", "handicap"],
  });
  assert.deepEqual(Object.keys(reportRows(s, view)[0]), ["name", "handicap"]);
  assert.throws(
    () =>
      op(
        s,
        "messages",
        { title: "Hi", body: "Text", playerIds: [] },
        { role: "player" },
      ),
    /organisers/,
  );
  const message = op(s, "messages", {
    title: "Hello",
    body: "Text",
    playerIds: ["p0"],
  });
  assert.throws(
    () =>
      op(
        s,
        "receipts",
        { messageId: message.id },
        { role: "player", user: { ...user, email: "p1@example.com" } },
      ),
    /addressed/,
  );
  op(
    s,
    "receipts",
    { messageId: message.id },
    { role: "player", user: { ...user, email: "p0@example.com" } },
  );
  op(
    s,
    "receipts",
    { messageId: message.id },
    { role: "player", user: { ...user, email: "p0@example.com" } },
  );
  assert.equal(s.receipts.length, 1);
  const task = op(
    s,
    "tasks",
    { title: "Prepare cards", due: "2027-06-10", assignee: "member" },
    { orgMembers: [{ id: "member" }] },
  );
  assert.throws(
    () =>
      op(
        s,
        "tasks",
        { status: "Done" },
        { role: "player", resourceId: task.id, method: "PATCH" },
      ),
    /assignee/,
  );
  op(
    s,
    "tasks",
    { status: "Done" },
    {
      role: "player",
      resourceId: task.id,
      method: "PATCH",
      user: { ...user, user_id: "member" },
    },
  );
  assert.equal(task.status, "Done");
  assert.equal(eventReadiness(s, "e").percent, 60);
});
