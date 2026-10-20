import { fail, text } from "./validation.js";
import { openCourseVenues, courseSearchText } from "./open-course-data.js";
import { createOpenCourseDownload } from "./open-course-download.js";
const attribution = "© OpenStreetMap contributors (ODbL)";
export function createCourseDirectory(db, { fetcher = fetch } = {}) {
  const inFlight = new Map(),
    lastRequest = new Map();
  return {
    ...createOpenCourseDownload(db, { fetcher }),
    async search(orgId, name, country = "") {
      name = text(name, "Course name", 80);
      if (name.length < 3)
        fail(400, "Enter at least three characters of a course name.");
      if (
        typeof country !== "string" ||
        (country && !/^[A-Z]{2}$/.test(country))
      )
        fail(400, "Use a two-letter uppercase country code, such as GB or US.");
      const key = JSON.stringify([name.toLowerCase(), country]),
        cached = db
          .prepare("SELECT * FROM course_directory_queries WHERE query=?")
          .get(key);
      const literal =
        "%" + courseSearchText(name).replace(/[\\%_]/g, "\\$&") + "%";
      const local = db
        .prepare(
          "SELECT payload FROM course_venues WHERE name LIKE ? ESCAPE '\\' AND (?='' OR country=? OR country='') ORDER BY name,id LIMIT 50",
        )
        .all(literal, country, country);
      if (local.length)
        return {
          venues: local.map((r) => JSON.parse(r.payload)),
          attribution,
          cached: true,
          coverage:
            "Downloaded OpenStreetMap locations; tee ratings are not included. Up to 50 results. Country filters retain venues with unknown country.",
        };
      if (cached && Date.now() - cached.fetched < 86400000)
        return {
          venues: JSON.parse(cached.payload),
          attribution,
          cached: true,
          coverage:
            "OpenStreetMap locations; tee ratings are not included. Results are limited to 50.",
        };
      if (inFlight.has(key)) return inFlight.get(key);
      if (inFlight.size >= 2)
        fail(429, "The directory is busy. Retry shortly.");
      if (Date.now() - (lastRequest.get(orgId) || 0) < 1500)
        fail(429, "Wait a moment between directory searches.");
      lastRequest.set(orgId, Date.now());
      if (lastRequest.size > 10000)
        lastRequest.delete(lastRequest.keys().next().value);
      const request = (async () => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const area = country
          ? `area["ISO3166-1"=${JSON.stringify(country)}]["boundary"="administrative"]["admin_level"="2"]->.country;`
          : "";
        const query = `[out:json][timeout:7];${area}nwr${country ? "(area.country)" : ""}["leisure"="golf_course"]["name"~${JSON.stringify(escaped)},i];out center 50;`;
        let response;
        try {
          response = await fetcher("https://overpass-api.de/api/interpreter", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": "ApexLinks-course-directory/0.8",
            },
            body: new URLSearchParams({ data: query }),
            signal: AbortSignal.timeout(9000),
          });
        } catch {
          fail(
            503,
            "The worldwide directory is temporarily unavailable. You can still add or import authorised course data.",
          );
        }
        if (!response.ok)
          fail(
            503,
            "The worldwide directory could not be reached. Add or import course data instead.",
          );
        const data = await response.json();
        if (!Array.isArray(data.elements) || data.remark)
          fail(
            502,
            "The course directory returned an incomplete result. Refine the search and retry.",
          );
        const venues = openCourseVenues(
          { ...data, elements: data.elements.slice(0, 50) },
          country,
        );
        db.prepare(
          "INSERT INTO course_directory_queries VALUES(?,?,?) ON CONFLICT(query) DO UPDATE SET payload=excluded.payload,fetched=excluded.fetched",
        ).run(key, JSON.stringify(venues), Date.now());
        db.prepare(
          "DELETE FROM course_directory_queries WHERE query NOT IN (SELECT query FROM course_directory_queries ORDER BY fetched DESC LIMIT 1000)",
        ).run();
        return {
          venues,
          attribution,
          cached: false,
          coverage:
            "OpenStreetMap locations; tee ratings are not included. Results are limited to 50.",
        };
      })();
      inFlight.set(key, request);
      try {
        return await request;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
