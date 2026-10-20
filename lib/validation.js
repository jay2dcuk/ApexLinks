export function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export function text(value, label, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(400, `${label} is required (maximum ${max} characters).`);
  return value.trim();
}
export function integer(value, label, min = 0, max = 100000) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(400, `${label} must be a whole number between ${min} and ${max}.`);
  return value;
}
export function choice(value, options, label) {
  if (!options.includes(value))
    fail(400, `${label} must be one of: ${options.join(", ")}.`);
  return value;
}
export function email(value) {
  const s = text(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    fail(400, "Enter a valid email address.");
  return s;
}
export function date(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail(400, "Enter a valid date.");
  return value;
}
export function timestamp(value) {
  const s = text(value, "Start time", 40);
  if (!/(Z|[+-]\d\d:\d\d)$/.test(s) || !Number.isFinite(Date.parse(s)))
    fail(400, "Start time must include a timezone.");
  return new Date(s).toISOString();
}
export function courseData(b) {
  if (!b || typeof b !== "object" || Array.isArray(b))
    fail(400, "Each course tee set must be an object.");
  const optional = (value, label, max) =>
    value == null || value === "" ? "" : text(value, label, max);
  const sourceURL = optional(b.sourceURL, "Source URL", 800);
  if (sourceURL) {
    let url;
    try {
      url = new URL(sourceURL);
    } catch {
      fail(400, "Enter a valid rating source URL.");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      fail(400, "Use a public HTTP or HTTPS rating source URL.");
  }
  const directoryURL = optional(b.directoryURL, "Directory URL", 800);
  if (directoryURL) {
    try {
      const url = new URL(directoryURL);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error();
    } catch {
      fail(400, "Enter a public HTTP or HTTPS directory URL.");
    }
  }
  let lengths = Array(18).fill(null);
  if (b.lengths != null) {
    if (!Array.isArray(b.lengths) || b.lengths.length !== 18)
      fail(400, "Enter 18 hole lengths.");
    lengths = b.lengths.map((n) =>
      n == null ? null : integer(n, "Hole length", 30, 1000),
    );
  }
  if (
    !Array.isArray(b.pars) ||
    b.pars.length !== 18 ||
    !Array.isArray(b.indexes) ||
    b.indexes.length !== 18
  )
    fail(400, "A course needs 18 pars and stroke indexes.");
  const pars = b.pars.map((x) => integer(x, "Par", 3, 6));
  const indexes = b.indexes.map((x) => integer(x, "Stroke index", 1, 18));
  if (new Set(indexes).size !== 18)
    fail(400, "Stroke indexes must contain each number 1–18 once.");
  if (
    b.rating != null &&
    (typeof b.rating !== "number" ||
      !Number.isFinite(b.rating) ||
      b.rating < 50 ||
      b.rating > 90)
  )
    fail(400, "Course rating must be between 50 and 90.");
  return {
    name: text(b.name, "Course name"),
    tee: text(b.tee, "Tee"),
    pars,
    indexes,
    rating: b.rating ?? null,
    slope: b.slope == null ? null : integer(b.slope, "Slope", 55, 155),
    location: optional(b.location, "Location", 200),
    country: optional(b.country, "Country", 80),
    ratedFor: choice(
      b.ratedFor || "Unspecified",
      ["Men", "Women", "Unspecified"],
      "Rating category",
    ),
    ratingSource: optional(b.ratingSource, "Rating source", 240),
    sourceURL,
    ratingAsOf: b.ratingAsOf ? date(b.ratingAsOf) : "",
    lengthUnit: choice(
      b.lengthUnit || "yards",
      ["yards", "metres"],
      "Length unit",
    ),
    lengths,
    verified: false,
    directoryURL,
    directoryAttribution: optional(
      b.directoryAttribution,
      "Directory attribution",
      240,
    ),
  };
}
