import { leaderboard } from "./scoring.js";
export const seasonFormats = [
  "Stroke play",
  "Net stroke",
  "Stableford",
  "Bogey / Par",
];
export function seasonStandings(state, season) {
  if (season.status === "Final" && season.finalStandings)
    return structuredClone(season.finalStandings);
  const golfers = new Map();
  for (const link of (state.seasonEvents || []).filter(
    (link) => link.seasonId === season.id,
  )) {
    const event = state.events.find((e) => e.id === link.eventId),
      rounds = state.rounds.filter((r) => r.eventId === event?.id);
    if (
      !event ||
      event.status !== "Completed" ||
      !seasonFormats.includes(event.format) ||
      event.date < season.start ||
      event.date > season.end ||
      !rounds.length ||
      rounds.some((r) => r.status !== "Closed")
    )
      continue;
    const rows = leaderboard(state, event).filter(
      (r) =>
        (r.division || "Open") === season.division &&
        r.position !== null &&
        r.attested === rounds.length &&
        r.thru === rounds.length * 18,
    );
    for (const row of rows) {
      const tied = rows.filter((r) => r.position === row.position).length;
      const points =
        Array.from(
          { length: tied },
          (_, offset) => season.points[row.position - 1 + offset] || 0,
        ).reduce((a, b) => a + b, 0) / tied;
      const result = {
        eventId: event.id,
        eventName: event.name,
        date: event.date,
        position: row.position,
        milliPoints: Math.round(points * 1000 * link.weight),
        weight: link.weight,
      };
      if (!golfers.has(row.playerId))
        golfers.set(row.playerId, {
          playerId: row.playerId,
          name: row.name,
          results: [],
        });
      golfers.get(row.playerId).results.push(result);
    }
  }
  const rows = [...golfers.values()].map((row) => {
    row.results.sort(
      (a, b) =>
        b.milliPoints - a.milliPoints ||
        a.position - b.position ||
        a.date.localeCompare(b.date) ||
        a.eventId.localeCompare(b.eventId),
    );
    const counted = season.bestOf
      ? row.results.slice(0, season.bestOf)
      : row.results;
    const milliPoints = counted.reduce((sum, r) => sum + r.milliPoints, 0);
    return {
      ...row,
      played: row.results.length,
      counted: counted.length,
      points: milliPoints / 1000,
      milliPoints,
      wins: counted.filter((r) => r.position === 1).length,
      qualified: row.results.length >= season.minEvents,
      results: row.results.map((r) => ({
        ...r,
        points: r.milliPoints / 1000,
        counted: counted.includes(r),
      })),
    };
  });
  rows.sort(
    (a, b) =>
      Number(b.qualified) - Number(a.qualified) ||
      b.milliPoints - a.milliPoints ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name),
  );
  let previous = "",
    rank = 0;
  for (const [i, row] of rows.entries()) {
    const signature = `${row.milliPoints}:${row.wins}`;
    if (signature !== previous) rank = i + 1;
    row.position = row.qualified ? rank : null;
    previous = signature;
  }
  return rows;
}
