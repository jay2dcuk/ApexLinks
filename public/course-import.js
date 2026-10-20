export const courseCSVColumns = [
  "name",
  "tee",
  "location",
  "country",
  "ratedFor",
  "rating",
  "slope",
  "ratingSource",
  "sourceURL",
  "ratingAsOf",
  "lengthUnit",
  ...Array.from({ length: 18 }, (_, i) => "par" + (i + 1)),
  ...Array.from({ length: 18 }, (_, i) => "si" + (i + 1)),
  ...Array.from({ length: 18 }, (_, i) => "length" + (i + 1)),
];
function csvRows(source) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      if (field.length || closed) throw Error("Unexpected quote in CSV field.");
      quoted = true;
      continue;
    }
    if (ch === "," || ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (ch !== ",") {
        rows.push(row);
        row = [];
        if (ch === "\r" && source[i + 1] === "\n") i++;
      }
      continue;
    }
    if (closed) {
      if (ch === " " || ch === "\t") continue;
      throw Error("Unexpected text after a quoted CSV field.");
    }
    field += ch;
  }
  if (quoted) throw Error("Unclosed quote in CSV.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows.filter((r) => r.some((v) => v.trim()));
}
export function parseCourseImport(source) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > 95000
  )
    throw Error(
      "Import files must be no larger than 95 KB. Split large datasets into batches.",
    );
  source = source.replace(/^\uFEFF/, "").trim();
  if (source.startsWith("[")) {
    let rows;
    try {
      rows = JSON.parse(source);
    } catch {
      throw Error("Enter valid JSON.");
    }
    if (!Array.isArray(rows) || !rows.length || rows.length > 100)
      throw Error("Import 1–100 tee sets per batch.");
    return rows;
  }
  const rows = csvRows(source),
    header = rows.shift();
  if (!header || !rows.length || rows.length > 100)
    throw Error("CSV needs a header and 1–100 tee set rows.");
  const normal = (key) =>
    key
      .trim()
      .toLowerCase()
      .replace(/[_\s-]/g, "");
  const allowed = new Map(courseCSVColumns.map((key) => [normal(key), key])),
    keys = header.map(normal);
  if (new Set(keys).size !== keys.length)
    throw Error("CSV headers must be unique.");
  for (const key of keys)
    if (!allowed.has(key)) throw Error("Unknown CSV column: " + key);
  for (const key of [
    "name",
    "tee",
    ...Array.from({ length: 18 }, (_, i) => "par" + (i + 1)),
    ...Array.from({ length: 18 }, (_, i) => "si" + (i + 1)),
  ])
    if (!keys.includes(normal(key))) throw Error("Missing CSV column: " + key);
  return rows.map((row, index) => {
    if (row.length !== keys.length)
      throw Error(`CSV row ${index + 2} has the wrong number of fields.`);
    const values = Object.fromEntries(
      keys.map((key, i) => [allowed.get(key), row[i].trim()]),
    );
    const number = (key) => {
      if (!values[key]) return null;
      const n = Number(values[key]);
      if (!Number.isFinite(n))
        throw Error(`CSV row ${index + 2}: ${key} must be numeric.`);
      return n;
    };
    return {
      ...Object.fromEntries(
        courseCSVColumns
          .slice(0, 11)
          .map((key) => [
            key,
            ["rating", "slope"].includes(key) ? number(key) : values[key] || "",
          ]),
      ),
      pars: Array.from({ length: 18 }, (_, i) => number("par" + (i + 1))),
      indexes: Array.from({ length: 18 }, (_, i) => number("si" + (i + 1))),
      lengths: Array.from({ length: 18 }, (_, i) => number("length" + (i + 1))),
    };
  });
}
