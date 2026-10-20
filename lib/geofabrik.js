// Geofabrik publishes OSM extracts, not a separate proprietary course database.
export const geofabrikIndex = "https://download.geofabrik.de/index-v1.json";
export function geofabrikRegions(index, root = "") {
  if (!Array.isArray(index?.features))
    throw Error("Invalid Geofabrik catalogue.");
  const records = index.features
    .map((f) => f.properties)
    .filter((p) => p && typeof p.id === "string");
  const byId = new Map(records.map((p) => [p.id, p]));
  if (root && !byId.has(root)) throw Error(`Unknown Geofabrik region: ${root}`);
  const parents = new Set(records.map((p) => p.parent));
  function within(p) {
    const seen = new Set();
    while (p) {
      if (!root || p.id === root) return true;
      if (seen.has(p.id)) throw Error("Cycle in Geofabrik catalogue.");
      seen.add(p.id);
      p = byId.get(p.parent);
    }
    return false;
  }
  return records
    .filter((p) => !parents.has(p.id) && p.urls?.pbf && within(p))
    .map((p) => {
      const url = new URL(p.urls.pbf);
      if (
        url.origin !== "https://download.geofabrik.de" ||
        !url.pathname.endsWith("-latest.osm.pbf") ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Error("Untrusted bulk-extract URL in Geofabrik catalogue.");
      return { id: p.id, name: p.name || p.id, url: url.href };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
