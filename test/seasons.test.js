import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../lib/store.js";
import { seasonStandings } from "../public/seasons.js";
import { seasonOperation } from "../lib/seasons-api.js";
import { defaultPars, defaultIndexes } from "../public/scoring.js";
function fixture() {
  const s = emptyState();
  for (const id of ["a", "b", "c"])
    s.players.push({ id, name: id.toUpperCase() });
  for (let i = 1; i <= 3; i++) {
    const eventId = "e" + i,
      roundId = "r" + i;
    s.events.push({
      id: eventId,
      name: "Cup " + i,
      date: `2027-0${i}-01`,
      status: "Completed",
      format: "Stroke play",
      tiebreak: "Shared",
    });
    s.rounds.push({
      id: roundId,
      eventId,
      status: "Closed",
      number: 1,
      pars: defaultPars,
      indexes: defaultIndexes,
    });
    for (const p of s.players) {
      s.entries.push({
        eventId,
        playerId: p.id,
        handicap: 0,
        division: "Open",
        status: "Registered",
      });
      const scores = [...defaultPars];
      if (p.id === "c") scores[0]++;
      else if ((i === 1 && p.id === "a") || (i === 2 && p.id === "b"))
        scores[0]--;
      s.cards.push({ roundId, playerId: p.id, scores, status: "Attested" });
    }
  }
  return s;
}
const op = (s, resource, b, extra = {}) =>
  seasonOperation(s, {
    resource,
    b,
    role: "admin",
    method: "POST",
    user: { name: "Admin" },
    ...extra,
  }).result;
const rule = {
  name: "Club season",
  start: "2027-01-01",
  end: "2027-12-31",
  division: "Open",
  points: [100, 75, 60],
  bestOf: 2,
  minEvents: 3,
};
test("season standings average occupied tie points, apply weights, drop results and share final rank", () => {
  const s = fixture(),
    season = op(s, "seasons", rule);
  for (let i = 1; i <= 3; i++)
    op(s, "season-events", {
      seasonId: season.id,
      eventId: "e" + i,
      weight: i === 3 ? 2 : 1,
    });
  const rows = seasonStandings(s, season);
  assert.equal(rows[0].points, 275);
  assert.equal(rows[1].points, 275);
  assert.equal(rows[0].counted, 2);
  assert.equal(rows[0].played, 3);
  assert.equal(rows[0].position, 1);
  assert.equal(rows[1].position, 1);
  assert.equal(rows[2].position, 3);
  assert.equal(rows[2].points, 180);
  assert.equal(rows[0].results.filter((r) => !r.counted).length, 1);
});
test("finalised seasons freeze results until an authorised, reasoned reopening", () => {
  const s = fixture(),
    season = op(s, "seasons", { ...rule, minEvents: 1 });
  op(s, "season-events", { seasonId: season.id, eventId: "e1" });
  op(s, "seasons", {}, { resourceId: season.id, action: "finalise" });
  const frozen = seasonStandings(s, season);
  s.events[0].status = "Live";
  assert.deepEqual(seasonStandings(s, season), frozen);
  assert.throws(
    () => op(s, "season-events", { seasonId: season.id, eventId: "e2" }),
    /Reopen/,
  );
  assert.throws(
    () =>
      op(
        s,
        "seasons",
        { reason: "Correction" },
        { resourceId: season.id, action: "reopen", role: "player" },
      ),
    /Only organisers/,
  );
  assert.throws(
    () =>
      op(
        s,
        "seasons",
        { reason: "" },
        { resourceId: season.id, action: "reopen" },
      ),
    /reason/,
  );
  op(
    s,
    "seasons",
    { reason: "Round correction" },
    { resourceId: season.id, action: "reopen" },
  );
  assert.equal(seasonStandings(s, season).length, 0);
  assert.equal(season.revisions[0].reason, "Round correction");
  assert.throws(
    () => op(s, "seasons", {}, { resourceId: season.id, action: "finalise" }),
    /Complete every/,
  );
});
test("season rules reject duplicates, invalid points, incompatible formats and out-of-period events", () => {
  const s = fixture();
  assert.throws(() => op(s, "seasons", { ...rule, points: [75, 100] }));
  const season = op(s, "seasons", rule);
  op(s, "season-events", { seasonId: season.id, eventId: "e1" });
  assert.throws(
    () => op(s, "season-events", { seasonId: season.id, eventId: "e1" }),
    /already linked/,
  );
  s.events[1].format = "Scramble";
  assert.throws(
    () => op(s, "season-events", { seasonId: season.id, eventId: "e2" }),
    /individual/,
  );
  s.events[2].date = "2028-01-01";
  assert.throws(
    () => op(s, "season-events", { seasonId: season.id, eventId: "e3" }),
    /season dates/,
  );
  assert.throws(() => op(s, "seasons", {}, { method: "DELETE" }), /not found/);
});
