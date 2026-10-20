import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server.js";
import { openStore } from "../lib/store.js";
import { courseData } from "../lib/validation.js";
import {
  courseSnapshot,
  attestedRoundRecord,
  calculateHandicap,
  sameVenue,
} from "../public/courses.js";
import { defaultPars, defaultIndexes } from "../public/scoring.js";
import { createCourseDirectory } from "../lib/course-directory.js";
const tee = {
  name: "Fictional Test Links",
  tee: "White",
  location: "Testtown",
  country: "GB",
  ratedFor: "Men",
  pars: defaultPars,
  indexes: defaultIndexes,
  rating: 71.8,
  slope: 128,
  ratingAsOf: "2026-10-01",
  ratingSource: "Fictional test fixture",
  sourceURL: "https://example.com/ratings",
  lengths: Array(18).fill(350),
  lengthUnit: "yards",
};
test("course validation preserves provenance and categories, rejects unsafe sources and invalid hole data", () => {
  const row = courseData({ ...tee, verified: true });
  assert.throws(() => courseData(null));
  assert.equal(row.verified, false);
  assert.equal(row.slope, 128);
  assert.throws(() => courseData({ ...tee, slope: 156 }));
  assert.throws(() => courseData({ ...tee, sourceURL: "javascript:alert(1)" }));
  assert.throws(() => courseData({ ...tee, indexes: Array(18).fill(1) }));
  assert.throws(() => courseData({ ...tee, lengths: [20] }));
  assert.equal(sameVenue(tee, { ...tee, location: "Another town" }), false);
  assert.equal(calculateHandicap(12.4, row, 95).playingHandicap, 13);
  assert.equal(
    calculateHandicap(54, { ...row, rating: 75, slope: 155 }, 100)
      .playingHandicap,
    77,
  );
});
test("historical exports use captured ratings and individual tees without substituting current or base ratings", () => {
  const snapshot = courseSnapshot(tee),
    s = {
      players: [{ id: "p", name: "Golfer" }],
      events: [{ id: "e", format: "Net stroke" }],
      courses: [{ ...tee, rating: 80 }],
      rounds: [
        {
          id: "r",
          eventId: "e",
          date: "2026-10-01",
          pars: defaultPars,
          indexes: defaultIndexes,
          courseSnapshot: snapshot,
        },
      ],
      roundTees: [],
    },
    card = { playerId: "p", roundId: "r", scores: defaultPars };
  assert.equal(attestedRoundRecord(s, card).courseRating, 71.8);
  s.roundTees.push({
    roundId: "r",
    playerId: "p",
    tee: "Red",
    pars: defaultPars,
    indexes: defaultIndexes,
    rating: null,
    slope: null,
  });
  assert.equal(attestedRoundRecord(s, card).courseRating, null);
  s.roundTees = [];
  delete s.rounds[0].courseSnapshot;
  assert.equal(attestedRoundRecord(s, card).courseRating, null);
});
test("world directory safely escapes queries, caches results and never invents ratings", async () => {
  const db = openStore(":memory:");
  let calls = 0;
  const directory = createCourseDirectory(db, {
    fetcher: async (url, opts) => {
      calls++;
      assert.equal(url, "https://overpass-api.de/api/interpreter");
      assert.ok(opts.body.get("data").includes('area["ISO3166-1"="GB"]'));
      return {
        ok: true,
        json: async () => ({
          elements: [
            {
              type: "way",
              id: 123,
              tags: { name: "Test Links", "addr:city": "Testtown" },
              center: { lat: 56, lon: -3 },
            },
          ],
        }),
      };
    },
  });
  try {
    const first = await directory.search("o", "Test.*", "GB");
    assert.equal(first.venues[0].rating, null);
    assert.equal(first.venues[0].slope, null);
    assert.match(first.attribution, /OpenStreetMap/);
    await directory.search("o", "Test.*", "GB");
    assert.equal(calls, 1);
    await assert.rejects(() => directory.search("o", "x", "GB"));
    await assert.rejects(() => directory.search("o", "Other", "../"));
  } finally {
    db.close();
  }
});
test("course bulk import is atomic and persisted round rating snapshots survive course corrections", async () => {
  const server = createApp({ database: ":memory:", secure: false });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  let cookie = "",
    csrf = "";
  const call = async (path, body, expected = 200, method = "POST") => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data));
    if (res.headers.getSetCookie().length)
      cookie = res.headers.getSetCookie()[0].split(";")[0];
    return data;
  };
  try {
    const auth = await call("auth/register", {
      name: "Course Admin",
      email: "courses@example.com",
      password: "course-testing-password",
      organisation: "Course Test Club",
    });
    csrf = auth.csrf;
    const route = "orgs/" + auth.organisations[0].id + "/";
    await call(
      route + "course-import",
      { courses: [tee, { ...tee, tee: "Red", slope: 200 }] },
      400,
    );
    assert.equal(
      (await call(route + "state", null, 200, "GET")).state.courses.length,
      0,
    );
    await call(route + "course-import", {
      courses: [tee, { ...tee, tee: "Red", ratedFor: "Women", rating: 73.2 }],
    });
    let state = (await call(route + "state", null, 200, "GET")).state;
    assert.equal(state.courses.length, 2);
    await call(route + "course-import", { courses: [tee] }, 409);
    const event = await call(route + "events", {
      name: "Test Cup",
      date: "2027-01-01",
      format: "Net stroke",
      capacity: 20,
      fee: 0,
    });
    const round = await call(route + "rounds", {
      eventId: event.id,
      courseId: state.courses[0].id,
      date: "2027-01-01",
    });
    assert.equal(round.courseSnapshot.rating, 71.8);
    await call(
      route + "courses/" + state.courses[0].id,
      { ...tee, rating: 75, slope: 140 },
      200,
      "PATCH",
    );
    state = (await call(route + "state", null, 200, "GET")).state;
    assert.equal(state.courses[0].rating, 75);
    assert.equal(state.rounds[0].courseSnapshot.rating, 71.8);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
