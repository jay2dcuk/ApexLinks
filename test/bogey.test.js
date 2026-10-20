import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bogeyScore,
  leaderboard,
  defaultPars,
  defaultIndexes,
} from "../public/scoring.js";
import { emptyState } from "../lib/store.js";
test("Bogey / Par counts won and lost holes once, applies strokes and ignores blanks", () => {
  assert.equal(bogeyScore(defaultPars, defaultPars, defaultIndexes, 0), 0);
  assert.equal(bogeyScore(defaultPars, defaultPars, defaultIndexes, 18), 18);
  assert.equal(bogeyScore(defaultPars, defaultPars, defaultIndexes, -18), -18);
  assert.equal(bogeyScore([2, 10, null], defaultPars, defaultIndexes, 0), 0);
});
test("Bogey standings rank high totals first, use final-hole countback and keep unplayed golfers below played losses", () => {
  const s = emptyState(),
    event = { id: "e", format: "Bogey / Par", tiebreak: "Countback" };
  s.events.push(event);
  s.rounds.push({
    id: "r",
    eventId: "e",
    number: 1,
    pars: defaultPars,
    indexes: defaultIndexes,
  });
  for (const id of ["early", "late", "loss", "blank"]) {
    s.players.push({ id, name: id });
    s.entries.push({
      eventId: "e",
      playerId: id,
      handicap: 0,
      division: "Open",
      status: "Registered",
    });
    if (id !== "blank") {
      const scores = [...defaultPars];
      if (id === "early") scores[0]--;
      if (id === "late") scores[17]--;
      if (id === "loss") scores[0] += 3;
      s.cards.push({ roundId: "r", playerId: id, scores, status: "Attested" });
    }
  }
  const rows = leaderboard(s, event);
  assert.deepEqual(
    rows.map((r) => r.playerId),
    ["late", "early", "loss", "blank"],
  );
  assert.equal(rows[0].bogey, 1);
  assert.equal(rows[2].bogey, -1);
  assert.equal(rows[3].position, null);
});
