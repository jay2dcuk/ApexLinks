import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCourseImport,
  courseCSVColumns,
} from "../public/course-import.js";
const quote = (value) => '"' + String(value).replaceAll('"', '""') + '"';
test("course CSV accepts quoted commas/newlines and maps 18 holes without inventing missing ratings", () => {
  const data = {
    name: 'Fictional "Links", South',
    tee: "White",
    rating: "71.8",
    slope: "128",
    ratingSource: "Club\nscorecard",
  };
  for (let i = 1; i <= 18; i++) {
    data["par" + i] = 4;
    data["si" + i] = i;
  }
  const csv =
    courseCSVColumns.map(quote).join(",") +
    "\r\n" +
    courseCSVColumns.map((key) => quote(data[key] ?? "")).join(",") +
    "\r\n";
  const [row] = parseCourseImport(csv);
  assert.equal(row.name, data.name);
  assert.equal(row.rating, 71.8);
  assert.equal(row.slope, 128);
  assert.equal(row.ratingSource, "Club\nscorecard");
  assert.equal(row.pars.length, 18);
  assert.equal(row.indexes[17], 18);
  assert.equal(row.lengths[0], null);
  const blank = csv.replace('"71.8"', '""').replace('"128"', '""');
  assert.equal(parseCourseImport(blank)[0].rating, null);
});
test("course imports reject truncated, oversized, duplicate-header and malformed CSV or JSON", () => {
  assert.throws(() => parseCourseImport("name,name\nLinks,White"), /unique/);
  assert.throws(
    () => parseCourseImport('name,tee\n"Unclosed,White'),
    /Unclosed/,
  );
  assert.throws(
    () => parseCourseImport("name,tee\nLinks,White"),
    /Missing CSV column/,
  );
  assert.throws(() => parseCourseImport("["), /valid JSON/);
  assert.throws(() => parseCourseImport("[]"), /1–100/);
  assert.throws(() => parseCourseImport("x".repeat(95001)), /95 KB/);
});
