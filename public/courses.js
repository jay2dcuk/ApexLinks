const normal = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("en-GB");
export const courseKey = (course) =>
  [
    course.name,
    course.location,
    course.country,
    course.tee,
    course.ratedFor || "Unspecified",
  ]
    .map(normal)
    .join("|");
export const sameVenue = (a, b) =>
  ["name", "location", "country"].every(
    (key) => normal(a[key]) === normal(b[key]),
  );
export function courseSnapshot(course) {
  return Object.fromEntries(
    [
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
      "lengths",
    ].map((key) => [
      key,
      Array.isArray(course[key]) ? [...course[key]] : (course[key] ?? null),
    ]),
  );
}
export function calculateHandicap(index, course, allowance = 100) {
  if (
    !Number.isFinite(index) ||
    index < -10 ||
    index > 54 ||
    !Number.isInteger(allowance) ||
    allowance < 1 ||
    allowance > 100 ||
    !course ||
    !Number.isFinite(course.rating) ||
    course.rating < 50 ||
    course.rating > 90 ||
    !Number.isInteger(course.slope) ||
    course.slope < 55 ||
    course.slope > 155 ||
    !Array.isArray(course.pars) ||
    course.pars.length !== 18
  )
    throw Error("Enter a valid index, allowance, course rating and slope.");
  const raw =
    (index * course.slope) / 113 +
    course.rating -
    course.pars.reduce((a, b) => a + b, 0);
  return {
    courseHandicap: Math.round(raw),
    playingHandicap: Math.round((raw * allowance) / 100),
    unrounded: raw,
  };
}
export function attestedRoundRecord(state, card) {
  const round = state.rounds.find((r) => r.id === card.roundId),
    p = state.players.find((p) => p.id === card.playerId),
    event = state.events.find((e) => e.id === round.eventId);
  const override = (state.roundTees || []).find(
    (t) => t.roundId === round.id && t.playerId === card.playerId,
  );
  // Never fall back to mutable current ratings for a historical score.
  const snapshot = override ? override.courseSnapshot : round.courseSnapshot;
  return {
    player: p.name,
    playerEmail: p.email,
    format: event.format,
    date: round.date,
    course: snapshot?.name || null,
    tee: override?.tee || snapshot?.tee || null,
    pars: override?.pars || round.pars,
    strokeIndexes: override?.indexes || round.indexes,
    grossScores: card.scores,
    holesPlayed: card.scores.filter((n) => n !== null).length,
    courseRating: override
      ? (override.rating ?? snapshot?.rating ?? null)
      : (snapshot?.rating ?? null),
    slope: override
      ? (override.slope ?? snapshot?.slope ?? null)
      : (snapshot?.slope ?? null),
    ratedFor: snapshot?.ratedFor || null,
    ratingAsOf: snapshot?.ratingAsOf || null,
    ratingSource: snapshot?.ratingSource || null,
    sourceURL: snapshot?.sourceURL || null,
    ratingStatus: "Organiser-provided; not federation-verified",
    status: "Organiser-attested; not federation-posted",
  };
}
