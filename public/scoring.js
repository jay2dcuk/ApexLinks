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
    .filter((e) => e.eventId === event.id && e.status === "Registered")
    .map((e) => {
      const p = state.players.find((p) => p.id === e.playerId);
      const totals = rounds.reduce(
        (total, r) => {
          const c = state.cards.find(
            (c) => c.roundId === r.id && c.playerId === p.id,
          );
          const t = cardTotals(c?.scores || [], r.pars, r.indexes, e.handicap);
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
      };
    });
  const metric =
    event.format === "Stableford"
      ? "points"
      : event.format === "Net stroke"
        ? "net"
        : "gross";
  rows.sort(
    (a, b) =>
      !a.thru - !b.thru ||
      (metric === "points" ? b.points - a.points : a[metric] - b[metric]) ||
      b.thru - a.thru ||
      a.name.localeCompare(b.name),
  );
  let last = "",
    rank = 0;
  rows.forEach((r, i) => {
    const signature = `${r[metric]}:${r.thru}`;
    if (signature !== last) rank = i + 1;
    r.position = r.thru ? rank : null;
    last = signature;
  });
  return rows;
}
export function teamLeaderboard(state, event, roundId) {
  const round = state.rounds.find(
    (r) => r.id === roundId && r.eventId === event.id,
  );
  if (!round) return [];
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
