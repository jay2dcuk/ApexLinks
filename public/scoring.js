import { countback } from "./competition.js";
export const defaultPars = [
  4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4,
];
export const defaultIndexes = [
  7, 3, 15, 1, 9, 11, 17, 5, 13, 8, 16, 2, 10, 6, 18, 14, 4, 12,
];
export function strokesOnHole(handicap, index) {
  return (
    Math.floor(handicap / 18) + (index <= ((handicap % 18) + 18) % 18 ? 1 : 0)
  );
}
export function cardTotals(scores, pars, indexes, handicap = 0) {
  let gross = 0,
    net = 0,
    toPar = 0,
    points = 0,
    thru = 0;
  for (let i = 0; i < 18; i++) {
    if (scores[i] === null || scores[i] === undefined) continue;
    const n = scores[i] - strokesOnHole(handicap, indexes[i]);
    gross += scores[i];
    net += n;
    toPar += scores[i] - pars[i];
    points += Math.max(0, 2 + pars[i] - n);
    thru++;
  }
  return { gross, net, toPar, points, thru };
}
export function leaderboard(state, event) {
  const rounds = state.rounds
    .filter((r) => r.eventId === event.id)
    .sort((a, b) => a.number - b.number);
  const rows = state.entries
    .filter((e) => e.eventId === event.id && e.status !== "Waitlisted")
    .map((e) => {
      const p = state.players.find((p) => p.id === e.playerId);
      const totals = rounds.reduce(
        (total, r) => {
          const c = state.cards.find(
            (c) => c.roundId === r.id && c.playerId === p.id,
          );
          const settings = roundSettings(state, r, p.id, e.handicap);
          const t = cardTotals(
            c?.scores || [],
            settings.pars,
            settings.indexes,
            settings.handicap,
          );
          for (const k of Object.keys(t)) total[k] += t[k];
          if (c?.status === "Attested") total.attested++;
          return total;
        },
        { gross: 0, net: 0, toPar: 0, points: 0, thru: 0, attested: 0 },
      );
      return {
        playerId: p.id,
        name: p.name,
        handicap: e.handicap,
        division: e.division,
        team: e.team,
        ...totals,
        status: e.status,
        countback:
          event.tiebreak === "Countback" &&
          totals.thru === rounds.length * 18 &&
          rounds.length
            ? countback(
                state.cards.find(
                  (c) => c.roundId === rounds.at(-1).id && c.playerId === p.id,
                ).scores,
                {
                  ...rounds.at(-1),
                  ...roundSettings(state, rounds.at(-1), p.id, e.handicap),
                },
                roundSettings(state, rounds.at(-1), p.id, e.handicap).handicap,
                event.format,
              )
            : [],
      };
    });
  const metric =
    event.format === "Stableford"
      ? "points"
      : event.format === "Net stroke"
        ? "net"
        : "gross";
  const byCountback = (a, b) => {
    if (a.thru !== b.thru) return 0;
    for (let i = 0; i < Math.min(a.countback.length, b.countback.length); i++) {
      const diff =
        metric === "points"
          ? b.countback[i] - a.countback[i]
          : a.countback[i] - b.countback[i];
      if (diff) return diff;
    }
    return 0;
  };
  rows.sort(
    (a, b) =>
      (a.status !== "Registered") - (b.status !== "Registered") ||
      !a.thru - !b.thru ||
      (metric === "points" ? b.points - a.points : a[metric] - b[metric]) ||
      byCountback(a, b) ||
      b.thru - a.thru ||
      a.name.localeCompare(b.name),
  );
  const divisions = new Map();
  for (const r of rows) {
    const division = r.division || "Open",
      d = divisions.get(division) || { seen: 0, last: "", rank: 0 };
    d.seen++;
    const signature = `${r[metric]}:${r.thru}:${r.countback.join(",")}`;
    if (signature !== d.last) d.rank = d.seen;
    r.position = r.thru && r.status === "Registered" ? d.rank : null;
    d.last = signature;
    divisions.set(division, d);
  }
  return rows;
}
export function teamLeaderboard(state, event, roundId) {
  const round = state.rounds.find(
    (r) => r.id === roundId && r.eventId === event.id,
  );
  if (!round || (state.roundTees || []).some((t) => t.roundId === roundId))
    return [];
  const teams = new Map();
  for (const e of state.entries.filter(
    (e) => e.eventId === event.id && e.status === "Registered" && e.team,
  )) {
    if (!teams.has(e.team)) teams.set(e.team, []);
    teams.get(e.team).push(e);
  }
  return [...teams]
    .map(([name, entries]) => {
      const scores = round.pars.map((_, i) => {
        const values = entries
          .map((e) => {
            const card = state.cards.find(
              (c) => c.roundId === round.id && c.playerId === e.playerId,
            );
            return card?.scores[i] == null
              ? null
              : card.scores[i] - strokesOnHole(e.handicap, round.indexes[i]);
          })
          .filter((n) => n !== null);
        return values.length ? Math.min(...values) : null;
      });
      return {
        name,
        players: entries.length,
        ...cardTotals(scores, round.pars, round.indexes, 0),
      };
    })
    .sort((a, b) => !a.thru - !b.thru || a.net - b.net);
}
export function roundSettings(state, round, playerId, handicap) {
  const tee = (state.roundTees || []).find(
    (t) => t.roundId === round.id && t.playerId === playerId,
  );
  return {
    pars: tee?.pars || round.pars,
    indexes: tee?.indexes || round.indexes,
    handicap: tee?.handicap ?? handicap,
    tee: tee?.tee,
  };
}
