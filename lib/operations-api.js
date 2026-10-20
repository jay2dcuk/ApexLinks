import {
  matchResult,
  playoffResult,
  teamFormats,
} from "../public/competition.js";
import { randomUUID } from "node:crypto";
import { fail, text, integer, choice, date, timestamp } from "./validation.js";
import { reportDatasets } from "../public/operations.js";
import { seasonOperation } from "./seasons-api.js";
import { sameVenue, courseSnapshot } from "../public/courses.js";
export function operationsOperation(
  s,
  { resource, resourceId, action, b, role, user, method, orgMembers = [] },
) {
  const season = seasonOperation(s, {
    resource,
    resourceId,
    action,
    b,
    role,
    user,
    method,
  });
  if (season.handled) return season;
  const staff = ["admin", "manager"].includes(role),
    scorer = staff || role === "scorer",
    result = (value) => ({ handled: true, result: value }),
    id = () => randomUUID();
  const requireStaff = () => {
      if (!staff) fail(403, "Only organisers can do this.");
    },
    find = (a, key, label) => {
      const row = a.find((r) => r.id === key);
      if (!row) fail(404, label + " not found.");
      return row;
    },
    openRound = (key) => {
      const r = find(s.rounds, key, "Round"),
        e = find(s.events, r.eventId, "Event");
      if (r.status !== "Open" || !["Open", "Live", "Draft"].includes(e.status))
        fail(409, "Reopen the round and tournament first.");
      return r;
    };
  const assertUnscored = (r) => {
    if (
      s.cards.some((c) => c.roundId === r.id) ||
      s.teamCards.some((c) => c.roundId === r.id)
    )
      fail(409, "This setting is locked after scoring starts.");
  };
  if (resource === "shotgun") {
    requireStaff();
    const r = openRound(b.roundId);
    assertUnscored(r);
    const entries = s.entries.filter(
      (e) => e.eventId === r.eventId && e.status === "Registered",
    );
    if (!entries.length) fail(400, "Register players first.");
    const size = integer(b.groupSize, "Group size", 2, 4),
      start = timestamp(b.start);
    if (
      !Array.isArray(b.holes) ||
      !b.holes.length ||
      new Set(b.holes).size !== b.holes.length
    )
      fail(400, "Choose unique starting holes.");
    const holes = b.holes.map((h) => integer(h, "Starting hole", 1, 18)),
      waves = integer(b.groupsPerHole || 1, "Groups per hole", 1, 2);
    if (Math.ceil(entries.length / size) > holes.length * waves)
      fail(
        409,
        "Not enough starting holes. Use two groups per hole or increase group size.",
      );
    const blocked =
      s.bookings.some(
        (t) =>
          t.status === "Confirmed" &&
          t.courseId === r.courseId &&
          Math.abs(Date.parse(t.start) - Date.parse(start)) <
            18 * (r.minutesPerHole || 14) * 60000,
      ) ||
      s.teeTimes.some(
        (t) =>
          t.roundId !== r.id &&
          s.rounds.some(
            (x) => x.id === t.roundId && x.courseId === r.courseId,
          ) &&
          Math.abs(Date.parse(t.start) - Date.parse(start)) <
            18 * (r.minutesPerHole || 14) * 60000,
      );
    if (blocked)
      fail(409, "The shotgun reservation overlaps another booking or event.");
    s.teeTimes = s.teeTimes.filter((t) => t.roundId !== r.id);
    for (let i = 0; i < entries.length; i += size) {
      const group = i / size;
      s.teeTimes.push({
        id: id(),
        roundId: r.id,
        start,
        hole: holes[group % holes.length],
        wave: Math.floor(group / holes.length) ? "B" : "A",
        mode: "Shotgun",
        playerIds: entries.slice(i, i + size).map((e) => e.playerId),
      });
    }
    return result({ ok: true });
  }
  if (resource === "markers") {
    requireStaff();
    const r = openRound(b.roundId),
      p = find(s.players, b.playerId, "Player");
    if (
      !s.entries.some(
        (e) =>
          e.eventId === r.eventId &&
          e.playerId === p.id &&
          e.status === "Registered",
      )
    )
      fail(400, "Register the player first.");
    const marker = find(s.players, b.markerPlayerId, "Marker");
    if (marker.id === p.id || !marker.email)
      fail(
        400,
        "A marker needs a different player profile linked to an account email.",
      );
    if (
      !orgMembers.some((m) => m.email === marker.email && m.role !== "viewer")
    )
      fail(
        400,
        "The marker must have a scoring-capable account in this organisation.",
      );
    const row = {
      id: id(),
      roundId: r.id,
      playerId: p.id,
      markerPlayerId: marker.id,
    };
    s.markerAssignments = s.markerAssignments.filter(
      (m) => !(m.roundId === r.id && m.playerId === p.id),
    );
    s.markerAssignments.push(row);
    return result(row);
  }
  if (resource === "round-tees") {
    requireStaff();
    const r = openRound(b.roundId);
    assertUnscored(r);
    if (
      ["Match play", ...teamFormats].includes(
        find(s.events, r.eventId, "Event").format,
      )
    )
      fail(
        400,
        "Mixed tees for match play need committee stroke-allocation rules and are not supported.",
      );
    const p = find(s.players, b.playerId, "Player"),
      course = find(s.courses, b.courseId, "Course");
    if (
      !s.entries.some(
        (e) =>
          e.eventId === r.eventId &&
          e.playerId === p.id &&
          e.status === "Registered",
      )
    )
      fail(400, "Register the player first.");
    const base = find(s.courses, r.courseId, "Round course");
    if (!sameVenue(course, r.courseSnapshot || base))
      fail(400, "Use a tee set for the same course name.");
    const row = {
      id: id(),
      roundId: r.id,
      playerId: p.id,
      courseId: course.id,
      pars: [...course.pars],
      indexes: [...course.indexes],
      rating: course.rating,
      slope: course.slope,
      courseSnapshot: courseSnapshot(course),
      tee: course.tee,
      handicap: integer(b.handicap, "Round playing handicap", -72, 144),
    };
    s.roundTees = s.roundTees.filter(
      (t) => !(t.roundId === r.id && t.playerId === p.id),
    );
    s.roundTees.push(row);
    return result(row);
  }
  if (resource === "playoff-holes") {
    requireStaff();
    const match = find(s.matches, b.matchId, "Match"),
      r = openRound(match.roundId);
    if (match.status !== "Active" || !match.playerA || !match.playerB)
      fail(409, "Only active, non-bye matches accept playoff holes.");
    const a = s.entries.find(
        (e) => e.eventId === match.eventId && e.playerId === match.playerA,
      ),
      c = s.entries.find(
        (e) => e.eventId === match.eventId && e.playerId === match.playerB,
      ),
      cardA = s.cards.find(
        (c) => c.roundId === r.id && c.playerId === match.playerA,
      ),
      cardB = s.cards.find(
        (c) => c.roundId === r.id && c.playerId === match.playerB,
      ),
      regulation = matchResult(
        cardA?.scores || [],
        cardB?.scores || [],
        r,
        a.handicap,
        c.handicap,
      );
    if (regulation.played !== 18 || regulation.lead !== 0)
      fail(409, "Finish a tied 18-hole regulation match first.");
    if ((match.playoffVersion || 0) !== b.version)
      fail(409, "Playoff changed. Reload before saving.");
    if (playoffResult(match, r, a.handicap, c.handicap).winner)
      fail(409, "A playoff winner is already recorded. Finalise the match.");
    match.playoff = match.playoff || [];
    match.playoff.push({
      hole: integer(b.hole, "Course hole", 1, 18),
      scoreA: integer(b.scoreA, "Player A gross score", 1, 30),
      scoreB: integer(b.scoreB, "Player B gross score", 1, 30),
      recordedBy: user.name,
    });
    match.playoffVersion = (match.playoffVersion || 0) + 1;
    return result(match);
  }
  if (resource === "templates") {
    requireStaff();
    if (action === "apply") {
      const template = find(s.templates, resourceId, "Template"),
        newDate = date(b.date),
        event = {
          ...template.event,
          id: id(),
          name: text(b.name, "Tournament name"),
          date: newDate,
          status: "Draft",
          publicCode: null,
        };
      s.events.push(event);
      for (const [i, r] of template.rounds.entries())
        s.rounds.push({
          ...r,
          id: id(),
          eventId: event.id,
          number: i + 1,
          date: new Date(Date.parse(newDate) + (r.offset || 0) * 86400000)
            .toISOString()
            .slice(0, 10),
          status: "Open",
        });
      return result(event);
    }
    const e = find(s.events, b.eventId, "Tournament");
    const row = {
      id: id(),
      name: text(b.name, "Template name"),
      event: {
        name: e.name,
        format: e.format,
        tiebreak: e.tiebreak || "Shared",
        capacity: e.capacity,
        fee: e.fee,
        currency: e.currency,
        description: e.description,
      },
      rounds: s.rounds
        .filter((r) => r.eventId === e.id)
        .map((r) => ({
          courseId: r.courseId,
          pars: [...r.pars],
          indexes: [...r.indexes],
          courseSnapshot: r.courseSnapshot
            ? structuredClone(r.courseSnapshot)
            : null,
          offset: Math.max(
            0,
            Math.round((Date.parse(r.date) - Date.parse(e.date)) / 86400000),
          ),
        })),
    };
    s.templates.push(row);
    return result(row);
  }
  if (resource === "round-pace") {
    requireStaff();
    const r = openRound(resourceId);
    r.minutesPerHole = integer(
      b.minutesPerHole,
      "Target minutes per hole",
      5,
      30,
    );
    return result(r);
  }
  if (resource === "checkpoints") {
    const tee = find(s.teeTimes, b.teeId, "Group"),
      round = openRound(tee.roundId);
    if (
      !scorer &&
      !tee.playerIds.some(
        (id) =>
          s.players.find((p) => p.id === id)?.email === user.email &&
          role === "player",
      )
    )
      fail(403, "Record pace only for your own group.");
    const completed = integer(b.completed, "Completed holes", 0, 18),
      at = timestamp(b.at),
      previous = s.checkpoints.filter((c) => c.teeId === tee.id);
    if (
      Date.parse(at) < Date.parse(tee.start) ||
      Date.parse(at) > Date.now() + 60000
    )
      fail(
        400,
        "Checkpoint time must be after the start and not in the future.",
      );
    if (previous.some((c) => c.completed >= completed))
      fail(409, "Progress must advance beyond the last checkpoint.");
    const row = {
      id: id(),
      teeId: tee.id,
      roundId: round.id,
      completed,
      at,
      recordedBy: user.name,
    };
    s.checkpoints.push(row);
    return result(row);
  }
  if (resource === "incidents") {
    if (method === "POST" && !resourceId) {
      if (role === "viewer")
        fail(403, "Read-only accounts cannot file incidents.");
      const row = {
        id: id(),
        eventId: b.eventId ? find(s.events, b.eventId, "Event").id : null,
        title: text(b.title, "Incident title"),
        details: text(b.details, "Details", 3000),
        severity: choice(
          b.severity,
          ["Info", "Assistance", "Urgent"],
          "Severity",
        ),
        status: "Open",
        created: new Date().toISOString(),
        createdBy: user.user_id,
        author: user.name,
      };
      s.incidents.unshift(row);
      return result(row);
    }
    requireStaff();
    const row = find(s.incidents, resourceId, "Incident");
    row.status = choice(
      b.status,
      ["Open", "Investigating", "Resolved"],
      "Status",
    );
    row.resolution =
      typeof b.resolution === "string" ? b.resolution.slice(0, 3000) : "";
    return result(row);
  }
  if (resource === "tasks") {
    if (method === "POST" && !resourceId) {
      requireStaff();
      if (
        b.assignee &&
        !orgMembers.some((m) => m.id === b.assignee && m.role !== "viewer")
      )
        fail(400, "Assign a member of this organisation.");
      const row = {
        id: id(),
        title: text(b.title, "Task title"),
        assignee: b.assignee || "",
        due: date(b.due),
        status: "Open",
        eventId: b.eventId ? find(s.events, b.eventId, "Event").id : null,
        createdBy: user.name,
      };
      s.tasks.push(row);
      return result(row);
    }
    if (role === "viewer") fail(403, "Read-only users cannot update tasks.");
    const row = find(s.tasks, resourceId, "Task");
    if (!staff && row.assignee !== user.user_id)
      fail(403, "Only organisers or the assignee can update this task.");
    row.status = choice(b.status, ["Open", "Done"], "Task status");
    return result(row);
  }
  if (resource === "messages") {
    requireStaff();
    if (!Array.isArray(b.playerIds) || b.playerIds.length > 500)
      fail(
        400,
        "Choose up to 500 recipients; empty means the entire organisation.",
      );
    b.playerIds.forEach((p) => find(s.players, p, "Recipient"));
    const row = {
      id: id(),
      title: text(b.title, "Subject"),
      body: text(b.body, "Message", 3000),
      playerIds: [...new Set(b.playerIds)],
      author: user.name,
      created: new Date().toISOString(),
    };
    s.messages.unshift(row);
    return result(row);
  }
  if (resource === "receipts") {
    const message = find(s.messages, b.messageId, "Message");
    if (
      message.playerIds.length &&
      !message.playerIds.some(
        (id) => s.players.find((p) => p.id === id)?.email === user.email,
      ) &&
      !staff
    )
      fail(403, "This message is not addressed to you.");
    if (
      !s.receipts.some(
        (r) => r.messageId === message.id && r.userId === user.user_id,
      )
    )
      s.receipts.push({
        id: id(),
        messageId: message.id,
        userId: user.user_id,
        name: user.name,
        read: new Date().toISOString(),
      });
    return result({ ok: true });
  }
  if (resource === "report-views") {
    requireStaff();
    if (method === "DELETE") {
      find(s.reportViews, resourceId, "Report");
      s.reportViews = s.reportViews.filter((v) => v.id !== resourceId);
      return result({ deleted: true });
    }
    if (!Object.hasOwn(reportDatasets, b.dataset))
      fail(400, "Choose an available report dataset.");
    if (
      !Array.isArray(b.columns) ||
      !b.columns.length ||
      new Set(b.columns).size !== b.columns.length ||
      b.columns.some((c) => !reportDatasets[b.dataset].includes(c))
    )
      fail(400, "Choose valid, unique report columns.");
    const existing = resourceId
      ? find(s.reportViews, resourceId, "Report")
      : null;
    const optionalText = (value, label, max) =>
      value == null || value === "" ? "" : text(value, label, max);
    const row = {
      id: existing?.id || id(),
      name: text(b.name, "Report name"),
      dataset: b.dataset,
      columns: b.columns,
      status: typeof b.status === "string" ? b.status.slice(0, 60) : "",
      subtitle: optionalText(b.subtitle, "Subtitle", 240),
      footer: optionalText(b.footer, "Footer", 240),
      orientation: choice(
        b.orientation || "portrait",
        ["portrait", "landscape"],
        "Orientation",
      ),
      showOrgName: b.showOrgName !== false,
      showTotals: b.showTotals === true,
    };
    if (existing) Object.assign(existing, row);
    else s.reportViews.push(row);
    return result(row);
  }
  return { handled: false };
}
