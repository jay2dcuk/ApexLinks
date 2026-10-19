import { defaultPars, defaultIndexes, cardTotals } from "./scoring.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    (n || 0) / 100,
  );
const shortDate = (s) =>
  s
    ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString(
        "en-GB",
        { day: "numeric", month: "short", year: "numeric" },
      )
    : "—";
const time = (s) =>
  new Date(s).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const initials = (s) =>
  s
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
const today = () => new Date().toISOString().slice(0, 10);
const label = (n) => (n === 0 ? "E" : n > 0 ? "+" + n : String(n));
let me = null,
  csrf = "",
  orgs = [],
  org = null,
  s = null,
  config = {},
  page = "Overview",
  eventId = "",
  tab = "Overview",
  roundId = "",
  playerId = "",
  query = "",
  rows = [],
  teams = [],
  dirty = false,
  authMode = "login";
const nav = {
  Overview: "▦",
  Tournaments: "⚑",
  Players: "♙",
  Courses: "◇",
  Bookings: "▤",
  Memberships: "◎",
  Finance: "£",
  Reports: "↗",
  Settings: "⚙",
};
const manager = () => ["admin", "manager"].includes(org?.role),
  scorer = () => ["admin", "manager", "scorer"].includes(org?.role);
const player = (id) => s.players.find((p) => p.id === id),
  course = (id) => s.courses.find((c) => c.id === id),
  event = () => s.events.find((e) => e.id === eventId),
  round = () => s.rounds.find((r) => r.id === roundId);
const field = () =>
  s.entries.filter((e) => e.eventId === eventId && e.status === "Registered");
function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.classList.add("visible");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => t.classList.remove("visible"), 5500);
}
async function api(path, method = "GET", body) {
  const res = await fetch("/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw Error("The server is unavailable. Please try again.");
  }
  if (!res.ok) {
    if (res.status === 401 && me) {
      me = null;
      renderAuth();
    }
    throw Error(data.error || "Request failed.");
  }
  return data;
}
const endpoint = (p) => `orgs/${org.id}/${p}`;
async function loadOrg(id) {
  const d = await api(`orgs/${id}/state`);
  org = d.organisation;
  s = d.state;
  sessionStorage.setItem("apex-org", id);
  if (!s.events.some((e) => e.id === eventId)) {
    eventId = s.events[0]?.id || "";
    roundId = "";
  }
  if (!s.rounds.some((r) => r.id === roundId && r.eventId === eventId))
    roundId = s.rounds.find((r) => r.eventId === eventId)?.id || "";
  if (!s.players.some((p) => p.id === playerId))
    playerId = s.players[0]?.id || "";
  if (page === "Tournament" && eventId) await loadLeaderboard();
}
async function refresh() {
  await loadOrg(org.id);
  dirty = false;
  render();
}
async function write(path, body = {}, method = "POST") {
  const result = await api(endpoint(path), method, body);
  await loadOrg(org.id);
  return result;
}
async function loadLeaderboard() {
  if (!eventId) return;
  const d = await api(endpoint(`leaderboard/${eventId}?round=${roundId}`));
  rows = d.rows;
  teams = d.teams;
}
function action(fn) {
  return async (e) => {
    const b = e?.currentTarget;
    try {
      if (b) b.disabled = true;
      await fn(e);
    } catch (err) {
      toast(err.message);
    } finally {
      if (b) b.disabled = false;
    }
  };
}
function button(text, op, kind = "primary", attributes = "") {
  return `<button class="${kind}" data-action="${op}" ${attributes}>${text}</button>`;
}
function input(label, name, value = "", type = "text", attrs = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
}
function select(label, name, items, value) {
  return `<label>${label}<select name="${name}">${items
    .map((x) => {
      const [v, t] = Array.isArray(x) ? x : [x, x];
      return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`;
    })
    .join("")}</select></label>`;
}
function textArea(label, name, value = "") {
  return `<label>${label}<textarea name="${name}" rows="3" maxlength="3000">${esc(value)}</textarea></label>`;
}
function empty(message, extra = "") {
  return `<div class="empty"><h2>${message}</h2>${extra}</div>`;
}
function heading(title, description = "", buttons = "") {
  return `<section class="section-head"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="button-row">${buttons}</div></section>`;
}
function table(headers, body) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">No records yet.</td></tr>`}</tbody></table></div>`;
}
function renderAuth() {
  document.querySelector("#app").innerHTML =
    `<div class="auth-shell"><section class="auth-brand"><a class="brand" href="/">ApexLinks.</a><h1>Your game.<br>Your people.<br>Your platform.</h1><p>Tournaments, tee times, and a better club experience—all in one place.</p><small>Original golf management software</small></section><section class="auth-form"><div class="eyebrow">WELCOME TO APEXLinks</div><h2>${authMode === "register" ? "Start your club workspace" : "Welcome back"}</h2><p>${authMode === "register" ? "Create an account and your first organisation." : "Sign in to manage your golf."}</p><form id="auth-form">${authMode === "register" ? input("Your name", "name", "", "text", 'required maxlength="100" autocomplete="name"') + input("Organisation / society name", "organisation", "", "text", 'required maxlength="120"') : ""}${input("Email address", "email", "", "email", 'required autocomplete="email"')}${input("Password", "password", "", "password", `required minlength="${authMode === "register" ? 12 : 1}" maxlength="128" autocomplete="${authMode === "register" ? "new-password" : "current-password"}"`)}<p class="form-error" role="alert"></p><button class="primary" type="submit">${authMode === "register" ? "Create workspace" : "Sign in"} →</button></form><button class="text-button" id="auth-switch">${authMode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}</button><p class="auth-note">Invited to a club? Create an account with your invited email, then use Join organisation in Settings. Password recovery email is not configured; keep your password safe.</p></section></div>`;
  document.querySelector("#auth-switch").onclick = () => {
    authMode = authMode === "login" ? "register" : "login";
    renderAuth();
  };
  document.querySelector("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target,
      b = form.querySelector("button");
    b.disabled = true;
    try {
      const d = await api(
        "auth/" + authMode,
        "POST",
        Object.fromEntries(new FormData(form)),
      );
      me = d.user;
      csrf = d.csrf;
      orgs = d.organisations;
      await loadOrg(orgs[0].id);
      render();
    } catch (err) {
      form.querySelector(".form-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
}
function eventCard(e, i) {
  const count = s.entries.filter(
    (x) => x.eventId === e.id && x.status === "Registered",
  ).length;
  const r = s.rounds.find((x) => x.eventId === e.id);
  return `<article class="event-card"><div class="course-art course-${i % 3}"><span class="badge ${e.status === "Live" ? "live" : ""}">${esc(e.status)}</span><span class="course-mark">${String(i + 1).padStart(2, "0")}<small>APEX SERIES</small></span><span class="flag">⚑</span></div><div class="event-body"><div class="eyebrow">${shortDate(e.date)} · ${esc(e.format)}</div><h3>${esc(e.name)}</h3><p>${esc(course(r?.courseId)?.name || "Course to be assigned")}</p><div class="card-bottom"><span>${count} / ${e.capacity} players</span><span>${money(e.fee)} entry</span>${button("Open →", "open-event", "text-button", `data-id="${e.id}"`)}</div></div></article>`;
}
function overview() {
  return `${heading("A great day starts here.", "Less organising. More unforgettable golf.", manager() ? button("＋ Create tournament", "new-event") : "")}<section class="stats">${[
    ["Tournaments", s.events.length],
    ["Players", s.players.length],
    ["Live tournaments", s.events.filter((e) => e.status === "Live").length],
    [
      "Confirmed bookings",
      s.bookings.filter((b) => b.status === "Confirmed").length,
    ],
  ]
    .map(
      ([name, n]) =>
        `<article><span>${name}</span><strong>${n.toString().padStart(2, "0")}</strong></article>`,
    )
    .join(
      "",
    )}</section>${!s.courses.length ? `<section class="panel empty"><h2>Your workspace is ready.</h2><p>Add a course, players, and your first tournament to get started.</p><div class="button-row">${manager() ? button("Add course", "new-course") + button("Load sample tournament", "seed", "outline") : ""}</div></section>` : ""}<section class="section-head"><h2>On the calendar</h2><button class="text-button" data-page="Tournaments">All tournaments →</button></section><section class="events">${
    s.events
      .filter((e) => !["Completed", "Cancelled"].includes(e.status))
      .slice(0, 3)
      .map(eventCard)
      .join("") || "<p>No upcoming events.</p>"
  }</section><div class="lower"><section class="panel"><div class="panel-head"><h2>Club noticeboard</h2>${manager() ? button("＋ Post notice", "new-announcement", "text-button") : ""}</div>${s.announcements.map((a) => `<article class="notice"><h3>${esc(a.title)}</h3><p class="multiline">${esc(a.body)}</p><small>${esc(a.author)} · ${shortDate(a.created)}</small>${manager() ? button("Remove", "remove-announcement", "text-button", `data-id="${a.id}"`) : ""}</article>`).join("") || empty("All caught up", "<p>Club notices will appear here.</p>")}</section><aside class="insight"><div class="eyebrow">CONNECTED CLUB MANAGEMENT</div><h2>Every round.<br>Every player.<br>One place.</h2><p>Scores and club records are saved to your organisation on the server.</p></aside></div>`;
}
function tournaments() {
  return `${heading("Tournaments", "Build a field. Set the format. Bring people together.", manager() ? button("＋ Create tournament", "new-event") : "")}<section class="events">${
    s.events
      .filter((e) =>
        `${e.name} ${e.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .map(eventCard)
      .join("") || empty("No tournaments yet.")
  }</section>`;
}
function tournament() {
  const e = event();
  if (!e) return empty("Select a tournament from the calendar.");
  const tabs = [
    "Overview",
    "Field",
    "Rounds",
    "Tee sheet",
    "Scoring",
    "Leaderboard",
  ];
  return `${heading(e.name, `${shortDate(e.date)} · ${e.format} · ${e.status}`, manager() ? button("Edit tournament", "edit-event", "outline") + button("Share leaderboard", "share", "outline") : "")}<div class="filters">${tabs.map((t) => `<button class="${tab === t ? "active" : ""}" data-tab="${t}">${t}</button>`).join("")}</div>${tab === "Overview" ? `<section class="panel detail-summary"><div><div class="eyebrow">ABOUT THE EVENT</div><h2>${esc(e.name)}</h2><p class="multiline">${esc(e.description || "No description added.")}</p></div><div class="summary-numbers"><div><strong>${field().length}/${e.capacity}</strong><span>Registered players</span></div><div><strong>${s.rounds.filter((r) => r.eventId === e.id).length}</strong><span>Rounds</span></div><div><strong>${money(e.fee)}</strong><span>Entry fee · GBP</span></div></div></section>` : tab === "Field" ? fieldView() : tab === "Rounds" ? roundsView() : tab === "Tee sheet" ? teeView() : tab === "Scoring" ? scoringView() : leaderboardView()}`;
}
function fieldView() {
  return `<section class="panel"><div class="panel-head"><h2>Tournament field</h2>${manager() || org.role === "player" ? button("＋ Register player", "new-entry", "outline") : ""}</div>${table(
    ["PLAYER", "HCP", "DIVISION", "TEAM", ""],
    field()
      .map(
        (e) =>
          `<tr><td>${esc(player(e.playerId)?.name)}</td><td>${e.handicap}</td><td>${esc(e.division)}</td><td>${esc(e.team || "—")}</td><td>${manager() ? button("Edit", "edit-entry", "text-button", `data-id="${e.id}"`) + button("Remove", "remove-entry", "text-button", `data-id="${e.id}"`) : ""}</td></tr>`,
      )
      .join(""),
  )}</section>`;
}
function roundsView() {
  return `<section class="panel"><div class="panel-head"><h2>Competition rounds</h2>${manager() ? button("＋ Add round", "new-round", "outline") : ""}</div>${table(
    ["ROUND", "COURSE / TEE", "DATE", "STATUS", ""],
    s.rounds
      .filter((r) => r.eventId === eventId)
      .map(
        (r) =>
          `<tr><td>Round ${r.number}</td><td>${esc(course(r.courseId)?.name)} · ${esc(course(r.courseId)?.tee)}</td><td>${shortDate(r.date)}</td><td>${r.status}</td><td>${manager() ? button(r.status === "Open" ? "Close round" : "Reopen round", "toggle-round", "text-button", `data-id="${r.id}"`) : ""}</td></tr>`,
      )
      .join(""),
  )}<div class="panel-foot">Round course pars and stroke indexes are captured when created. Every registered player must have an attested card before a round can close.</div></section>`;
}
function roundPicker() {
  const rounds = s.rounds.filter((r) => r.eventId === eventId);
  return rounds.length
    ? `<label class="inline-label">Round <select id="round-picker">${rounds.map((r) => `<option value="${r.id}" ${r.id === roundId ? "selected" : ""}>Round ${r.number} · ${esc(course(r.courseId)?.name)}</option>`).join("")}</select></label>`
    : empty("Add a round to get started.");
}
function teeView() {
  return `<section class="panel"><div class="panel-head">${roundPicker()}<div class="button-row">${manager() && round() ? button("Generate pairings", "pairings", "outline") : ""}${button("Print", "print", "outline")}</div></div>${table(
    ["TEE TIME (YOUR TIMEZONE)", "START HOLE", "PLAYERS", ""],
    s.teeTimes
      .filter((t) => t.roundId === roundId)
      .map(
        (t) =>
          `<tr><td>${time(t.start)}</td><td>${t.hole}</td><td>${t.playerIds.map((x) => esc(player(x)?.name)).join(" · ")}</td><td>${manager() ? button("Edit time", "edit-tee", "text-button", `data-id="${t.id}"`) : ""}</td></tr>`,
      )
      .join(""),
  )}</section>`;
}
function scoringView() {
  const r = round();
  if (!r) return roundPicker();
  const entries = field().filter(
    (e) => org.role !== "player" || player(e.playerId)?.email === me.email,
  );
  if (!entries.length)
    return empty(
      "No eligible players.",
      "<p>An organiser must register your player profile using your account email.</p>",
    );
  if (!entries.some((e) => e.playerId === playerId))
    playerId = entries[0].playerId;
  const p = player(playerId),
    entry = entries.find((e) => e.playerId === playerId),
    c = s.cards.find((c) => c.roundId === r.id && c.playerId === p.id);
  const scores = c?.scores || Array(18).fill(null);
  const t = cardTotals(scores, r.pars, r.indexes, entry.handicap);
  const locked =
    r.status !== "Open" ||
    c?.status === "Attested" ||
    !["Open", "Live"].includes(event().status);
  return `<section class="panel score-panel"><div class="score-top">${roundPicker()}<label class="inline-label">Player<select id="player-picker">${entries.map((e) => `<option value="${e.playerId}" ${e.playerId === playerId ? "selected" : ""}>${esc(player(e.playerId)?.name)} · HCP ${e.handicap}</option>`).join("")}</select></label></div><div class="score-status"><strong>${esc(c?.status || "Not started")}</strong><span>Gross ${t.thru ? t.gross : "—"} · Net ${t.thru ? t.net : "—"} · ${t.points} points · ${t.thru}/18 holes</span></div><form id="score-form" data-version="${c?.version || 0}"><div class="scorecard">${r.pars.map((par, i) => `<label class="hole"><span>HOLE ${i + 1}</span><small>Par ${par} · SI ${r.indexes[i]}</small><input aria-label="Hole ${i + 1} score" name="hole-${i}" type="number" min="1" max="30" step="1" inputmode="numeric" value="${scores[i] ?? ""}" ${locked ? "disabled" : ""}></label>`).join("")}</div><div class="score-actions"><p>Playing handicap ${entry.handicap}. Blank holes are unplayed.<br>Gross scores only; net strokes and Stableford use this round’s stroke indexes.</p><div class="button-row">${!locked ? '<button class="outline" type="submit" name="mode" value="draft">Save draft</button><button class="primary" type="submit" name="mode" value="submit">Submit card</button>' : ""}${c && scorer() && c.status !== "Attested" ? button("Attest card", "attest", "outline") : ""}${c?.status === "Attested" && manager() ? button("Unlock card", "unlock", "outline") : ""}</div></div></form><div class="panel-foot">Another scorer must attest cards entered by a scorer. Organisers may attest or unlock with an audit record. Submitted cards remain editable until attested.</div></section>`;
}
function leaderboardView() {
  const divisions = [...new Set(rows.map((r) => r.division))];
  return `<section class="panel"><div class="panel-head"><div><h2>${esc(event().format)} standings</h2><p>Refreshes every 10 seconds. Ties share a position; no countback is applied.</p></div>${button("Export CSV", "export-scores", "outline")}</div>${
    divisions
      .map(
        (d) =>
          `<div class="division-label">${esc(d)}</div>${table(
            [
              "POS",
              "PLAYER",
              "HCP",
              "THRU",
              "GROSS",
              "NET",
              "TO PAR",
              "POINTS",
              "ATTESTED",
            ],
            rows
              .filter((r) => r.division === d)
              .map((r, i, a) => {
                const metric =
                  event().format === "Stableford"
                    ? "points"
                    : event().format === "Net stroke"
                      ? "net"
                      : "gross";
                const rank =
                  a.findIndex(
                    (x) => x[metric] === r[metric] && x.thru === r.thru,
                  ) + 1;
                return `<tr><td>${r.thru ? rank : "—"}</td><td>${esc(r.name)}</td><td>${r.handicap}</td><td>${r.thru}</td><td>${r.thru ? r.gross : "—"}</td><td>${r.thru ? r.net : "—"}</td><td>${r.thru ? label(r.toPar) : "—"}</td><td>${r.points}</td><td>${r.attested}/${s.rounds.filter((x) => x.eventId === eventId).length}</td></tr>`;
              })
              .join(""),
          )}`,
      )
      .join("") || empty("Register players to see standings.")
  }<div class="panel-foot">Provisional until all rounds are closed. Stroke totals for players with different holes played are not directly comparable.</div></section><section class="panel team-panel"><div class="panel-head"><h2>Team net best ball</h2>${roundPicker()}</div>${table(["TEAM", "PLAYERS", "THRU", "NET", "POINTS"], teams.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.players}</td><td>${t.thru}</td><td>${t.net}</td><td>${t.points}</td></tr>`).join(""))}<div class="panel-foot">Lowest net score per hole among team members. This is a separate round-level best-ball view, not a scramble or match-play result.</div></section>`;
}
function playersView() {
  return `${heading("The player community", "Manage player records and playing handicaps.", manager() ? button("＋ Add player", "new-player") : "")}<section class="panel">${table(
    ["PLAYER", "CLUB", "HCP", "STATUS", ""],
    s.players
      .filter((p) =>
        `${p.name} ${p.club}`.toLowerCase().includes(query.toLowerCase()),
      )
      .map(
        (p) =>
          `<tr><td><div class="player-cell"><span class="avatar">${initials(p.name)}</span><div><strong>${esc(p.name)}</strong>${manager() ? `<small>${esc(p.email)}</small>` : ""}</div></div></td><td>${esc(p.club)}</td><td>${p.handicap}</td><td>${esc(p.memberStatus)}</td><td>${manager() ? button("Edit", "edit-player", "text-button", `data-id="${p.id}"`) : ""}</td></tr>`,
      )
      .join(""),
  )}<div class="panel-foot">Handicaps are manually entered playing handicaps. Official handicap verification is not connected.</div></section>`;
}
function coursesView() {
  return `${heading("Courses & tees", "Real course pars and stroke indexes power every scorecard.", manager() ? button("＋ Add course", "new-course") : "")}${s.courses.map((c) => `<section class="panel course-panel"><div class="panel-head"><div><h2>${esc(c.name)} · ${esc(c.tee)}</h2><p>Par ${c.pars.reduce((a, b) => a + b, 0)} · Rating ${c.rating ?? "—"} · Slope ${c.slope ?? "—"}</p></div>${manager() ? button("Edit course", "edit-course", "outline", `data-id="${c.id}"`) : ""}</div>${table(["", "", ...c.pars.map((_, i) => i + 1)], `<tr><td colspan="2">Par</td>${c.pars.map((p) => `<td>${p}</td>`).join("")}</tr><tr><td colspan="2">Stroke index</td>${c.indexes.map((p) => `<td>${p}</td>`).join("")}</tr>`)}</section>`).join("") || empty("Add your first course.")}`;
}
function bookingsView() {
  return `${heading("Tee bookings", "Book a tee slot for up to four players. Times are shown in your browser timezone.", manager() || org.role === "player" ? button("＋ Book tee time", "new-booking") : "")}<section class="panel">${table(
    ["TEE TIME", "COURSE", "PLAYERS", "STATUS", ""],
    s.bookings
      .filter((b) =>
        `${course(b.courseId)?.name} ${b.playerIds.map((x) => player(x)?.name).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(
        (b) =>
          `<tr><td>${time(b.start)}</td><td>${esc(course(b.courseId)?.name)}</td><td>${b.playerIds.map((x) => esc(player(x)?.name)).join("<br>")}</td><td>${b.status}</td><td>${b.status === "Confirmed" && (manager() || b.createdBy === me.id) ? button("Cancel", "cancel-booking", "text-button", `data-id="${b.id}"`) : ""}</td></tr>`,
      )
      .join(""),
  )}</section>`;
}
function membershipsView() {
  return `${heading("Memberships", "Annual plans, membership dates, and invoices.", manager() ? button("＋ Create plan", "new-plan") + button("Assign membership", "new-subscription", "outline") : "")}<div class="plan-grid">${s.plans.map((p) => `<article class="panel plan"><h2>${esc(p.name)}</h2><strong>${money(p.amount)}</strong><p>Annual plan · GBP</p></article>`).join("")}</div>${manager() ? `<section class="panel">${table(["PLAYER", "PLAN", "START", "END", "STATUS", ""], s.subscriptions.map((m) => `<tr><td>${esc(player(m.playerId)?.name)}</td><td>${esc(s.plans.find((p) => p.id === m.planId)?.name)}</td><td>${shortDate(m.start)}</td><td>${shortDate(m.end)}</td><td>${m.status === "Active" && m.end < today() ? "Expired" : m.status}</td><td>${m.status === "Active" ? button("Cancel", "cancel-subscription", "text-button", `data-id="${m.id}"`) : ""}</td></tr>`).join(""))}</section>` : "<p>Contact your club organiser for your membership record.</p>"}`;
}
function financeView() {
  if (!manager()) return empty("Finance is available to organisers.");
  const paid = s.invoices
      .filter((i) => i.status === "Paid")
      .reduce((n, i) => n + i.amount, 0),
    unpaid = s.invoices
      .filter((i) => i.status === "Unpaid")
      .reduce((n, i) => n + i.amount, 0);
  return `${heading("Finance", "Track entry and membership invoices. Record payments collected outside ApexLinks.")}<div class="info-banner">Online card payments are not connected. “Record payment” records an external payment; it does not charge a card or transfer money.</div><section class="stats"><article><span>Recorded paid</span><strong>${money(paid)}</strong></article><article><span>Outstanding</span><strong>${money(unpaid)}</strong></article></section><section class="panel">${table(["PLAYER", "DESCRIPTION", "AMOUNT", "STATUS", "REFERENCE", ""], s.invoices.map((i) => `<tr><td>${esc(player(i.playerId)?.name)}</td><td>${esc(i.description)}</td><td>${money(i.amount)}</td><td>${i.status}</td><td>${esc(i.reference || "—")}</td><td>${i.status === "Unpaid" ? button("Record payment", "pay-invoice", "text-button", `data-id="${i.id}"`) + button("Void", "void-invoice", "text-button", `data-id="${i.id}"`) : ""}</td></tr>`).join(""))}</section>`;
}
function reportsView() {
  return `${heading("Club insights", "Participation and scoring statistics from your organisation.", manager() ? button("Export records", "export-all", "outline") : "")}<section class="stats">${[
    ["Registered entries", s.entries.length],
    ["Attested cards", s.cards.filter((c) => c.status === "Attested").length],
    [
      "Holes recorded",
      s.cards.reduce(
        (n, c) => n + c.scores.filter((x) => x !== null).length,
        0,
      ),
    ],
    [
      "Completed events",
      s.events.filter((e) => e.status === "Completed").length,
    ],
  ]
    .map(
      ([n, v]) => `<article><span>${n}</span><strong>${v}</strong></article>`,
    )
    .join(
      "",
    )}</section><section class="panel"><div class="panel-head"><h2>Player participation</h2></div>${table(
    ["PLAYER", "EVENTS", "ROUNDS SCORED", "AVERAGE GROSS / HOLE"],
    s.players
      .map((p) => {
        const cards = s.cards.filter((c) => c.playerId === p.id);
        const values = cards.flatMap((c) => c.scores).filter((x) => x !== null);
        return `<tr><td>${esc(p.name)}</td><td>${s.entries.filter((e) => e.playerId === p.id).length}</td><td>${cards.length}</td><td>${values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : "—"}</td></tr>`;
      })
      .join(""),
  )}</section>`;
}
function settingsView() {
  return `${heading("Workspace settings", "Manage access to your organisations and secure your account.")}<section class="panel settings-section"><h2>${esc(org.name)}</h2><p>Your role: ${esc(org.role)} · Signed in as ${esc(me.email)}</p><div class="button-row">${org.role === "admin" ? button("Invite member", "invite") + button("Manage roles", "members", "outline") : ""}${button("New organisation", "new-org", "outline")}${button("Join organisation", "join", "outline")}${button("Change password", "password", "outline")}${button("Sign out", "logout", "outline")}</div></section>${
    manager()
      ? `<section class="panel"><div class="panel-head"><h2>Audit history</h2></div>${table(
          ["WHEN", "USER", "ACTION"],
          s.audit
            .slice(0, 100)
            .map(
              (a) =>
                `<tr><td>${time(a.time)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td></tr>`,
            )
            .join(""),
        )}</section>`
      : ""
  }<section class="panel settings-section"><h2>Integration status</h2><p>Online card payments, email/SMS delivery, official handicap services, and accounting integrations are not connected. Invitations use a securely generated code that you share yourself. Match play, scramble formats, offline scoring, and automatic countback are not implemented.</p></section>`;
}
function render() {
  if (!me || !s) return renderAuth();
  const names = Object.keys(nav).filter(
    (n) => manager() || !["Finance"].includes(n),
  );
  document.querySelector("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="/"> <span class="brand-symbol">A</span>ApexLinks<span class="brand-dot">.</span></a><label class="org-switch">Workspace<select id="org-picker">${orgs.map((o) => `<option value="${o.id}" ${o.id === org.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label><div class="nav-label">WORKSPACE</div><nav>${names.map((n) => `<button class="nav-item ${page === n || (page === "Tournament" && n === "Tournaments") ? "selected" : ""}" data-page="${n}"><span>${nav[n]}</span>${n}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="account"><span class="avatar">${initials(me.name)}</span><div><strong>${esc(me.name)}</strong><small>${esc(org.role)}</small></div></div></div></aside><div class="main-shell"><header><div class="breadcrumb">${esc(org.name)} <span>/</span><strong>${page}</strong></div><div class="top-tools"><label class="search"><span>⌕</span><input id="search" aria-label="Search" placeholder="Search tournaments or players…" value="${esc(query)}"></label>${button("Sign out", "logout", "text-button")}</div></header><main>${config.storage === "ephemeral" ? '<div class="warning-banner">Render storage is temporary. Your data can disappear on redeploy or restart. Attach a persistent disk before adding real data.</div>' : ""}${page === "Overview" ? overview() : page === "Tournaments" ? tournaments() : page === "Tournament" ? tournament() : page === "Players" ? playersView() : page === "Courses" ? coursesView() : page === "Bookings" ? bookingsView() : page === "Memberships" ? membershipsView() : page === "Finance" ? financeView() : page === "Reports" ? reportsView() : settingsView()}<footer><span>APEXLINKS · Golf, beautifully organised.</span><span>Server saved · ${esc(org.name)}</span></footer></main></div>`;
  bind();
}
function dialog(title, content, save, { wide = false, submit = "Save" } = {}) {
  const d = document.createElement("dialog");
  if (wide) d.classList.add("wide-dialog");
  d.innerHTML = `<form><div class="dialog-head"><h2>${esc(title)}</h2><button type="button" class="text-button close" aria-label="Close dialog">×</button></div>${content}<p class="form-error" role="alert"></p>${save ? `<button class="primary" type="submit">${esc(submit)}</button>` : ""}</form>`;
  document.body.append(d);
  d.querySelector(".close").onclick = () => d.close();
  d.addEventListener("close", () => d.remove());
  d.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    if (!save) return;
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await save(new FormData(e.target));
      d.close();
      render();
      toast("Saved successfully.");
    } catch (err) {
      d.querySelector(".form-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  d.showModal();
  return d;
}
const number = (f, n) => Number(f.get(n));
const playerOptions = () =>
  s.players
    .filter((p) => p.memberStatus === "Active")
    .map((p) => [p.id, p.name]);
function eventDialog(e) {
  dialog(
    e ? "Edit tournament" : "Create tournament",
    input(
      "Tournament name",
      "name",
      e?.name || "",
      "text",
      'required maxlength="120"',
    ) +
      input("Date", "date", e?.date || today(), "date", "required") +
      select(
        "Format",
        "format",
        ["Stroke play", "Net stroke", "Stableford"],
        e?.format || "Stableford",
      ) +
      input(
        "Player capacity",
        "capacity",
        e?.capacity || 72,
        "number",
        'min="1" max="500" required',
      ) +
      input(
        "Entry fee (£)",
        "fee",
        (e?.fee || 0) / 100,
        "number",
        'min="0" max="10000" step="0.01" required',
      ) +
      (e
        ? select(
            "Status",
            "status",
            ["Draft", "Open", "Live", "Completed", "Cancelled"],
            e.status,
          )
        : "") +
      textArea("Description", "description", e?.description),
    async (f) => {
      const b = {
        ...Object.fromEntries(f),
        capacity: number(f, "capacity"),
        fee: Math.round(number(f, "fee") * 100),
      };
      const result = await write(
        e ? "events/" + e.id : "events",
        b,
        e ? "PATCH" : "POST",
      );
      eventId = result.id;
      page = "Tournament";
      tab = "Overview";
      roundId = s.rounds.find((r) => r.eventId === eventId)?.id || "";
      await loadLeaderboard();
    },
  );
}
function playerDialog(p) {
  dialog(
    p ? "Edit player" : "Add player",
    input(
      "Full name",
      "name",
      p?.name || "",
      "text",
      'required maxlength="120"',
    ) +
      input(
        "Account email (for player sign-in access)",
        "email",
        p?.email || "",
        "email",
      ) +
      input("Club", "club", p?.club || org.name, "text", "required") +
      input(
        "Playing handicap",
        "handicap",
        p?.handicap ?? 18,
        "number",
        'min="-10" max="54" step="1" required',
      ) +
      select(
        "Status",
        "memberStatus",
        ["Active", "Inactive"],
        p?.memberStatus || "Active",
      ),
    async (f) =>
      write(
        p ? "players/" + p.id : "players",
        { ...Object.fromEntries(f), handicap: number(f, "handicap") },
        p ? "PATCH" : "POST",
      ),
  );
}
function courseDialog(c) {
  dialog(
    c ? "Edit course" : "Add course",
    input("Course name", "name", c?.name || "", "text", "required") +
      input("Tee name", "tee", c?.tee || "White", "text", "required") +
      input(
        "Course rating (optional)",
        "rating",
        c?.rating ?? "",
        "number",
        'min="50" max="90" step="0.1"',
      ) +
      input(
        "Slope (optional)",
        "slope",
        c?.slope ?? "",
        "number",
        'min="55" max="155" step="1"',
      ) +
      `<p>Enter each stroke index from 1 to 18 exactly once. Existing rounds keep their captured course settings.</p><div class="course-editor">${(c?.pars || defaultPars).map((par, i) => `<div><strong>Hole ${i + 1}</strong>${input("Par", "par-" + i, par, "number", 'min="3" max="6" required')}${input("Stroke index", "si-" + i, c?.indexes[i] || defaultIndexes[i], "number", 'min="1" max="18" required')}</div>`).join("")}</div>`,
    async (f) =>
      write(
        c ? "courses/" + c.id : "courses",
        {
          name: f.get("name"),
          tee: f.get("tee"),
          rating: f.get("rating") ? number(f, "rating") : null,
          slope: f.get("slope") ? number(f, "slope") : null,
          pars: Array.from({ length: 18 }, (_, i) => number(f, "par-" + i)),
          indexes: Array.from({ length: 18 }, (_, i) => number(f, "si-" + i)),
        },
        c ? "PATCH" : "POST",
      ),
    { wide: true },
  );
}
function entryDialog(e) {
  const options =
    org.role === "player"
      ? s.players.filter((p) => p.email === me.email).map((p) => [p.id, p.name])
      : playerOptions();
  if (!e && !options.length)
    return toast(
      "An organiser must add a player profile with your account email first.",
    );
  dialog(
    e ? "Edit entry" : "Register player",
    (!e ? select("Player", "playerId", options, options[0]?.[0]) : "") +
      (manager()
        ? input(
            "Playing handicap (blank uses player handicap)",
            "handicap",
            e?.handicap ?? "",
            "number",
            'min="-10" max="54" step="1"',
          ) +
          input(
            "Division",
            "division",
            e?.division || "Open",
            "text",
            "required",
          ) +
          input("Team (optional)", "team", e?.team || "")
        : "<p>Entry fees are invoiced by the club. Registration does not charge a card.</p>"),
    async (f) => {
      const b = { ...Object.fromEntries(f), eventId };
      if (f.get("handicap") !== null && f.get("handicap") !== "")
        b.handicap = number(f, "handicap");
      else delete b.handicap;
      await write(e ? "entries/" + e.id : "entries", b, e ? "PATCH" : "POST");
      await loadLeaderboard();
    },
  );
}
function localTime(iso) {
  const d = new Date(iso || Date.now() + 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function iso(f, name) {
  const d = new Date(f.get(name));
  if (!Number.isFinite(d.valueOf()))
    throw Error("Enter a valid date and time.");
  return d.toISOString();
}
function bind() {
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        if (dirty && !confirm("Discard unsaved scores?")) return;
        dirty = false;
        page = b.dataset.page;
        query = "";
        await loadOrg(org.id);
        render();
      })),
  );
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        if (dirty && !confirm("Discard unsaved scores?")) return;
        dirty = false;
        tab = b.dataset.tab;
        await loadOrg(org.id);
        await loadLeaderboard();
        render();
      })),
  );
  document.querySelector("#org-picker")?.addEventListener(
    "change",
    action(async (e) => {
      if (dirty && !confirm("Discard unsaved scores?")) {
        e.target.value = org.id;
        return;
      }
      dirty = false;
      page = "Overview";
      await loadOrg(e.target.value);
      render();
    }),
  );
  document.querySelector("#round-picker")?.addEventListener(
    "change",
    action(async (e) => {
      if (dirty && !confirm("Discard unsaved scores?")) {
        e.target.value = roundId;
        return;
      }
      roundId = e.target.value;
      dirty = false;
      await loadLeaderboard();
      render();
    }),
  );
  document.querySelector("#player-picker")?.addEventListener("change", (e) => {
    if (dirty && !confirm("Discard unsaved scores?")) {
      e.target.value = playerId;
      return;
    }
    dirty = false;
    playerId = e.target.value;
    render();
  });
  document.querySelector("#search")?.addEventListener("input", (e) => {
    if (dirty) {
      e.target.value = query;
      toast("Save or discard your scores before searching.");
      return;
    }
    query = e.target.value;
    if (!["Players", "Tournaments", "Bookings"].includes(page))
      page = "Tournaments";
    const cursor = e.target.selectionStart;
    render();
    const q = document.querySelector("#search");
    q.focus();
    q.setSelectionRange(cursor, cursor);
  });
  document
    .querySelector("#score-form")
    ?.addEventListener("input", () => (dirty = true));
  document
    .querySelector("#score-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const b = e.submitter;
      b.disabled = true;
      try {
        const scores = Array.from({ length: 18 }, (_, i) =>
          f.elements["hole-" + i].value === ""
            ? null
            : Number(f.elements["hole-" + i].value),
        );
        await write("cards", {
          roundId,
          playerId,
          scores,
          version: Number(f.dataset.version),
          submit: b.value === "submit",
        });
        dirty = false;
        await loadLeaderboard();
        render();
        toast("Scorecard saved on the server.");
      } catch (err) {
        toast(err.message);
      } finally {
        b.disabled = false;
      }
    });
  document.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        const id = b.dataset.id;
        switch (b.dataset.action) {
          case "logout":
            if (dirty && !confirm("Discard unsaved scores?")) return;
            await api("auth/logout", "POST", {});
            me = null;
            s = null;
            csrf = "";
            dirty = false;
            renderAuth();
            break;
          case "seed":
            await write("seed");
            render();
            toast("Sample course, players and tournament created.");
            break;
          case "new-event":
            eventDialog();
            break;
          case "edit-event":
            eventDialog(event());
            break;
          case "open-event":
            page = "Tournament";
            eventId = id;
            tab = "Overview";
            roundId = s.rounds.find((r) => r.eventId === id)?.id || "";
            await loadLeaderboard();
            render();
            break;
          case "new-player":
            playerDialog();
            break;
          case "edit-player":
            playerDialog(player(id));
            break;
          case "new-course":
            courseDialog();
            break;
          case "edit-course":
            courseDialog(course(id));
            break;
          case "new-entry":
            entryDialog();
            break;
          case "edit-entry":
            entryDialog(s.entries.find((e) => e.id === id));
            break;
          case "remove-entry":
            if (
              confirm(
                "Remove this entry? Any existing invoice must be voided separately in Finance.",
              )
            ) {
              await write("entries/" + id, {}, "DELETE");
              await loadLeaderboard();
              render();
            }
            break;
          case "new-round":
            if (!s.courses.length) return toast("Add a course first.");
            dialog(
              "Add round",
              select(
                "Course / tee",
                "courseId",
                s.courses.map((c) => [c.id, c.name + " · " + c.tee]),
                s.courses[0].id,
              ) + input("Round date", "date", event().date, "date", "required"),
              async (f) => {
                const r = await write("rounds", {
                  ...Object.fromEntries(f),
                  eventId,
                });
                roundId = r.id;
              },
            );
            break;
          case "toggle-round": {
            const r = s.rounds.find((r) => r.id === id);
            await write(
              "rounds/" + id,
              { status: r.status === "Open" ? "Closed" : "Open" },
              "PATCH",
            );
            render();
            break;
          }
          case "pairings":
            dialog(
              "Generate pairings",
              input(
                "First tee time (your timezone)",
                "start",
                localTime(),
                "datetime-local",
                "required",
              ) +
                input(
                  "Group size",
                  "groupSize",
                  4,
                  "number",
                  'min="2" max="4" required',
                ) +
                input(
                  "Interval (minutes)",
                  "interval",
                  10,
                  "number",
                  'min="5" max="30" required',
                ) +
                select(
                  "Pairing order",
                  "order",
                  ["Name", "Handicap", "Previous round"],
                  "Handicap",
                ) +
                "<p>This replaces existing tee times for this round. Pairings are locked once scoring starts.</p>",
              async (f) =>
                write("pairings", {
                  roundId,
                  groupSize: number(f, "groupSize"),
                  interval: number(f, "interval"),
                  start: iso(f, "start"),
                  order: f.get("order"),
                }),
            );
            break;
          case "edit-tee": {
            const t = s.teeTimes.find((t) => t.id === id);
            dialog(
              "Edit tee time",
              input(
                "Tee time (your timezone)",
                "start",
                localTime(t.start),
                "datetime-local",
                "required",
              ) +
                input(
                  "Starting hole",
                  "hole",
                  t.hole,
                  "number",
                  'min="1" max="18" required',
                ),
              async (f) =>
                write(
                  "tee-times/" + id,
                  { start: iso(f, "start"), hole: number(f, "hole") },
                  "PATCH",
                ),
            );
            break;
          }
          case "attest":
          case "unlock": {
            if (dirty) return toast("Save or discard your edits first.");
            const c = s.cards.find(
              (c) => c.roundId === roundId && c.playerId === playerId,
            );
            await write("cards/_/" + b.dataset.action, {
              roundId,
              playerId,
              version: c.version,
            });
            render();
            break;
          }
          case "new-booking":
            if (!s.courses.length || !s.players.length)
              return toast("Add a course and players first.");
            dialog(
              "Book tee time",
              select(
                "Course / tee",
                "courseId",
                s.courses.map((c) => [c.id, c.name + " · " + c.tee]),
                s.courses[0].id,
              ) +
                input(
                  "Start time (your timezone)",
                  "start",
                  localTime(),
                  "datetime-local",
                  "required",
                ) +
                "<fieldset><legend>Players (choose 1–4)</legend>" +
                s.players
                  .filter((p) => p.memberStatus === "Active")
                  .map(
                    (p) =>
                      `<label class="check-label"><input type="checkbox" name="players" value="${p.id}">${esc(p.name)}</label>`,
                  )
                  .join("") +
                "</fieldset>",
              async (f) =>
                write("bookings", {
                  courseId: f.get("courseId"),
                  start: iso(f, "start"),
                  duration: 10,
                  playerIds: f.getAll("players"),
                }),
            );
            break;
          case "cancel-booking":
            if (confirm("Cancel this tee booking?")) {
              await write("bookings/" + id, {}, "DELETE");
              render();
            }
            break;
          case "new-plan":
            dialog(
              "Create annual plan",
              input("Plan name", "name", "", "text", "required") +
                input(
                  "Annual fee (£)",
                  "amount",
                  0,
                  "number",
                  'min="0" max="100000" step="0.01" required',
                ),
              async (f) =>
                write("plans", {
                  name: f.get("name"),
                  amount: Math.round(number(f, "amount") * 100),
                }),
            );
            break;
          case "new-subscription":
            if (!s.plans.length || !s.players.length)
              return toast("Create a plan and add players first.");
            dialog(
              "Assign membership",
              select("Player", "playerId", playerOptions(), s.players[0].id) +
                select(
                  "Plan",
                  "planId",
                  s.plans.map((p) => [p.id, p.name]),
                  s.plans[0].id,
                ) +
                input("Start date", "start", today(), "date", "required") +
                input("End date", "end", "", "date", "required"),
              async (f) => write("subscriptions", Object.fromEntries(f)),
            );
            break;
          case "cancel-subscription":
            if (
              confirm(
                "Cancel this membership? Its invoice will remain in Finance.",
              )
            ) {
              await write("subscriptions/" + id, {}, "DELETE");
              render();
            }
            break;
          case "pay-invoice":
            dialog(
              "Record external payment",
              input(
                "Bank / cash / provider reference",
                "reference",
                "",
                "text",
                'required maxlength="200"',
              ) +
                "<p>This records a payment already received outside this app. No money will be collected.</p>",
              async (f) =>
                write("invoices/" + id + "/paid", Object.fromEntries(f)),
            );
            break;
          case "void-invoice":
            if (confirm("Void this unpaid invoice?")) {
              await write("invoices/" + id + "/void");
              render();
            }
            break;
          case "new-announcement":
            dialog(
              "Post club notice",
              input("Title", "title", "", "text", "required") +
                textArea("Message", "body"),
              async (f) => write("announcements", Object.fromEntries(f)),
            );
            break;
          case "remove-announcement":
            if (confirm("Remove this notice?")) {
              await write("announcements/" + id, {}, "DELETE");
              render();
            }
            break;
          case "invite":
            dialog(
              "Invite member",
              input("Member email", "email", "", "email", "required") +
                select(
                  "Role",
                  "role",
                  ["manager", "scorer", "player"],
                  "player",
                ) +
                "<p>The recipient needs an ApexLinks account using this email. Share the generated code yourself; ApexLinks does not send email.</p>",
              async (f) => {
                const d = await write("invites", Object.fromEntries(f));
                setTimeout(
                  () =>
                    dialog(
                      "Invitation code",
                      `<p>Share this code securely with the invited person. It expires in seven days.</p><textarea readonly rows="3" aria-label="Invitation code">${esc(d.code)}</textarea>`,
                      null,
                    ),
                  0,
                );
              },
            );
            break;
          case "join":
            dialog(
              "Join organisation",
              input("Invitation code", "code", "", "text", "required"),
              async (f) => {
                const d = await api("join", "POST", Object.fromEntries(f));
                orgs = d.organisations;
                await loadOrg(orgs.find((o) => o.id !== org.id)?.id || org.id);
                page = "Overview";
              },
            );
            break;
          case "new-org":
            dialog(
              "New organisation",
              input("Organisation name", "name", "", "text", "required"),
              async (f) => {
                const d = await api("orgs", "POST", Object.fromEntries(f));
                orgs = (await api("orgs")).organisations;
                await loadOrg(d.id);
                page = "Overview";
              },
            );
            break;
          case "members": {
            const d = await api(endpoint("members"));
            dialog(
              "Organisation members",
              d.members
                .map(
                  (m) =>
                    `<div class="member-row"><strong>${esc(m.name)}</strong><small>${esc(m.email)}</small>${select("Role", m.id, ["admin", "manager", "scorer", "player"], m.role)}</div>`,
                )
                .join(""),
              async (f) => {
                for (const [userId, role] of f)
                  if (d.members.find((m) => m.id === userId).role !== role)
                    await api(endpoint("members/" + userId), "PATCH", { role });
                orgs = (await api("orgs")).organisations;
                await loadOrg(org.id);
              },
            );
            break;
          }
          case "password":
            dialog(
              "Change password",
              input(
                "Current password",
                "current",
                "",
                "password",
                'required autocomplete="current-password"',
              ) +
                input(
                  "New password (12+ characters)",
                  "password",
                  "",
                  "password",
                  'required minlength="12" maxlength="128" autocomplete="new-password"',
                ),
              async (f) => {
                const d = await api(
                  "auth/password",
                  "POST",
                  Object.fromEntries(f),
                );
                csrf = d.csrf;
              },
            );
            break;
          case "share": {
            const d = dialog(
              "Share leaderboard",
              "<p>Enable a public read-only leaderboard. Anyone with the link can view player names and scores. Disabling sharing revokes the existing link.</p>" +
                (event().publicCode
                  ? `<label>Public leaderboard URL<input readonly value="${esc(location.origin + "/?leaderboard=" + event().publicCode)}"></label>`
                  : "<p>Sharing is currently disabled.</p>"),
              null,
            );
            const controls = document.createElement("div");
            controls.className = "button-row";
            controls.innerHTML = button(
              event().publicCode ? "Disable sharing" : "Enable sharing",
              "toggle-share",
            );
            d.querySelector("form").append(controls);
            controls.querySelector("button").onclick = action(async () => {
              await write("sharing", { eventId, enabled: !event().publicCode });
              d.close();
              render();
              toast(
                event().publicCode
                  ? "Sharing enabled. Open Share leaderboard to copy the link."
                  : "Sharing disabled.",
              );
            });
            break;
          }
          case "print":
            window.print();
            break;
          case "export-scores":
            downloadCSV("apexlinks-leaderboard.csv", [
              [
                "Position",
                "Player",
                "Handicap",
                "Division",
                "Team",
                "Holes",
                "Gross",
                "Net",
                "To par",
                "Stableford",
              ],
              ...rows.map((r) => [
                r.position ?? "",
                r.name,
                r.handicap,
                r.division,
                r.team,
                r.thru,
                r.gross,
                r.net,
                r.toPar,
                r.points,
              ]),
            ]);
            break;
          case "export-all": {
            const d = await api(endpoint("export"));
            download(
              "apexlinks-records.json",
              JSON.stringify(d, null, 2),
              "application/json",
            );
            break;
          }
        }
      })),
  );
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadCSV(name, records) {
  download(
    name,
    records
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v ?? "")
                .replaceAll('"', '""')
                .replace(/^[=+@\-\t\r]/, "'$&") +
              '"',
          )
          .join(","),
      )
      .join("\r\n"),
    "text/csv",
  );
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
let polling = false;
setInterval(async () => {
  if (
    !me ||
    !org ||
    dirty ||
    document.querySelector("dialog") ||
    document.hidden ||
    polling ||
    (page === "Tournament" && tab === "Scoring")
  )
    return;
  polling = true;
  try {
    const old = s.version;
    await loadOrg(org.id);
    if (old !== s.version) render();
  } catch {
  } finally {
    polling = false;
  }
}, 10000);
async function boot() {
  const publicCode = new URLSearchParams(location.search).get("leaderboard");
  if (publicCode) return publicBoard(publicCode);
  try {
    config = await api("config");
    const d = await api("auth/me");
    me = d.user;
    if (!me) return renderAuth();
    csrf = d.csrf;
    orgs = d.organisations;
    await loadOrg(
      orgs.find((o) => o.id === sessionStorage.getItem("apex-org"))?.id ||
        orgs[0].id,
    );
    render();
  } catch (err) {
    document.querySelector("#app").innerHTML =
      `<div class="empty"><h1>Unable to connect</h1><p>${esc(err.message)}</p><button id="retry" class="primary">Try again</button></div>`;
    document.querySelector("#retry").onclick = boot;
  }
}
async function publicBoard(code) {
  const update = async () => {
    try {
      const d = await api("public/" + encodeURIComponent(code));
      document.querySelector("#app").innerHTML =
        `<div class="spectator"><a class="brand" href="/">ApexLinks.</a>${heading(d.event.name, `${shortDate(d.event.date)} · ${d.event.format} · ${d.event.status}`)}<section class="panel">${table(["POS", "PLAYER", "DIVISION", "THRU", "GROSS", "NET", "POINTS"], d.rows.map((r) => `<tr><td>${r.position ?? "—"}</td><td>${esc(r.name)}</td><td>${esc(r.division)}</td><td>${r.thru}</td><td>${r.thru ? r.gross : "—"}</td><td>${r.thru ? r.net : "—"}</td><td>${r.points}</td></tr>`).join(""))}</section><p>Provisional until all rounds close. Refreshes every 10 seconds. Ties share a position; no countback. Stroke totals depend on holes played.</p></div>`;
    } catch (err) {
      document.querySelector("#app").innerHTML =
        `<div class="empty"><h1>Leaderboard unavailable</h1><p>${esc(err.message)}</p><a href="/">Return to ApexLinks</a></div>`;
    }
  };
  await update();
  setInterval(update, 10000);
}
boot();
