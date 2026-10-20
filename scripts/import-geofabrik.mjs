import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, statfs } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { openStore } from "../lib/store.js";
import { storeOpenCourses, openCourseVenues } from "../lib/open-course-data.js";
import { geofabrikIndex, geofabrikRegions } from "../lib/geofabrik.js";
const root = process.argv[2] || "",
  refresh = process.argv.includes("--refresh");
if (root === "--refresh")
  throw Error('Use a region ID or "world" before --refresh.');
const directory = path.dirname(fileURLToPath(import.meta.url));
const database =
  process.env.DATABASE_PATH || path.resolve("data/apexlinks.sqlite");
const cache = path.resolve(
  process.env.COURSE_DOWNLOAD_PATH || "data/course-download",
);
const python = process.env.COURSE_PYTHON || "python3";
const db = openStore(database),
  key = "geofabrik_bulk_regions";
const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
const completed = new Set(row ? JSON.parse(row.value) : []);
let imported = 0,
  work;
async function response(url, timeout) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    redirect: "error",
    headers: { "User-Agent": "ApexLinks-OSM-bulk-import/0.9.3" },
  });
  if (!res.ok) throw Error(`Bulk source returned HTTP ${res.status}: ${url}`);
  return res;
}
async function runPython(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      stdio: "inherit",
      env: { ...process.env, ...(work ? { TMPDIR: work } : {}) },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            Error(
              `OSM extractor stopped (${signal || code}). Region remains pending.`,
            ),
          ),
    );
  });
}
try {
  // Fail early if the optional tooling is not installed, before downloading large files.
  await runPython(["-c", "import osmium"]);
  const catalogue = await (await response(geofabrikIndex, 30000)).json();
  const regions = geofabrikRegions(catalogue, root === "world" ? "" : root);
  if (!regions.length) throw Error("No usable bulk regions in the catalogue.");
  await mkdir(cache, { recursive: true });
  work = await mkdtemp(path.join(cache, "import-"));
  console.log(
    `Source: Geofabrik/OpenStreetMap, ODbL. ${regions.length} leaf extracts selected. Coverage follows these extracts; it is not proof of every real-world course. Official ratings are not supplied.`,
  );
  for (const region of regions) {
    if (completed.has(region.id) && !refresh) {
      console.log(`Already saved: ${region.name}`);
      continue;
    }
    console.log(`Downloading ${region.name} (${region.id})…`);
    const pbf = path.join(work, "current.osm.pbf"),
      output = path.join(work, "courses.json");
    const checksumText = await (
      await response(region.url + ".md5", 30000)
    ).text();
    const expected = checksumText
      .match(/^([a-f0-9]{32})\s/i)?.[1]
      .toLowerCase();
    if (!expected)
      throw Error("The bulk source did not supply a valid checksum.");
    const res = await response(region.url, 3600000);
    const disk = await statfs(cache),
      budget = Math.floor((disk.bavail * disk.bsize) / 2);
    const size = Number(res.headers.get("content-length"));
    if (size > budget) {
      await res.body.cancel();
      throw Error(
        `Not enough free disk space for ${region.name}; extract requires ${size} bytes plus processing space.`,
      );
    }
    let bytes = 0;
    const hash = createHash("md5");
    const source = Readable.fromWeb(res.body);
    source.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
      if (bytes > budget)
        source.destroy(Error("Download exceeded available disk budget."));
    });
    await pipeline(source, createWriteStream(pbf));
    if (size && size !== bytes) throw Error("Incomplete bulk download.");
    if (hash.digest("hex") !== expected)
      throw Error(
        "Bulk download checksum mismatch. No courses imported from this region.",
      );
    await runPython([
      path.join(directory, "extract-osm-courses.py"),
      pbf,
      output,
    ]);
    const data = JSON.parse(await readFile(output, "utf8"));
    if (openCourseVenues(data).length)
      imported += storeOpenCourses(db, data).imported;
    completed.add(region.id);
    db.prepare(
      "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(key, JSON.stringify([...completed]));
    const total = db.prepare("SELECT COUNT(*) AS n FROM course_venues").get().n;
    console.log(
      `Saved ${region.name}; ${total} unique mapped locations in the database.`,
    );
    await rm(pbf, { force: true });
    await rm(output, { force: true });
    await pause(1000);
  }
  console.log(
    `Finished selected bulk regions; processed ${imported} course records (overlapping extracts are deduplicated). © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright`,
  );
} catch (error) {
  console.error(error.message);
  console.error(
    "Saved regions remain in the database. Rerun the same command to resume. No complete worldwide download is claimed.",
  );
  process.exitCode = 1;
} finally {
  if (work) await rm(work, { recursive: true, force: true });
  db.close();
}
