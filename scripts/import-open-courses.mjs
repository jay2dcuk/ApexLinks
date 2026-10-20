import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { openStore } from "../lib/store.js";
import { storeOpenCourses } from "../lib/open-course-data.js";
const file = process.argv[2],
  db = openStore(
    process.env.DATABASE_PATH || path.resolve("data/apexlinks.sqlite"),
  );
try {
  let data;
  if (file) {
    if ((await stat(file)).size > 128 * 1024 * 1024)
      throw Error("Split exports larger than 128 MB into smaller files.");
    data = JSON.parse(await readFile(file, "utf8"));
  } else {
    console.log(
      "Downloading openly licensed OpenStreetMap golf-course locations. Official tee ratings are not included.",
    );
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "ApexLinks-open-course-import/0.9",
      },
      body: new URLSearchParams({
        data: '[out:json][timeout:180];nwr["leisure"="golf_course"]["name"];out tags center;',
      }),
      signal: AbortSignal.timeout(200000),
    });
    if (!response.ok)
      throw Error(
        `OpenStreetMap download returned HTTP ${response.status}. Retry later or supply an authorised Overpass JSON export file; no fictional records were added.`,
      );
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 128 * 1024 * 1024)
      throw Error("Export exceeds 128 MB. Use smaller regional exports.");
    data = JSON.parse(raw);
  }
  const result = storeOpenCourses(db, data);
  console.log(
    `Imported ${result.imported} OpenStreetMap course locations; directory contains ${result.total}. ${result.attribution}`,
  );
  console.log(
    "Slope and course ratings remain unknown until authorised tee data is supplied. Existing club tee records and historical scores were not changed.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
