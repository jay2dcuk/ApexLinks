import { randomUUID } from "node:crypto";
import { fail, text, date, integer } from "./validation.js";
import { seasonStandings, seasonFormats } from "../public/seasons.js";
export function seasonOperation(
  s,
  { resource, resourceId, action, b, role, method, user },
) {
  if (!["seasons", "season-events"].includes(resource))
    return { handled: false };
  if (!["admin", "manager"].includes(role))
    fail(403, "Only organisers can manage seasons.");
  const result = (value) => ({ handled: true, result: value });
  const find = (rows, id, label) => {
    const row = rows.find((r) => r.id === id);
    if (!row) fail(404, label + " not found.");
    return row;
  };
  const editable = (season) => {
    if (season.status === "Final")
      fail(
        409,
        "Reopen the finalised season with a reason before changing it.",
      );
  };
  if (resource === "season-events") {
    if (method === "DELETE") {
      const link = find(s.seasonEvents, resourceId, "Season event");
      editable(find(s.seasons, link.seasonId, "Season"));
      s.seasonEvents = s.seasonEvents.filter((r) => r.id !== link.id);
      return result({ removed: true });
    }
    const season = find(s.seasons, b.seasonId, "Season");
    editable(season);
    const event = find(s.events, b.eventId, "Tournament");
    if (!seasonFormats.includes(event.format))
      fail(
        400,
        "Season points support individual stroke, net, Stableford and Bogey/Par events.",
      );
    if (event.date < season.start || event.date > season.end)
      fail(400, "The tournament must fall within the season dates.");
    if (
      s.seasonEvents.some(
        (r) => r.seasonId === season.id && r.eventId === event.id,
      )
    )
      fail(409, "This tournament is already linked.");
    if (s.seasonEvents.filter((r) => r.seasonId === season.id).length >= 100)
      fail(400, "A season supports up to 100 tournaments.");
    const row = {
      id: randomUUID(),
      seasonId: season.id,
      eventId: event.id,
      weight: integer(b.weight ?? 1, "Points multiplier", 1, 5),
    };
    s.seasonEvents.push(row);
    return result(row);
  }
  const existing = resourceId ? find(s.seasons, resourceId, "Season") : null;
  if ((method === "DELETE" || action) && !existing)
    fail(404, "Season not found.");
  if (action === "finalise") {
    editable(existing);
    const links = s.seasonEvents.filter((r) => r.seasonId === existing.id);
    if (
      !links.length ||
      links.some(
        (r) => s.events.find((e) => e.id === r.eventId)?.status !== "Completed",
      )
    )
      fail(
        409,
        "Complete every linked tournament before finalising the season.",
      );
    const standings = seasonStandings(s, existing);
    if (!standings.some((r) => r.qualified))
      fail(
        409,
        "No qualified golfers have completed eligible, attested rounds.",
      );
    existing.finalStandings = standings;
    existing.status = "Final";
    existing.finalisedAt = new Date().toISOString();
    return result(existing);
  }
  if (action === "reopen") {
    if (existing.status !== "Final")
      fail(409, "Only a finalised season can be reopened.");
    const reason = text(b.reason, "Reopening reason", 240);
    existing.revisions ||= [];
    existing.revisions.push({
      reason,
      by: user.name,
      at: new Date().toISOString(),
    });
    existing.revisions = existing.revisions.slice(-100);
    existing.status = "Open";
    delete existing.finalStandings;
    delete existing.finalisedAt;
    return result(existing);
  }
  if (existing) editable(existing);
  if (method === "DELETE") {
    if (s.seasonEvents.some((r) => r.seasonId === existing.id))
      fail(409, "Remove linked tournaments before deleting a season.");
    s.seasons = s.seasons.filter((r) => r.id !== existing.id);
    return result({ deleted: true });
  }
  if (!["POST", "PATCH"].includes(method))
    fail(405, "Unsupported season action.");
  const start = date(b.start),
    end = date(b.end);
  if (end < start) fail(400, "The season end date must follow its start.");
  if (!Array.isArray(b.points) || !b.points.length || b.points.length > 100)
    fail(400, "Provide 1–100 points positions.");
  const points = b.points.map((n) => integer(n, "Position points", 0, 1000000));
  if (!points[0] || points.some((n, i) => i > 0 && n > points[i - 1]))
    fail(
      400,
      "Position points must decrease or stay equal, starting above zero.",
    );
  if (
    existing &&
    s.seasonEvents.some(
      (r) =>
        r.seasonId === existing.id &&
        (() => {
          const e = s.events.find((e) => e.id === r.eventId);
          return e.date < start || e.date > end;
        })(),
    )
  )
    fail(409, "Remove out-of-range linked tournaments before changing dates.");
  const data = {
    name: text(b.name, "Season name"),
    start,
    end,
    division: text(b.division || "Open", "Division", 60),
    bestOf: integer(b.bestOf ?? 0, "Best results to count", 0, 100),
    minEvents: integer(b.minEvents ?? 1, "Minimum events to qualify", 1, 100),
    points,
  };
  if (existing) {
    Object.assign(existing, data);
    return result(existing);
  }
  const row = { id: randomUUID(), ...data, status: "Open", revisions: [] };
  s.seasons.push(row);
  return result(row);
}
