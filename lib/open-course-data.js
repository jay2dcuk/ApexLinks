const attribution = "© OpenStreetMap contributors (ODbL)";
export const courseSearchText = (name) =>
  name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
export function openCourseVenues(data, country = "") {
  if (!data || !Array.isArray(data.elements) || data.remark)
    throw Error("An intact OpenStreetMap Overpass JSON export is required.");
  return data.elements
    .filter(
      (v) =>
        ["node", "way", "relation"].includes(v.type) &&
        Number.isSafeInteger(v.id) &&
        v.id > 0 &&
        typeof v.tags?.name === "string" &&
        v.tags.name.trim() &&
        v.tags.leisure === "golf_course",
    )
    .map((v) => {
      const latitude = v.lat ?? v.center?.lat,
        longitude = v.lon ?? v.center?.lon;
      return {
        id: `osm:${v.type}:${v.id}`,
        name: v.tags.name.trim().slice(0, 120),
        location: [
          v.tags["addr:city"] || v.tags["addr:town"] || v.tags["addr:village"],
          v.tags["addr:state"],
        ]
          .filter((s) => typeof s === "string")
          .join(", ")
          .slice(0, 200),
        country: (
          country ||
          (typeof v.tags["addr:country"] === "string"
            ? v.tags["addr:country"]
            : "")
        )
          .trim()
          .slice(0, 80)
          .replace(/^[a-z]{2}$/i, (value) => value.toUpperCase()),
        latitude:
          Number.isFinite(latitude) && Math.abs(latitude) <= 90
            ? latitude
            : null,
        longitude:
          Number.isFinite(longitude) && Math.abs(longitude) <= 180
            ? longitude
            : null,
        directoryURL: `https://www.openstreetmap.org/${v.type}/${v.id}`,
        directoryAttribution: attribution,
        rating: null,
        slope: null,
      };
    });
}
export function storeOpenCourses(db, data, country = "") {
  const venues = openCourseVenues(data, country),
    ids = new Set();
  if (!venues.length)
    throw Error("The export contains no named golf-course locations.");
  const statement = db.prepare(
    "INSERT INTO course_venues VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,country=excluded.country,payload=excluded.payload,updated=excluded.updated",
  );
  // Bounded transactions let a running web service use the same WAL database.
  for (let offset = 0; offset < venues.length; offset += 500) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const v of venues.slice(offset, offset + 500)) {
        statement.run(
          v.id,
          courseSearchText(v.name),
          v.country,
          JSON.stringify(v),
          Date.now(),
        );
        ids.add(v.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    imported: ids.size,
    total: db.prepare("SELECT COUNT(*) AS total FROM course_venues").get()
      .total,
    attribution,
  };
}
