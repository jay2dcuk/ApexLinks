import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { fail } from "./validation.js";
import { openCourseVenues, storeOpenCourses } from "./open-course-data.js";
const jobKey = "open_course_download";
// Start with Britain/Ireland, then cover the world in bounded requests.
export const courseRegions = [
  [49, -11, 61, 3],
  ...Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 12 }, (_, col) => [
      -90 + row * 30,
      -180 + col * 30,
      -60 + row * 30,
      -150 + col * 30,
    ]),
  ).flat(),
];
const providers = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
export function createOpenCourseDownload(
  db,
  { fetcher = fetch, regions = courseRegions, downloadDelay = 1000 } = {},
) {
  let active = null,
    controller = null;
  const total = () =>
    db.prepare("SELECT COUNT(*) AS total FROM course_venues").get().total;
  const read = () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(jobKey);
    return row
      ? JSON.parse(row.value)
      : { status: "Not started", imported: 0, total: total() };
  };
  const save = (job) =>
    db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(jobKey, JSON.stringify(job));
  const publicJob = ({ pending, ...job }) => ({
    ...job,
    total: total(),
    remainingRegions: pending?.length,
  });
  async function fetchRegion(bounds, signal) {
    let lastError;
    for (const provider of providers) {
      signal.throwIfAborted();
      try {
        const response = await fetcher(provider, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "ApexLinks-open-course-import/0.9.2",
          },
          body: new URLSearchParams({
            data: `[out:json][timeout:25];nwr["leisure"="golf_course"]["name"](${bounds.join(",")});out tags center;`,
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
        });
        if (!response.ok)
          throw Error(`OpenStreetMap returned HTTP ${response.status}.`);
        let raw;
        if (response.body?.[Symbol.asyncIterator]) {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > 32 * 1024 * 1024)
              throw Error("The region exceeds the 32 MB web limit.");
            chunks.push(chunk);
          }
          raw = Buffer.concat(chunks, bytes).toString("utf8");
        } else {
          raw = await response.text();
          if (Buffer.byteLength(raw) > 32 * 1024 * 1024)
            throw Error("The region exceeds the 32 MB web limit.");
        }
        const data = JSON.parse(raw);
        openCourseVenues(data); // Reject partial/remark responses before committing progress.
        signal.throwIfAborted();
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
  return {
    downloadStatus() {
      const job = read();
      return publicJob(
        ["Downloading", "Importing"].includes(job.status) &&
          job.leaseUntil < Date.now()
          ? {
              ...job,
              status: "Interrupted",
              error:
                "The server stopped during a region. Resume to continue; saved locations remain available.",
            }
          : job,
      );
    },
    startDownload() {
      db.exec("BEGIN IMMEDIATE");
      let job;
      try {
        const current = read(),
          now = Date.now();
        if (
          ["Downloading", "Importing"].includes(current.status) &&
          current.leaseUntil > now
        )
          fail(409, "A course directory download is already running.");
        if (
          current.status === "Completed" &&
          now - Date.parse(current.finishedAt) < 86400000
        )
          fail(
            429,
            "The open directory was updated recently. Wait 24 hours before downloading again.",
          );
        // Old all-world failures are eligible immediately; new regional retries have a short cooldown.
        if (
          current.pending &&
          current.finishedAt &&
          now - Date.parse(current.finishedAt) < 60000
        )
          fail(429, "Wait one minute before resuming the directory download.");
        const resume =
          Array.isArray(current.pending) && current.pending.length > 0;
        job = {
          id: randomUUID(),
          status: "Downloading",
          startedAt: new Date().toISOString(),
          leaseUntil: now + 120000,
          pending: resume
            ? current.pending
            : regions.map((bounds) => [...bounds]),
          completedRegions: resume ? current.completedRegions : 0,
          plannedRegions: resume ? current.plannedRegions : regions.length,
          initialTotal: resume ? (current.initialTotal ?? total()) : total(),
          imported: resume ? current.imported : 0,
          total: total(),
          error: "",
        };
        save(job);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      controller = new AbortController();
      const signal = controller.signal;
      active = (async () => {
        try {
          while (job.pending.length) {
            job.status = "Downloading";
            job.leaseUntil = Date.now() + 120000;
            save(job);
            const data = await fetchRegion(job.pending[0], signal);
            signal.throwIfAborted();
            job.status = "Importing";
            save(job);
            const venues = openCourseVenues(data);
            // Empty ocean regions are successful, not failed imports.
            if (venues.length) {
              storeOpenCourses(db, data);
            }
            job.imported = total() - job.initialTotal;
            job.total = total();
            job.completedRegions++;
            job.pending.shift();
            job.status = "Downloading";
            save(job);
            if (job.pending.length && downloadDelay)
              await pause(downloadDelay, undefined, { signal });
          }
          Object.assign(job, {
            status: "Completed",
            finishedAt: new Date().toISOString(),
            leaseUntil: 0,
          });
          save(job);
        } catch (error) {
          const timedOut =
            error.name === "TimeoutError" ||
            /timeout/i.test(error.message || "");
          Object.assign(job, {
            status: signal.aborted ? "Interrupted" : "Failed",
            finishedAt: new Date().toISOString(),
            leaseUntil: 0,
            error: signal.aborted
              ? "The server stopped. Resume to continue from the last saved region."
              : `${timedOut ? "The regional download timed out on both public providers." : String(error.message || "Directory download failed.").slice(0, 180)} Saved locations are retained. Resume after one minute, or import an OpenStreetMap export file.`,
            total: total(),
          });
          save(job);
        }
      })()
        .catch(() =>
          console.error("Open-course download status could not be persisted."),
        )
        .finally(() => {
          active = null;
          controller = null;
        });
      return publicJob(job);
    },
    async stop() {
      controller?.abort();
      if (active) await active;
    },
  };
}
