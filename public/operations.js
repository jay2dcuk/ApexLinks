export function eventReadiness(s, eventId) {
  const rounds = s.rounds.filter((r) => r.eventId === eventId),
    entries = s.entries.filter(
      (e) => e.eventId === eventId && e.status === "Registered",
    );
  const checks = [
    { name: "Registered field", ready: entries.length > 0 },
    { name: "Competition rounds", ready: rounds.length > 0 },
    {
      name: "Course settings",
      ready:
        rounds.length > 0 &&
        rounds.every(
          (r) => r.pars?.length === 18 && new Set(r.indexes).size === 18,
        ),
    },
    {
      name: "Tee assignments",
      ready:
        rounds.length > 0 &&
        entries.length > 0 &&
        rounds.every((r) =>
          entries.every((e) =>
            s.teeTimes.some(
              (t) => t.roundId === r.id && t.playerIds.includes(e.playerId),
            ),
          ),
        ),
    },
    {
      name: "Scoring markers",
      ready:
        rounds.length > 0 &&
        entries.length > 0 &&
        rounds.every((r) =>
          entries.every((e) =>
            (s.markerAssignments || []).some(
              (m) => m.roundId === r.id && m.playerId === e.playerId,
            ),
          ),
        ),
    },
  ];
  return {
    checks,
    percent: Math.round(
      (checks.filter((c) => c.ready).length / checks.length) * 100,
    ),
  };
}
export function paceStatus(s, teeId, now = Date.now()) {
  const tee = s.teeTimes.find((t) => t.id === teeId);
  if (!tee) return null;
  const checkpoint = (s.checkpoints || [])
      .filter((c) => c.teeId === teeId)
      .sort((a, b) => b.completed - a.completed || b.at.localeCompare(a.at))[0],
    round = s.rounds.find((r) => r.id === tee.roundId),
    minutes = round?.minutesPerHole || 14;
  const elapsed = checkpoint
      ? (Date.parse(checkpoint.at) - Date.parse(tee.start)) / 60000
      : 0,
    delay = checkpoint
      ? Math.max(0, Math.round(elapsed - checkpoint.completed * minutes))
      : null;
  return {
    completed: checkpoint?.completed || 0,
    delay,
    stale: Date.parse(tee.start) < now && !checkpoint,
    expectedFinish: new Date(
      Date.parse(tee.start) + 18 * minutes * 60000,
    ).toISOString(),
    risk: !checkpoint
      ? "No checkpoint"
      : checkpoint.completed < 18 &&
          now - Date.parse(checkpoint.at) > minutes * 120000
        ? "Update overdue"
        : delay >= 15
          ? "Behind pace"
          : "On pace",
  };
}
export const reportDatasets = {
  players: ["name", "club", "handicap", "memberStatus"],
  events: ["name", "date", "format", "status", "capacity", "fee"],
  entries: ["player", "event", "division", "team", "handicap", "status"],
  invoices: [
    "player",
    "description",
    "amount",
    "currency",
    "status",
    "reference",
  ],
  bookings: ["course", "start", "players", "status"],
  incidents: ["title", "severity", "status", "created"],
};
export function reportRows(s, view) {
  const rows = (s[view.dataset] || []).map((row) => ({
    ...row,
    player: s.players.find((p) => p.id === row.playerId)?.name || "",
    event: s.events.find((e) => e.id === row.eventId)?.name || "",
    course: s.courses.find((c) => c.id === row.courseId)?.name || "",
    players: (row.playerIds || [])
      .map((id) => s.players.find((p) => p.id === id)?.name)
      .join("; "),
  }));
  return rows
    .filter((r) => !view.status || (r.status ?? r.memberStatus) === view.status)
    .map((r) => Object.fromEntries(view.columns.map((k) => [k, r[k] ?? ""])));
}
