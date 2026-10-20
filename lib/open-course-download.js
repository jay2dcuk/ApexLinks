import { randomUUID } from "node:crypto";
import { fail } from "./validation.js";
import { storeOpenCourses } from "./open-course-data.js";
const jobKey = "open_course_download";
export function createOpenCourseDownload(db, { fetcher = fetch } = {}) {
  let active = null,
    controller = null;
  const read = () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(jobKey);
    return row
      ? JSON.parse(row.value)
      : {
          status: "Not started",
          imported: 0,
          total: db.prepare("SELECT COUNT(*) AS total FROM course_venues").get()
            .total,
        };
  };
  const save = (job) =>
    db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(jobKey, JSON.stringify(job));
  return {
    downloadStatus() {
      const job = read();
      return ["Downloading", "Importing"].includes(job.status) &&
        job.leaseUntil < Date.now()
        ? {
            ...job,
            status: "Interrupted",
            error:
              "The previous download did not finish. Existing imported locations remain available.",
          }
        : job;
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
        if (current.startedAt && now - Date.parse(current.startedAt) < 600000)
          fail(
            429,
            "Wait ten minutes between full directory download attempts.",
          );
        if (
          current.status === "Completed" &&
          now - Date.parse(current.finishedAt) < 86400000
        )
          fail(
            429,
            "The open directory was updated recently. Wait 24 hours before downloading again.",
          );
        job = {
          id: randomUUID(),
          status: "Downloading",
          startedAt: new Date().toISOString(),
          leaseUntil: now + 240000,
          imported: 0,
          total: current.total || 0,
          error: "",
        };
        save(job);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      controller = new AbortController();
      active = (async () => {
        try {
          const response = await fetcher(
            "https://overpass-api.de/api/interpreter",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "ApexLinks-open-course-import/0.9",
              },
              body: new URLSearchParams({
                data: '[out:json][timeout:180];nwr["leisure"="golf_course"]["name"];out tags center;',
              }),
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(200000),
              ]),
            },
          );
          if (!response.ok)
            throw Error(
              `OpenStreetMap returned HTTP ${response.status}. No fictional data was added. Retry later or import an authorised export file.`,
            );
          let raw;
          if (response.body?.[Symbol.asyncIterator]) {
            const chunks = [];
            let bytes = 0;
            for await (const chunk of response.body) {
              bytes += chunk.length;
              if (bytes > 32 * 1024 * 1024)
                throw Error(
                  "The download exceeds the 32 MB web limit. Use the command-line importer for a regional export file.",
                );
              chunks.push(chunk);
            }
            raw = Buffer.concat(chunks, bytes).toString("utf8");
          } else {
            raw = await response.text();
            if (Buffer.byteLength(raw) > 32 * 1024 * 1024)
              throw Error(
                "The download exceeds the web import limit. Use a smaller export file.",
              );
          }
          const data = JSON.parse(raw);
          controller.signal.throwIfAborted();
          job.status = "Importing";
          save(job);
          const result = storeOpenCourses(db, data);
          Object.assign(job, result, {
            status: "Completed",
            finishedAt: new Date().toISOString(),
            leaseUntil: 0,
          });
          save(job);
        } catch (error) {
          Object.assign(job, {
            status: "Failed",
            finishedAt: new Date().toISOString(),
            leaseUntil: 0,
            error: controller.signal.aborted
              ? "The server restarted before the download completed. Retry after the cooldown."
              : String(error.message || "Directory download failed.").slice(
                  0,
                  400,
                ),
            total: db
              .prepare("SELECT COUNT(*) AS total FROM course_venues")
              .get().total,
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
      return { ...job };
    },
    async stop() {
      controller?.abort();
      if (active) await active;
    },
  };
}
