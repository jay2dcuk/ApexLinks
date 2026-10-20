import {
  eventReadiness,
  paceStatus,
  reportDatasets,
  reportRows,
} from "./operations.js";
export function operationsView(ctx, h) {
  const { s, me, org } = ctx,
    { heading, button, table, esc, time, shortDate } = h,
    staff = ["admin", "manager"].includes(org.role);
  return `${heading("Club operations", "Prepare the field, track pace, and keep the day running.", staff ? button("Create task", "ops-task") + button("Send club message", "ops-message", "outline") : org.role !== "viewer" ? button("Report an incident", "ops-incident") : "")}<div class="ops-grid"><section class="panel"><div class="panel-head"><h2>Event readiness</h2></div>${
    s.events
      .filter((e) => !["Completed", "Cancelled"].includes(e.status))
      .map((e) => {
        const readiness = eventReadiness(s, e.id);
        return `<article class="notice"><h3>${esc(e.name)} <span class="readiness">${readiness.percent}%</span></h3><ul>${readiness.checks.map((c) => `<li>${c.ready ? "✓" : "○"} ${c.name}</li>`).join("")}</ul></article>`;
      })
      .join("") || '<p class="empty">Create an event to see readiness.</p>'
  }</section><section class="panel"><div class="panel-head"><h2>Staff tasks</h2></div>${table(["TASK", "DUE", "STATUS", ""], s.tasks.map((t) => `<tr><td>${esc(t.title)}</td><td>${shortDate(t.due)}</td><td>${t.status}</td><td>${staff || t.assignee === me.id ? button(t.status === "Done" ? "Reopen" : "Complete", "ops-task-status", "text-button", `data-id="${t.id}"`) : ""}</td></tr>`).join(""))}</section></div><section class="panel ops-panel"><div class="panel-head"><h2>Pace of play</h2><div class="button-row">${org.role !== "viewer" ? button("Record checkpoint", "ops-checkpoint", "outline") : ""}${staff ? button("Set pace target", "ops-pace", "outline") : ""}</div></div>${table(
    ["GROUP", "START", "PROGRESS", "DELAY", "STATE", "EXPECTED FINISH"],
    s.teeTimes
      .map((t) => {
        const pace = paceStatus(s, t.id);
        return `<tr><td>${t.playerIds.map((id) => esc(s.players.find((p) => p.id === id)?.name)).join(" · ")}</td><td>${time(t.start)}</td><td>${pace.completed}/18</td><td>${pace.delay == null ? "No report" : pace.delay + " min"}</td><td>${pace.risk}</td><td>${time(pace.expectedFinish)}</td></tr>`;
      })
      .join(""),
  )}<div class="panel-foot">Based on manually recorded checkpoints and the round target. This is not GPS tracking or an automatic safety alert service.</div></section><section class="panel ops-panel"><div class="panel-head"><h2>Incident desk</h2>${org.role !== "viewer" ? button("Report incident", "ops-incident", "outline") : ""}</div>${table(["INCIDENT", "PRIORITY", "STATUS", "LOGGED", ""], s.incidents.map((i) => `<tr><td>${esc(i.title)}<small class="decision-reason">${esc(i.details)}</small></td><td>${i.severity}</td><td>${i.status}</td><td>${time(i.created)}</td><td>${staff ? button("Update", "ops-incident-status", "text-button", `data-id="${i.id}"`) : ""}</td></tr>`).join(""))}</section>${staff ? `<section class="panel ops-panel"><div class="panel-head"><h2>Reusable tournament templates</h2></div>${table(["TEMPLATE", "FORMAT", "ROUNDS", ""], s.templates.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.event.format)}</td><td>${t.rounds.length}</td><td>${button("Create event", "ops-apply-template", "text-button", `data-id="${t.id}"`)}</td></tr>`).join(""))}</section>` : ""}`;
}
export function inboxView(ctx, h) {
  const { s, me, org } = ctx,
    { heading, button, esc, time } = h;
  return `${heading("Club inbox", "Messages stay inside your organisation. This does not send email or SMS.", ["admin", "manager"].includes(org.role) ? button("New message", "ops-message") : "")}<section class="panel">${
    s.messages
      .map((m) => {
        const read = s.receipts.some(
          (r) => r.messageId === m.id && r.userId === me.id,
        );
        return `<article class="notice"><div class="panel-head"><h2>${esc(m.title)}</h2><span>${read ? "Read" : button("Mark read", "ops-read", "outline", `data-id="${m.id}"`)}</span></div><p class="multiline">${esc(m.body)}</p><small>${esc(m.author)} · ${time(m.created)}${["admin", "manager"].includes(org.role) ? ` · ${s.receipts.filter((r) => r.messageId === m.id).length} read receipts` : ""}</small></article>`;
      })
      .join("") || '<div class="empty"><h2>No messages yet.</h2></div>'
  }</section>`;
}
export function reportsExtension(ctx, h) {
  if (!["admin", "manager"].includes(ctx.org.role)) return "";
  const { button, table, esc } = h;
  return `<section class="panel ops-panel"><div class="panel-head"><h2>Custom report views</h2><p>Financial amounts export in minor units (pence).</p>${button("Build report", "ops-report", "outline")}</div>${table(["REPORT", "SOURCE", "COLUMNS", ""], ctx.s.reportViews.map((v) => `<tr><td>${esc(v.name)}</td><td>${v.dataset}</td><td>${v.columns.map(esc).join(", ")}</td><td>${button("Preview / print", "ops-report-print", "text-button", `data-id="${v.id}"`)}${button("Edit", "ops-report-edit", "text-button", `data-id="${v.id}"`)}${button("Export CSV", "ops-report-export", "text-button", `data-id="${v.id}"`)}${button("Delete", "ops-report-delete", "text-button", `data-id="${v.id}"`)}</td></tr>`).join(""))}</section>`;
}
export async function operationsAction(name, id, ctx, h) {
  if (!name.startsWith("ops-")) return false;
  const { s, me, org, eventId, roundId } = ctx,
    {
      dialog,
      input,
      select,
      textArea,
      button,
      write,
      api,
      render,
      toast,
      downloadCSV,
      today,
      localTime,
      iso,
    } = h,
    playerChoices = s.players.map((p) => [p.id, p.name]),
    rounds = s.rounds.map((r) => [
      r.id,
      (s.events.find((e) => e.id === r.eventId)?.name || "Event") +
        " · Round " +
        r.number,
    ]),
    current = roundId || s.rounds[0]?.id;
  const requireRounds = () => {
    if (!rounds.length) throw Error("Add competition rounds first.");
  };
  switch (name) {
    case "ops-shotgun":
      requireRounds();
      dialog(
        "Generate shotgun start",
        select("Round", "roundId", rounds, current) +
          input(
            "Start (your timezone)",
            "start",
            localTime(),
            "datetime-local",
            "required",
          ) +
          input(
            "Players per group",
            "groupSize",
            4,
            "number",
            'min="2" max="4" required',
          ) +
          input(
            "Groups per hole",
            "groupsPerHole",
            1,
            "number",
            'min="1" max="2" required',
          ) +
          input(
            "Starting holes (comma separated)",
            "holes",
            "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18",
            "text",
            "required",
          ) +
          "<p>This replaces this round’s tee sheet and reserves the course for the shotgun window. It is locked once scoring starts.</p>",
        async (f) =>
          write("shotgun", {
            ...Object.fromEntries(f),
            start: iso(f, "start"),
            groupSize: Number(f.get("groupSize")),
            groupsPerHole: Number(f.get("groupsPerHole")),
            holes: String(f.get("holes"))
              .split(",")
              .map((v) => Number(v.trim())),
          }),
      );
      break;
    case "ops-marker":
      requireRounds();
      dialog(
        "Assign scoring marker",
        select("Round", "roundId", rounds, current) +
          select(
            "Player being marked",
            "playerId",
            playerChoices,
            playerChoices[0]?.[0],
          ) +
          select(
            "Marker player profile",
            "markerPlayerId",
            playerChoices,
            playerChoices[1]?.[0],
          ) +
          "<p>The marker must be a different player with a linked, scoring-capable account in this organisation.</p>",
        async (f) => write("markers", Object.fromEntries(f)),
      );
      break;
    case "ops-tee":
      requireRounds();
      dialog(
        "Individual round tee",
        select("Round", "roundId", rounds, current) +
          select("Player", "playerId", playerChoices, playerChoices[0]?.[0]) +
          select(
            "Course tee set",
            "courseId",
            s.courses.map((c) => [c.id, c.name + " · " + c.tee]),
            s.courses[0]?.id,
          ) +
          input(
            "Round playing handicap",
            "handicap",
            18,
            "number",
            'min="-72" max="144" required',
          ) +
          "<p>Use tee sets sharing the same course name. Locked once scoring starts. Individual stroke/net/Stableford only.</p>",
        async (f) =>
          write("round-tees", {
            ...Object.fromEntries(f),
            handicap: Number(f.get("handicap")),
          }),
      );
      break;
    case "ops-template":
      if (!eventId) throw Error("Select a tournament first.");
      dialog(
        "Save tournament template",
        input("Template name", "name", "", "text", "required"),
        async (f) => write("templates", { eventId, name: f.get("name") }),
      );
      break;
    case "ops-apply-template":
      dialog(
        "Create from template",
        input("Tournament name", "name", "", "text", "required") +
          input("First date", "date", today(), "date", "required"),
        async (f) => write("templates/" + id + "/apply", Object.fromEntries(f)),
      );
      break;
    case "ops-playoff": {
      const m = s.matches.find((m) => m.id === id);
      dialog(
        "Record playoff hole",
        input(
          "Course hole number",
          "hole",
          1,
          "number",
          'min="1" max="18" required',
        ) +
          input(
            s.players.find((p) => p.id === m.playerA)?.name + " gross score",
            "scoreA",
            4,
            "number",
            'min="1" max="30" required',
          ) +
          input(
            s.players.find((p) => p.id === m.playerB)?.name + " gross score",
            "scoreB",
            4,
            "number",
            'min="1" max="30" required',
          ),
        async (f) =>
          write("playoff-holes", {
            matchId: id,
            version: m.playoffVersion || 0,
            hole: Number(f.get("hole")),
            scoreA: Number(f.get("scoreA")),
            scoreB: Number(f.get("scoreB")),
          }),
      );
      break;
    }
    case "ops-pace":
      requireRounds();
      dialog(
        "Pace target",
        select("Round", "roundId", rounds, current) +
          input(
            "Target minutes per hole",
            "minutesPerHole",
            14,
            "number",
            'min="5" max="30" required',
          ),
        async (f) =>
          write("round-pace/" + f.get("roundId"), {
            minutesPerHole: Number(f.get("minutesPerHole")),
          }),
      );
      break;
    case "ops-checkpoint": {
      const groups = s.teeTimes.filter(
        (t) =>
          ["admin", "manager", "scorer"].includes(org.role) ||
          (org.role === "player" &&
            t.playerIds.some(
              (id) => s.players.find((p) => p.id === id)?.email === me.email,
            )),
      );
      if (!groups.length) throw Error("No eligible tee groups.");
      dialog(
        "Record pace checkpoint",
        select(
          "Group",
          "teeId",
          groups.map((t) => [
            t.id,
            t.playerIds
              .map((id) => s.players.find((p) => p.id === id)?.name)
              .join(" / "),
          ]),
          groups[0].id,
        ) +
          input(
            "Number of completed holes",
            "completed",
            1,
            "number",
            'min="1" max="18" required',
          ) +
          input(
            "Checkpoint time (your timezone)",
            "at",
            localTime(new Date().toISOString()),
            "datetime-local",
            "required",
          ),
        async (f) =>
          write("checkpoints", {
            teeId: f.get("teeId"),
            completed: Number(f.get("completed")),
            at: iso(f, "at"),
          }),
      );
      break;
    }
    case "ops-incident":
      dialog(
        "Report club incident",
        input("Title", "title", "", "text", "required") +
          select(
            "Priority",
            "severity",
            ["Info", "Assistance", "Urgent"],
            "Assistance",
          ) +
          textArea("Details", "details") +
          select(
            "Event (optional)",
            "eventId",
            [["", "Club-wide"], ...s.events.map((e) => [e.id, e.name])],
            eventId || "",
          ),
        async (f) => write("incidents", Object.fromEntries(f)),
      );
      break;
    case "ops-incident-status": {
      const i = s.incidents.find((i) => i.id === id);
      dialog(
        "Update incident",
        select(
          "Status",
          "status",
          ["Open", "Investigating", "Resolved"],
          i.status,
        ) + textArea("Resolution notes", "resolution", i.resolution || ""),
        async (f) => write("incidents/" + id, Object.fromEntries(f), "PATCH"),
      );
      break;
    }
    case "ops-task": {
      const directory = await api(`orgs/${org.id}/directory`);
      dialog(
        "Create staff task",
        input("Task title", "title", "", "text", "required") +
          input("Due date", "due", today(), "date", "required") +
          select(
            "Assignee",
            "assignee",
            [
              ["", "Unassigned"],
              ...directory.members.map((m) => [m.id, m.name]),
            ],
            "",
          ) +
          select(
            "Related event",
            "eventId",
            [["", "Club-wide"], ...s.events.map((e) => [e.id, e.name])],
            eventId || "",
          ),
        async (f) => write("tasks", Object.fromEntries(f)),
      );
      break;
    }
    case "ops-task-status":
      await write(
        "tasks/" + id,
        {
          status:
            s.tasks.find((t) => t.id === id).status === "Done"
              ? "Open"
              : "Done",
        },
        "PATCH",
      );
      render();
      break;
    case "ops-message":
      dialog(
        "Send in-app club message",
        input("Subject", "title", "", "text", "required") +
          textArea("Message", "body") +
          "<fieldset><legend>Recipients (leave empty for everyone)</legend>" +
          s.players
            .map(
              (p) =>
                `<label class="check-label"><input type="checkbox" name="playerIds" value="${p.id}">${h.esc(p.name)}</label>`,
            )
            .join("") +
          "</fieldset>",
        async (f) =>
          write("messages", {
            title: f.get("title"),
            body: f.get("body"),
            playerIds: f.getAll("playerIds"),
          }),
      );
      break;
    case "ops-read":
      await write("receipts", { messageId: id });
      render();
      break;
    case "ops-report-edit":
    case "ops-report": {
      const view =
        name === "ops-report-edit"
          ? s.reportViews.find((v) => v.id === id)
          : null;
      const d = dialog(
        "Build custom report",
        input("Report name", "name", view?.name || "", "text", "required") +
          select(
            "Data source",
            "dataset",
            Object.keys(reportDatasets),
            view?.dataset || "players",
          ) +
          input("Subtitle", "subtitle", view?.subtitle || "") +
          input("Printed footer", "footer", view?.footer || "") +
          select(
            "Page orientation",
            "orientation",
            ["portrait", "landscape"],
            view?.orientation || "portrait",
          ) +
          `<label class="check-label"><input type="checkbox" name="showOrgName" ${view?.showOrgName !== false ? "checked" : ""}>Include club name</label><label class="check-label"><input type="checkbox" name="showTotals" ${view?.showTotals ? "checked" : ""}>Show monetary totals</label>` +
          '<fieldset class="report-columns"><legend>Columns</legend></fieldset>' +
          input("Status equals (optional)", "status", view?.status || ""),
        async (f) =>
          write("report-views" + (view ? "/" + view.id : ""), {
            subtitle: f.get("subtitle"),
            footer: f.get("footer"),
            orientation: f.get("orientation"),
            showOrgName: f.has("showOrgName"),
            showTotals: f.has("showTotals"),
            name: f.get("name"),
            dataset: f.get("dataset"),
            status: f.get("status"),
            columns: f.getAll("columns"),
          }),
      );
      const refresh = () => {
        const dataset = d.querySelector('[name="dataset"]').value;
        d.querySelector(".report-columns").innerHTML =
          "<legend>Columns</legend>" +
          reportDatasets[dataset]
            .map(
              (c) =>
                `<label class="check-label"><input type="checkbox" name="columns" value="${c}" ${!view || dataset !== view.dataset || view.columns.includes(c) ? "checked" : ""}>${c}</label>`,
            )
            .join("");
      };
      d.querySelector('[name="dataset"]').onchange = refresh;
      refresh();
      break;
    }
    case "ops-report-print":
      window.open(
        `/print.html?org=${encodeURIComponent(org.id)}&view=${encodeURIComponent(id)}`,
        "_blank",
        "noopener",
      );
      break;
    case "ops-report-delete":
      if (confirm("Delete this saved report layout?"))
        await write("report-views/" + id, {}, "DELETE");
      render();
      break;
    case "ops-report-export": {
      const v = s.reportViews.find((v) => v.id === id),
        data = reportRows(s, v);
      downloadCSV("apexlinks-report.csv", [
        v.columns,
        ...data.map((r) => v.columns.map((c) => r[c])),
      ]);
      break;
    }
    default:
      return false;
  }
  return true;
}
