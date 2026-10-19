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
  };
}
