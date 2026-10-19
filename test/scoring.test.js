import { test } from "node:test";
import assert from "node:assert/strict";
import {
  holes,
  result,
  stableford,
  validateScore,
  scoreLabel,
} from "../public/domain.js";
test("partial rounds exclude unplayed holes", () => {
  assert.equal(result([3, 5, null]), 0);
  assert.equal(result([3, null, null]), -1);
});
test("par round gives 36 Stableford points for scratch", () =>
  assert.equal(stableford(holes, 0), 36));
test("18 handicap receives one stroke per hole", () =>
  assert.equal(stableford(holes, 18), 54));
test("score validation rejects zero, fractions, and excessive scores", () => {
  for (const n of [0, 21, 2.5, NaN]) assert.equal(validateScore(n), false);
  assert.equal(validateScore(4), true);
});
test("leaderboard labels", () => {
  assert.equal(scoreLabel(0), "E");
  assert.equal(scoreLabel(2), "+2");
  assert.equal(scoreLabel(-2), "-2");
});
