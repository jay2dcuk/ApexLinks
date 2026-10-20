import { test } from "node:test";
import assert from "node:assert/strict";
import { geofabrikRegions } from "../lib/geofabrik.js";
const feature = (id, parent, url) => ({
  properties: {
    id,
    parent,
    name: id,
    urls: { pbf: url || `https://download.geofabrik.de/${id}-latest.osm.pbf` },
  },
});
const catalogue = {
  features: [
    feature("europe"),
    feature("britain", "europe"),
    feature("england", "britain"),
    feature("scotland", "britain"),
    feature("france", "europe"),
    feature("asia"),
    feature("japan", "asia"),
  ],
};
test("bulk catalogue chooses leaf extracts worldwide without also downloading overlapping parents", () => {
  assert.deepEqual(
    geofabrikRegions(catalogue).map((x) => x.id),
    ["england", "france", "japan", "scotland"],
  );
  assert.deepEqual(
    geofabrikRegions(catalogue, "britain").map((x) => x.id),
    ["england", "scotland"],
  );
  assert.deepEqual(
    geofabrikRegions(catalogue, "france").map((x) => x.id),
    ["france"],
  );
  assert.throws(() => geofabrikRegions(catalogue, "unknown"), /Unknown/);
});
test("bulk catalogue refuses arbitrary download hosts, credentials, and malformed inputs", () => {
  for (const url of [
    "https://example.com/a-latest.osm.pbf",
    "http://download.geofabrik.de/a-latest.osm.pbf",
    "https://x:password@download.geofabrik.de/a-latest.osm.pbf",
    "https://download.geofabrik.de/a-latest.osm.pbf?x=y",
  ])
    assert.throws(
      () => geofabrikRegions({ features: [feature("a", "", url)] }),
      /Untrusted/,
    );
  assert.throws(() => geofabrikRegions({}), /Invalid/);
});
