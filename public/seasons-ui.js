import { seasonStandings, seasonFormats } from "./seasons.js";
export function seasonsView({ s, org, selectedSeasonId }, h) {
  const { heading, button, table, esc, shortDate } = h,
    staff = ["admin", "manager"].includes(org.role),
    season = s.seasons.find((r) => r.id === selectedSeasonId) || s.seasons[0];
  if (!season)
    return (
      heading(
        "Season standings",
        "Points across completed, attested individual tournaments.",
        staff ? button("Create season", "season-new") : "",
      ) + '<section class="panel empty"><h2>No seasons yet.</h2></section>'
    );
  const rows = seasonStandings(s, season),
    links = s.seasonEvents.filter((r) => r.seasonId === season.id);
  return `${heading("Season standings", "Tournament points, best results and deliberate finalisation.", staff ? button("Create season", "season-new") + button("Export standings", "season-export", "outline", `data-id="${season.id}"`) : "")}<section class="panel settings-section"><label>Season<select id="season-picker">${s.seasons.map((r) => `<option value="${r.id}" ${r.id === season.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label><h2>${esc(season.name)} · ${season.status}</h2><p>${shortDate(season.start)} – ${shortDate(season.end)} · Division ${esc(season.division)} · ${season.bestOf ? `Best ${season.bestOf}` : "All results"} count · Minimum ${season.minEvents} events to qualify.</p><p>Position points: ${season.points.join(", ")}. Tied places share the points for occupied positions. Ties on season points use counted wins, then share rank.</p>${staff ? `<div class="button-row">${season.status === "Open" ? button("Edit season rules", "season-edit", "outline", `data-id="${season.id}"`) + button("Link tournament", "season-link", "outline", `data-id="${season.id}"`) + button("Finalise standings", "season-finalise", "outline", `data-id="${season.id}"`) : button("Reopen season", "season-reopen", "outline", `data-id="${season.id}"`)}</div>` : ""}${season.status === "Final" ? "<p>These standings are frozen. Reopen with a reason to include later tournament corrections.</p>" : ""}</section><section class="panel">${table(["POS", "PLAYER", "POINTS", "PLAYED", "COUNTED", "WINS", ""], rows.map((r) => `<tr><td>${r.position ?? "Not qualified"}</td><td>${esc(r.name)}</td><td>${r.points}</td><td>${r.played}</td><td>${r.counted}</td><td>${r.wins}</td><td>${button("Results", "season-results", "text-button", `data-id="${season.id}:${r.playerId}"`)}</td></tr>`).join(""))}</section><section class="panel"><div class="panel-head"><h2>Linked tournaments</h2></div>${table(
    ["TOURNAMENT", "DATE", "STATUS", "MULTIPLIER", ""],
    links
      .map((link) => {
        const e = s.events.find((e) => e.id === link.eventId);
        return `<tr><td>${esc(e?.name)}</td><td>${shortDate(e?.date)}</td><td>${esc(e?.status)}</td><td>${link.weight}×</td><td>${staff && season.status === "Open" ? button("Remove", "season-unlink", "text-button", `data-id="${link.id}"`) : ""}</td></tr>`;
      })
      .join(""),
  )}<p class="panel-foot">Only completed individual stroke, net, Stableford and Bogey/Par events with closed rounds and complete attested cards contribute points. Reopened tournaments are excluded from live standings.</p></section>`;
}
export async function seasonAction(name, id, { s, org }, h) {
  if (!name.startsWith("season-")) return false;
  const {
      dialog,
      input,
      select,
      write,
      render,
      toast,
      table,
      esc,
      downloadCSV,
      today,
      setSeason,
    } = h,
    season = s.seasons.find((r) => r.id === id);
  if (["season-new", "season-edit"].includes(name)) {
    const row = name === "season-edit" ? season : null,
      year = today().slice(0, 4);
    dialog(
      row ? "Edit season rules" : "Create season",
      input("Season name", "name", row?.name || "", "text", "required") +
        input(
          "Start date",
          "start",
          row?.start || year + "-01-01",
          "date",
          "required",
        ) +
        input(
          "End date",
          "end",
          row?.end || year + "-12-31",
          "date",
          "required",
        ) +
        input(
          "Division",
          "division",
          row?.division || "Open",
          "text",
          "required",
        ) +
        input(
          "Best results to count (0 means all)",
          "bestOf",
          row?.bestOf ?? 0,
          "number",
          'min="0" max="100" required',
        ) +
        input(
          "Minimum events to qualify",
          "minEvents",
          row?.minEvents ?? 1,
          "number",
          'min="1" max="100" required',
        ) +
        input(
          "Points by finishing position",
          "points",
          (row?.points || [100, 75, 60, 50, 40, 30, 20, 10]).join(", "),
          "text",
          "required",
        ),
      async (form) => {
        const values = String(form.get("points")).split(",");
        if (values.some((v) => !v.trim()))
          throw Error("Enter comma-separated points without empty positions.");
        const result = await write(
          "seasons" + (row ? "/" + row.id : ""),
          {
            ...Object.fromEntries(form),
            bestOf: Number(form.get("bestOf")),
            minEvents: Number(form.get("minEvents")),
            points: values.map(Number),
          },
          row ? "PATCH" : "POST",
        );
        setSeason(result.id);
      },
    );
  } else if (name === "season-link") {
    const events = s.events.filter(
      (e) =>
        seasonFormats.includes(e.format) &&
        e.date >= season.start &&
        e.date <= season.end &&
        !s.seasonEvents.some((r) => r.seasonId === id && r.eventId === e.id),
    );
    if (!events.length) {
      toast(
        "Create an eligible individual tournament within the season dates first.",
      );
      return true;
    }
    dialog(
      "Link season tournament",
      select(
        "Tournament",
        "eventId",
        events.map((e) => [e.id, e.name]),
        events[0].id,
      ) +
        input(
          "Points multiplier",
          "weight",
          1,
          "number",
          'min="1" max="5" required',
        ),
      async (form) =>
        write("season-events", {
          seasonId: id,
          eventId: form.get("eventId"),
          weight: Number(form.get("weight")),
        }),
    );
  } else if (name === "season-finalise") {
    if (
      confirm(
        "Freeze these season standings? Later corrections require reopening the season with a reason.",
      )
    ) {
      await write(`seasons/${id}/finalise`, {});
      render();
    }
  } else if (name === "season-reopen") {
    dialog(
      "Reopen season",
      input(
        "Reason for reopening",
        "reason",
        "",
        "text",
        'required maxlength="240"',
      ),
      async (form) =>
        write(`seasons/${id}/reopen`, { reason: form.get("reason") }),
    );
  } else if (name === "season-unlink") {
    if (confirm("Remove this tournament from season points?")) {
      await write("season-events/" + id, {}, "DELETE");
      render();
    }
  } else if (name === "season-export") {
    downloadCSV("apexlinks-season-standings.csv", [
      [
        "Position",
        "Player",
        "Points",
        "Played",
        "Counted",
        "Wins",
        "Qualified",
      ],
      ...seasonStandings(s, season).map((r) => [
        r.position,
        r.name,
        r.points,
        r.played,
        r.counted,
        r.wins,
        r.qualified,
      ]),
    ]);
  } else if (name === "season-results") {
    const [seasonId, playerId] = id.split(":"),
      row = seasonStandings(
        s,
        s.seasons.find((r) => r.id === seasonId),
      ).find((r) => r.playerId === playerId);
    dialog(
      row.name + " · season results",
      table(
        ["EVENT", "PLACE", "POINTS", "COUNTED"],
        row.results
          .map(
            (r) =>
              `<tr><td>${esc(r.eventName)}</td><td>${r.position}</td><td>${r.points}</td><td>${r.counted ? "Yes" : "Dropped"}</td></tr>`,
          )
          .join(""),
      ),
      null,
      { wide: true },
    );
  }
  return true;
}
