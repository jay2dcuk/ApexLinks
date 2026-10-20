import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { openStore, emptyState } from "../lib/store.js";
import { storeOpenCourses } from "../lib/open-course-data.js";
import { createCourseDirectory } from "../lib/course-directory.js";
const fixture = {
  elements: [
    {
      type: "way",
      id: 123,
      tags: {
        name: "Fictional Open Links",
        leisure: "golf_course",
        "addr:country": "GB",
      },
      center: { lat: 56, lon: -3 },
    },
    { type: "way", id: 999, tags: { name: "Not a course", leisure: "park" } },
  ],
};
test("open-data imports upsert only named golf venues and preserve club scoring data", async () => {
  const db = openStore(":memory:");
  try {
    db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
      "o",
      "Club",
      JSON.stringify(emptyState()),
    );
    assert.equal(storeOpenCourses(db, fixture).imported, 1);
    assert.equal(storeOpenCourses(db, fixture).total, 1);
    assert.equal(
      JSON.parse(db.prepare("SELECT state FROM orgs").get().state).courses
        .length,
      0,
    );
    assert.throws(() =>
      storeOpenCourses(db, { elements: [], remark: "timeout" }),
    );
    assert.throws(() => storeOpenCourses(db, { elements: [] }));
    const directory = createCourseDirectory(db, {
      fetcher: async () => {
        throw Error("must use local data");
      },
    });
    const result = await directory.search("o", "Open Links", "GB");
    assert.equal(result.venues.length, 1);
    assert.equal(result.venues[0].rating, null);
    assert.equal(result.venues[0].slope, null);
    assert.equal(
      result.venues[0].directoryURL,
      "https://www.openstreetmap.org/way/123",
    );
    storeOpenCourses(db, {
      elements: [
        {
          type: "way",
          id: 124,
          tags: {
            name: "Fictional Évian Course",
            leisure: "golf_course",
            "addr:country": "gb",
          },
        },
      ],
    });
    const accented = await directory.search("o", "evian", "GB");
    assert.equal(accented.venues[0].name, "Fictional Évian Course");
    await directory.stop();
  } finally {
    db.close();
  }
});
test("background downloads persist honest success/failure status and enforce retry cooldowns", async () => {
  const db = openStore(":memory:");
  const directory = createCourseDirectory(db, {
    regions: [[49, -11, 61, 3]],
    downloadDelay: 0,
    fetcher: async () => ({
      ok: true,
      text: async () => JSON.stringify(fixture),
    }),
  });
  try {
    assert.equal(directory.downloadStatus().status, "Not started");
    directory.startDownload();
    assert.throws(() => directory.startDownload(), /already running/);
    await setImmediate();
    const done = directory.downloadStatus();
    assert.equal(done.status, "Completed");
    assert.equal(done.total, 1);
    assert.throws(() => directory.startDownload(), /Wait|updated recently/);
    db.prepare("DELETE FROM settings WHERE key='open_course_download'").run();
    const denied = createCourseDirectory(db, {
      regions: [[49, -11, 61, 3]],
      downloadDelay: 0,
      fetcher: async () => ({ ok: false, status: 403 }),
    });
    denied.startDownload();
    await setImmediate();
    assert.equal(denied.downloadStatus().status, "Failed");
    assert.match(denied.downloadStatus().error, /HTTP 403/);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM course_venues").get().count,
      1,
    );
    await denied.stop();
  } finally {
    await directory.stop();
    db.close();
  }
});

test("command-line importer reads an offline export and is idempotent against persistent SQLite", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { execFileSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "apex-open-import-")),
    file = join(directory, "venues.json"),
    database = join(directory, "courses.sqlite");
  try {
    writeFileSync(file, JSON.stringify(fixture));
    for (let i = 0; i < 2; i++) {
      const output = execFileSync(
        process.execPath,
        ["scripts/import-open-courses.mjs", file],
        {
          cwd: process.cwd(),
          env: { ...process.env, DATABASE_PATH: database },
          encoding: "utf8",
        },
      );
      assert.match(
        output,
        /Imported 1 OpenStreetMap course locations; directory contains 1/,
      );
    }
    const db = openStore(database);
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM course_venues").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM orgs").get().count,
        0,
      );
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("regional downloads retain progress, fall back, and resume the failed region without repeating saved regions", async () => {
  const db = openStore(":memory:"),
    requests = [];
  const regions = [
    [49, -11, 61, 3],
    [0, 0, 30, 30],
    [30, 30, 60, 60],
  ];
  let available = false;
  const directory = createCourseDirectory(db, {
    regions,
    downloadDelay: 0,
    fetcher: async (url, options) => {
      const query = options.body.get("data");
      requests.push({ url, query });
      assert.match(query, /\[timeout:25\]/);
      assert.ok(options.signal);
      if (query.includes("(0,0,30,30)") && !available)
        return { ok: false, status: 504 };
      // The final region is empty; it must still be recorded as completed.
      return {
        ok: true,
        text: async () =>
          JSON.stringify(
            query.includes("(30,30,60,60)") ? { elements: [] } : fixture,
          ),
      };
    },
  });
  try {
    directory.startDownload();
    await setImmediate();
    const failed = directory.downloadStatus();
    assert.equal(failed.status, "Failed");
    assert.equal(failed.total, 1);
    assert.equal(failed.completedRegions, 1);
    assert.equal(failed.remainingRegions, 2);
    assert.equal(requests.length, 3);
    assert.notEqual(requests[1].url, requests[2].url);
    assert.throws(() => directory.startDownload(), /one minute/);
    const row = db
      .prepare("SELECT value FROM settings WHERE key='open_course_download'")
      .get();
    const saved = JSON.parse(row.value);
    saved.finishedAt = new Date(Date.now() - 61000).toISOString();
    db.prepare(
      "UPDATE settings SET value=? WHERE key='open_course_download'",
    ).run(JSON.stringify(saved));
    available = true;
    // A new worker models a server restart using the same durable checkpoint.
    const resumed = createCourseDirectory(db, {
      regions,
      downloadDelay: 0,
      fetcher: async (url, options) => {
        const query = options.body.get("data");
        assert.ok(!query.includes("(49,-11,61,3)"));
        requests.push({ url, query });
        return {
          ok: true,
          text: async () =>
            JSON.stringify(
              query.includes("(30,30,60,60)") ? { elements: [] } : fixture,
            ),
        };
      },
    });
    resumed.startDownload();
    await setImmediate();
    const done = resumed.downloadStatus();
    assert.equal(done.status, "Completed");
    assert.equal(done.completedRegions, 3);
    assert.equal(done.remainingRegions, 0);
    assert.equal(done.total, 1); // Overlaps are upserts, never duplicate courses.
    assert.equal(done.imported, 1);
    assert.equal(requests.length, 5);
    await resumed.stop();
  } finally {
    await directory.stop();
    db.close();
  }
});

test("server shutdown aborts a regional request without losing the previous region", async () => {
  const db = openStore(":memory:");
  let requests = 0;
  const directory = createCourseDirectory(db, {
    regions: [
      [49, -11, 61, 3],
      [0, 0, 30, 30],
    ],
    downloadDelay: 0,
    fetcher: async (_url, { signal }) => {
      requests++;
      if (requests === 1)
        return { ok: true, text: async () => JSON.stringify(fixture) };
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  try {
    directory.startDownload();
    await setImmediate();
    assert.equal(directory.downloadStatus().completedRegions, 1);
    await directory.stop();
    const stopped = directory.downloadStatus();
    assert.equal(stopped.status, "Interrupted");
    assert.equal(stopped.total, 1);
    assert.equal(stopped.remainingRegions, 1);
    assert.equal(requests, 2);
  } finally {
    await directory.stop();
    db.close();
  }
});
