import { cardTotals, strokesOnHole } from "./scoring.js";
export const formats = [
  "Stroke play",
  "Net stroke",
  "Stableford",
  "Scramble",
  "Foursomes",
  "Match play",
];
export const teamFormats = ["Scramble", "Foursomes"];
export function countback(scores, round, handicap, format) {
  return [9, 6, 3, 1].map((n) => {
    let total = 0;
    for (let i = 18 - n; i < 18; i++) {
      const net = scores[i] - strokesOnHole(handicap, round.indexes[i]);
      total +=
        format === "Stableford"
          ? Math.max(0, 2 + round.pars[i] - net)
          : format === "Stroke play"
            ? scores[i]
            : net;
    }
    return total;
  });
}
export function matchResult(a, b, round, hcpA, hcpB) {
  let lead = 0,
    played = 0;
  const difference = Math.abs(hcpA - hcpB);
  for (let i = 0; i < 18; i++) {
    if (a[i] == null || b[i] == null) break;
    const netA =
        a[i] - (hcpA > hcpB ? strokesOnHole(difference, round.indexes[i]) : 0),
      netB =
        b[i] - (hcpB > hcpA ? strokesOnHole(difference, round.indexes[i]) : 0);
    lead += netA < netB ? 1 : netA > netB ? -1 : 0;
    played++;
    if (Math.abs(lead) > 18 - played) break;
  }
  const remaining = 18 - played,
    finished = Math.abs(lead) > remaining || played === 18;
  return {
    lead,
    played,
    remaining,
    finished,
    winner: finished && lead !== 0 ? (lead > 0 ? "A" : "B") : null,
    label:
      lead === 0
        ? played === 18
          ? "All square — playoff required"
          : "All square"
        : finished
          ? remaining
            ? `${Math.abs(lead)} & ${remaining}`
            : `${Math.abs(lead)} up`
          : `${Math.abs(lead)} up after ${played}`,
  };
}
export function teamStandings(state, event) {
  const rounds = state.rounds
    .filter((r) => r.eventId === event.id)
    .sort((a, b) => a.number - b.number);
  const names = [
    ...new Set(
      state.entries
        .filter((e) => e.eventId === event.id && e.status === "Registered")
        .map((e) => e.team)
        .filter(Boolean),
    ),
  ];
  return names
    .map((name) => {
      let gross = 0,
        net = 0,
        points = 0,
        thru = 0,
        attested = 0;
      for (const r of rounds) {
        const c = (state.teamCards || []).find(
          (c) => c.roundId === r.id && c.team === name,
        );
        const t = cardTotals(
          c?.scores || [],
          r.pars,
          r.indexes,
          c?.handicap || 0,
        );
        gross += t.gross;
        net += t.net;
        points += t.points;
        thru += t.thru;
        if (c?.status === "Attested") attested++;
      }
      return { name, gross, net, points, thru, attested };
    })
    .sort((a, b) => !a.thru - !b.thru || a.net - b.net || b.thru - a.thru);
}
