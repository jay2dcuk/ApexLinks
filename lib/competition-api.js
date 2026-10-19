import { randomUUID } from "node:crypto";
import { fail, text, integer, choice, date } from "./validation.js";
import { teamFormats, matchResult } from "../public/competition.js";
export function competitionOperation(
  s,
  { resource, resourceId, action, b, role, user, method },
) {
  const allowed = ["admin", "manager"],
    staff = allowed.includes(role),
    scorer = staff || role === "scorer";
  const requireStaff = () => {
    if (!staff) fail(403, "Only organisers can do this.");
  };
  const find = (a, id, label) => {
    const v = a.find((x) => x.id === id);
    if (!v) fail(404, label + " not found.");
    return v;
  };
  const addInvoice = (e, event) => {
    if (event.fee)
      s.invoices.push({
        id: randomUUID(),
        playerId: e.playerId,
        eventId: event.id,
        description: event.name + " entry",
        amount: event.fee,
        currency: "GBP",
        status: "Unpaid",
        reference: "",
        created: new Date().toISOString(),
      });
  };
  if (resource === "entry-status") {
    requireStaff();
    const entry = find(s.entries, resourceId, "Entry"),
      event = find(s.events, entry.eventId, "Tournament");
    if (["Completed", "Cancelled"].includes(event.status))
      fail(409, "Reopen this tournament first.");
    const previous = entry.status,
      next = choice(
        b.status,
        ["Registered", "Withdrawn", "Disqualified", "No return"],
        "Entry status",
      );
    if (next !== "Registered")
      entry.reason = text(b.reason, "Decision reason", 500);
    else {
      if (["Live"].includes(event.status))
        fail(409, "Reopen registration before reinstating a player.");
      if (
        s.entries.filter(
          (e) =>
            e.eventId === event.id &&
            e.status === "Registered" &&
            e.id !== entry.id,
        ).length >= event.capacity
      )
        fail(409, "The field is full.");
      entry.reason = "";
      if (previous === "Waitlisted") addInvoice(entry, event);
    }
    entry.status = next;
    if (
      previous === "Registered" &&
      next !== "Registered" &&
      ["Draft", "Open"].includes(event.status)
    ) {
      const waiting = s.entries.find(
        (e) => e.eventId === event.id && e.status === "Waitlisted",
      );
      if (waiting) {
        waiting.status = "Registered";
        waiting.promotedAt = new Date().toISOString();
        addInvoice(waiting, event);
      }
    }
    return { handled: true, result: entry };
  }
  if (resource === "team-cards") {
    const round = find(s.rounds, b.roundId, "Round"),
      event = find(s.events, round.eventId, "Tournament");
    if (!teamFormats.includes(event.format))
      fail(400, "This event does not use shared team cards.");
    if (round.status !== "Open" || !["Open", "Live"].includes(event.status))
      fail(409, "Scoring is closed.");
    const team = text(b.team, "Team", 80),
      entries = s.entries.filter(
        (e) =>
          e.eventId === event.id &&
          e.status === "Registered" &&
          e.team === team,
      );
    if (!entries.length) fail(400, "Register a team first.");
    if (role === "player") {
      if (
        !entries.some(
          (e) =>
            s.players.find((p) => p.id === e.playerId)?.email === user.email,
        )
      )
        fail(403, "You may only score your own team.");
    } else if (!scorer) fail(403, "Your role cannot score.");
    let c = s.teamCards.find((c) => c.roundId === round.id && c.team === team);
    if ((c?.version || 0) !== b.version)
      fail(409, "The team card changed. Reload before saving.");
    if (action === "unlock") {
      requireStaff();
      if (!c) fail(404, "Card not found.");
      c.status = "Draft";
      c.version++;
      return { handled: true, result: c };
    }
    if (c?.status === "Attested")
      fail(409, "An organiser must unlock the attested team card.");
    if (action === "attest") {
      if (!scorer) fail(403, "Only scorers and organisers may attest.");
      if (!c || c.scores.some((n) => n === null))
        fail(409, "Complete all holes first.");
      if (role === "scorer" && c.updatedBy === user.user_id)
        fail(403, "Another scorer must attest this card.");
      c.status = "Attested";
      c.version++;
      c.attestedBy = user.name;
      return { handled: true, result: c };
    }
    if (
      !Array.isArray(b.scores) ||
      b.scores.length !== 18 ||
      b.scores.some(
        (n) => n !== null && (!Number.isInteger(n) || n < 1 || n > 30),
      )
    )
      fail(
        400,
        "Enter 18 team scores, each blank or a whole number from 1–30.",
      );
    if (b.submit && b.scores.some((n) => n === null))
      fail(400, "Complete every hole to submit.");
    const handicap =
      c?.handicap ?? integer(b.handicap, "Team playing handicap", -10, 54);
    if (!c) {
      if (!staff)
        fail(403, "An organiser must initialise the team playing handicap.");
      c = { id: randomUUID(), roundId: round.id, team, handicap, version: 0 };
      s.teamCards.push(c);
    }
    Object.assign(c, {
      scores: b.scores,
      version: c.version + 1,
      status: b.submit ? "Submitted" : "Draft",
      updated: new Date().toISOString(),
      updatedBy: user.user_id,
    });
    return { handled: true, result: c };
  }
  if (resource === "matches") {
    requireStaff();
    if (resourceId) {
      const match = find(s.matches, resourceId, "Match"),
        round = find(s.rounds, match.roundId, "Round"),
        event = find(s.events, match.eventId, "Tournament");
      if (round.status !== "Open" || !["Open", "Live"].includes(event.status))
        fail(409, "Reopen the event and round first.");
      if (action === "reopen") {
        if (
          s.matches.some(
            (m) => m.eventId === match.eventId && m.stage > match.stage,
          )
        )
          fail(409, "Later bracket stages already exist.");
        match.status = "Active";
        match.winner = null;
        for (const c of s.cards.filter(
          (c) =>
            c.roundId === round.id &&
            [match.playerA, match.playerB].includes(c.playerId),
        )) {
          c.status = "Draft";
          c.version++;
        }
        return { handled: true, result: match };
      }
      if (match.status === "Completed")
        fail(409, "This match is already finalised.");
      const cardA = s.cards.find(
          (c) => c.roundId === round.id && c.playerId === match.playerA,
        ),
        cardB = s.cards.find(
          (c) => c.roundId === round.id && c.playerId === match.playerB,
        ),
        entryA = s.entries.find(
          (e) => e.eventId === event.id && e.playerId === match.playerA,
        ),
        entryB = s.entries.find(
          (e) => e.eventId === event.id && e.playerId === match.playerB,
        );
      const result = matchResult(
        cardA?.scores || [],
        cardB?.scores || [],
        round,
        entryA.handicap,
        entryB.handicap,
      );
      let winner =
        result.winner === "A"
          ? match.playerA
          : result.winner === "B"
            ? match.playerB
            : null;
      if (b.winner) {
        if (![match.playerA, match.playerB].includes(b.winner))
          fail(400, "Winner must be in this match.");
        winner = b.winner;
        match.reason = text(b.reason, "Playoff / concession decision", 500);
      } else if (!winner)
        fail(
          409,
          "A tied or unfinished match needs an organiser playoff/concession decision and reason.",
        );
      match.winner = winner;
      match.result = b.winner ? match.reason : result.label;
      match.status = "Completed";
      match.finalisedBy = user.name;
      for (const card of [cardA, cardB].filter(Boolean)) {
        card.status = "Attested";
        card.version++;
        card.attestedBy = user.name;
      }
      return { handled: true, result: match };
    }
    const round = find(s.rounds, b.roundId, "Round"),
      event = find(s.events, round.eventId, "Tournament");
    if (event.format !== "Match play") fail(400, "Select a match-play event.");
    if (round.status !== "Open" || !["Open", "Live"].includes(event.status))
      fail(409, "Open this tournament and round first.");
    if (s.matches.some((m) => m.roundId === round.id))
      fail(409, "This round already has matches.");
    if (s.cards.some((c) => c.roundId === round.id))
      fail(409, "Generate matches before scoring begins.");
    const existing = s.matches.filter((m) => m.eventId === event.id);
    const stage = existing.length
      ? Math.max(...existing.map((m) => m.stage)) + 1
      : 1;
    let players;
    if (stage === 1) {
      if (round.number !== 1) fail(409, "Start the bracket in round one.");
      players = s.entries
        .filter((e) => e.eventId === event.id && e.status === "Registered")
        .sort((a, b) => a.handicap - b.handicap)
        .map((e) => e.playerId);
      if (
        players.length < 2 ||
        players.length > 64 ||
        (players.length & (players.length - 1)) !== 0
      )
        fail(
          400,
          "A knockout field must contain 2, 4, 8, 16, 32, or 64 players.",
        );
    } else {
      const prior = existing.filter((m) => m.stage === stage - 1);
      if (prior.length === 1) fail(409, "The final has already been created.");
      if (prior.some((m) => m.status !== "Completed"))
        fail(409, "Finalise every previous match first.");
      players = prior.sort((a, b) => a.slot - b.slot).map((m) => m.winner);
      if (round.number !== stage)
        fail(
          409,
          "Create a later competition round for the next bracket stage.",
        );
    }
    for (let i = 0; i < players.length / 2; i++) {
      const a = stage === 1 ? players[i] : players[i * 2],
        c = stage === 1 ? players[players.length - 1 - i] : players[i * 2 + 1];
      s.matches.push({
        id: randomUUID(),
        eventId: event.id,
        roundId: round.id,
        stage,
        slot: i + 1,
        playerA: a,
        playerB: c,
        status: "Active",
        winner: null,
      });
    }
    return { handled: true, result: { ok: true } };
  }
  if (resource === "handicap-import") {
    requireStaff();
    if (
      !Array.isArray(b.records) ||
      !b.records.length ||
      b.records.length > 500
    )
      fail(400, "Import 1–500 handicap records.");
    const results = b.records.map((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record))
        fail(400, "Each imported record must be an object.");
      const player = s.players.find(
        (p) =>
          p.id === record.playerId ||
          (record.playerEmail &&
            p.email === String(record.playerEmail).toLowerCase()),
      );
      if (!player)
        fail(400, "A supplied handicap record does not match a player.");
      return competitionOperation(s, {
        resource: "handicap-records",
        b: { ...record, playerId: player.id },
        role,
        user,
      }).result;
    });
    return { handled: true, result: { imported: results.length } };
  }
  if (resource === "handicap-records") {
    requireStaff();
    const player = find(s.players, b.playerId, "Player"),
      index = Number(b.index);
    if (
      !Number.isFinite(index) ||
      index < -10 ||
      index > 54 ||
      Math.round(index * 10) !== index * 10
    )
      fail(
        400,
        "Handicap index must have at most one decimal place, between −10 and 54.",
      );
    const record = {
      id: randomUUID(),
      playerId: player.id,
      provider: choice(
        b.provider,
        ["England Golf / MyEG", "USGA / GHIN", "Other federation", "Manual"],
        "Provider",
      ),
      membershipId: text(b.membershipId, "Membership / CDH / GHIN number", 80),
      index,
      asOf: date(b.asOf),
      source: "Organiser-provided record",
      verified: false,
      recordedBy: user.name,
      created: new Date().toISOString(),
    };
    s.handicapRecords.unshift(record);
    if (b.courseId) {
      const course = find(s.courses, b.courseId, "Course");
      if (course.slope == null || course.rating == null)
        fail(
          400,
          "Set course rating and slope before calculating a course handicap.",
        );
      const allowance = integer(
          b.allowance ?? 100,
          "Allowance percentage",
          1,
          100,
        ),
        courseHandicap = Math.round(
          (index * course.slope) / 113 +
            course.rating -
            course.pars.reduce((a, b) => a + b, 0),
        );
      record.courseHandicap = courseHandicap;
      record.allowance = allowance;
      record.playingHandicap = Math.round(
        (((index * course.slope) / 113 +
          course.rating -
          course.pars.reduce((a, b) => a + b, 0)) *
          allowance) /
          100,
      );
      player.handicap = integer(
        record.playingHandicap,
        "Calculated playing handicap",
        -10,
        54,
      );
    }
    return { handled: true, result: record };
  }
  if (resource === "booking-rules") {
    requireStaff();
    const course = find(s.courses, b.courseId, "Course");
    const timezone = text(b.timezone, "Timezone", 80);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      fail(400, "Use a valid IANA timezone such as Europe/London.");
    }
    if (
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(b.open) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(b.close) ||
      b.open >= b.close ||
      b.close > "23:59" ||
      b.open < "00:00"
    )
      fail(400, "Opening hours must be valid and close after opening.");
    if (
      !Array.isArray(b.closedDays) ||
      b.closedDays.some((n) => !Number.isInteger(n) || n < 0 || n > 6)
    )
      fail(400, "Closed days must be weekday numbers 0–6.");
    if (!Array.isArray(b.closedDates) || b.closedDates.length > 366)
      fail(400, "Provide at most 366 holiday dates.");
    const rule = {
      courseId: course.id,
      timezone,
      open: b.open,
      close: b.close,
      interval: integer(b.interval, "Booking interval", 5, 30),
      closedDays: [...new Set(b.closedDays)],
      closedDates: b.closedDates.map(date),
    };
    s.bookingRules = s.bookingRules.filter((r) => r.courseId !== course.id);
    s.bookingRules.push(rule);
    return { handled: true, result: rule };
  }
  return { handled: false };
}
export function validateBookingRules(s, courseId, start, duration) {
  const rule = s.bookingRules.find((r) => r.courseId === courseId);
  if (!rule) return;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: rule.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(new Date(start))
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.weekday,
    ),
    date = parts.year + "-" + parts.month + "-" + parts.day,
    clock = parts.hour + ":" + parts.minute,
    minutes = Number(parts.hour) * 60 + Number(parts.minute),
    opening = Number(rule.open.slice(0, 2)) * 60 + Number(rule.open.slice(3)),
    closing = Number(rule.close.slice(0, 2)) * 60 + Number(rule.close.slice(3));
  if (
    rule.closedDays.includes(weekday) ||
    rule.closedDates.includes(date) ||
    clock < rule.open ||
    minutes + duration > closing ||
    (minutes - opening) % rule.interval !== 0
  )
    fail(
      409,
      "This tee time is outside the course booking hours, on a closed date, or off the slot interval.",
    );
}
