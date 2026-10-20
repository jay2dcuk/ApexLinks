import { bindCourseDirectory } from "./course-directory-ui.js";
import { seasonsView, seasonAction } from "./seasons-ui.js";
import { parseCourseImport, courseCSVColumns } from "./course-import.js";
import { calculateHandicap, attestedRoundRecord } from "./courses.js";
import {
  offlineEnabled,
  enableOffline,
  cacheWorkspace,
  cachedWorkspace,
  clearOffline,
} from "./offline.js";
import {
  bogeyScore,
  leaderboard as localLeaderboard,
  teamLeaderboard as localTeams,
} from "./scoring.js";
import {
  operationsView,
  inboxView,
  reportsExtension,
  operationsAction,
} from "./operations-ui.js";
import { roundSettings } from "./scoring.js";
import {
  formats,
  teamFormats,
  matchResult,
  teamStandings,
} from "./competition.js";
import { readQueue, queueScore, removeQueued } from "./offline.js";
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
  selectedTeam = "",
  selectedSeasonId = "",
  query = "",
  rows = [],
  teams = [],
  dirty = false,
  authMode = "login",
  offlineSession = false;
const nav = {
  Overview: "▦",
  Tournaments: "⚑",
  Seasons: "♜",
  Players: "♙",
  Courses: "◇",
  Bookings: "▤",
  Memberships: "◎",
  Finance: "£",
  Reports: "↗",
  Operations: "◈",
  Inbox: "✉",
  Campaigns: "↗",
  Handicaps: "⌁",
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
async function api(path, method = "GET", body, { signal } = {}) {
  if (method !== "GET" && !csrf && me && navigator.onLine) {
    const auth = await (await fetch("/api/auth/me")).json();
    if (auth.user?.id !== me.id)
      throw Error("Sign in again with the account that owns these drafts.");
    csrf = auth.csrf;
  }
  const res = await fetch("/api/" + path, {
    signal,
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
    const error = Error(data.error || "Request failed.");
    error.status = res.status;
    throw error;
  }
  return data;
}
const endpoint = (p) => `orgs/${org.id}/${p}`;
async function loadOrg(id) {
  let d;
  try {
    d = await api(`orgs/${id}/state`);
    offlineSession = false;
  } catch (err) {
    const cached = cachedWorkspace();
    if (
      !err.status &&
      (err instanceof TypeError || !navigator.onLine) &&
      cached?.org.id === id &&
      cached.me.id === me?.id
    ) {
      d = { organisation: cached.org, state: cached.s };
      offlineSession = true;
    } else throw err;
  }
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
  if (!offlineSession)
    cacheWorkspace({ me, orgs, org, s, eventId, roundId, playerId, config });
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
  if (offlineSession || !navigator.onLine) {
    const e = s.events.find((e) => e.id === eventId);
    rows = localLeaderboard(s, e);
    teams = localTeams(s, e, roundId);
    return;
  }
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
    `<div class="auth-shell"><section class="auth-brand"><a class="brand" href="/">ApexLinks.</a><h1>Your game.<br>Your people.<br>Your platform.</h1><p>Tournaments, tee times, and a better club experience—all in one place.</p><small>Original golf management software</small></section><section class="auth-form"><div class="eyebrow">WELCOME TO APEXLinks</div><h2>${authMode === "register" ? "Start your club workspace" : "Welcome back"}</h2><p>${authMode === "register" ? "Create an account and your first organisation." : "Sign in to manage your golf."}</p><form id="auth-form">${authMode === "register" ? input("Your name", "name", "", "text", 'required maxlength="100" autocomplete="name"') + input("Organisation / society name", "organisation", "", "text", 'required maxlength="120"') : ""}${input("Email address", "email", "", "email", 'required autocomplete="email"')}${input("Password", "password", "", "password", `required minlength="${authMode === "register" ? 12 : 1}" maxlength="128" autocomplete="${authMode === "register" ? "new-password" : "current-password"}"`)}<p class="form-error" role="alert"></p><button class="primary" type="submit">${authMode === "register" ? "Create workspace" : "Sign in"} →</button></form><button class="text-button" id="auth-switch">${authMode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}</button><p class="auth-note">Invited to a club? Create an account with your invited email, then use Join organisation in Settings. ${config.mailProvider ? "Recovery email is enabled." : "Recovery email is not configured; keep your password safe."}</p></section></div>`;
  const recover = document.createElement("button");
  recover.className = "text-button";
  recover.textContent = "Forgot password?";
  document.querySelector(".auth-form").append(recover);
  recover.onclick = () =>
    dialog(
      "Reset your password",
      input("Account email", "email", "", "email", "required"),
      async (f) => {
        const d = await api("auth/recover", "POST", Object.fromEntries(f));
        toast(d.message);
      },
    );
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
      if (cachedWorkspace() && cachedWorkspace().me.id !== d.user.id)
        clearOffline();
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
    ...(e.format === "Match play" ? ["Matches"] : []),
  ];
  return `${heading(e.name, `${shortDate(e.date)} · ${e.format} · ${e.status}`, manager() ? button("Edit tournament", "edit-event", "outline") + button("Share leaderboard", "share", "outline") + button("Save template", "ops-template", "outline") : "")}<div class="filters">${tabs.map((t) => `<button class="${tab === t ? "active" : ""}" data-tab="${t}">${t}</button>`).join("")}</div>${tab === "Overview" ? `<section class="panel detail-summary"><div><div class="eyebrow">ABOUT THE EVENT</div><h2>${esc(e.name)}</h2><p class="multiline">${esc(e.description || "No description added.")}</p></div><div class="summary-numbers"><div><strong>${field().length}/${e.capacity}</strong><span>Registered players</span></div><div><strong>${s.rounds.filter((r) => r.eventId === e.id).length}</strong><span>Rounds</span></div><div><strong>${money(e.fee)}</strong><span>Entry fee · GBP</span></div></div></section>` : tab === "Field" ? fieldView() : tab === "Rounds" ? roundsView() : tab === "Tee sheet" ? teeView() : tab === "Scoring" ? scoringView() : tab === "Matches" ? matchesView() : leaderboardView()}`;
}
function fieldView() {
  return `<section class="panel"><div class="panel-head"><h2>Tournament field & waiting list</h2>${manager() || org.role === "player" ? button("＋ Register player", "new-entry", "outline") : ""}</div>${table(
    ["PLAYER", "HCP", "DIVISION", "TEAM", "STATUS", ""],
    s.entries
      .filter((e) => e.eventId === eventId)
      .map(
        (e) =>
          `<tr><td>${esc(player(e.playerId)?.name)}</td><td>${e.handicap}</td><td>${esc(e.division)}</td><td>${esc(e.team || "—")}</td><td>${esc(e.status)}${e.reason ? `<small class="decision-reason">${esc(e.reason)}</small>` : ""}</td><td>${manager() ? button("Edit", "edit-entry", "text-button", `data-id="${e.id}"`) + button("Status", "entry-status", "text-button", `data-id="${e.id}"`) + button("Remove", "remove-entry", "text-button", `data-id="${e.id}"`) : ""}</td></tr>`,
      )
      .join(""),
  )}<div class="panel-foot">Waiting-list players are promoted in entry order when a registered player withdraws before play. Fees are invoiced only on admission. Removing an entry does not refund a payment.</div></section>`;
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
  return `<section class="panel"><div class="panel-head">${roundPicker()}<div class="button-row">${manager() && round() ? button("Generate pairings", "pairings", "outline") + button("Shotgun start", "ops-shotgun", "outline") + button("Assign marker", "ops-marker", "outline") + button("Individual tees", "ops-tee", "outline") : ""}${button("Print", "print", "outline")}</div></div>${table(
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
  if (org.role === "viewer")
    return empty(
      "Read-only account",
      "<p>View the leaderboard and tee sheet; your role cannot enter scores.</p>",
    );
  if (teamFormats.includes(event().format)) return teamScoringView();
  let r = round();
  if (!r) return roundPicker();
  const entries = field()
    .filter(
      (e) =>
        event().format !== "Match play" ||
        s.matches.some(
          (m) =>
            m.roundId === roundId &&
            [m.playerA, m.playerB].includes(e.playerId),
        ),
    )
    .filter(
      (e) =>
        org.role !== "player" ||
        player(e.playerId)?.email === me.email ||
        s.markerAssignments.some(
          (m) =>
            m.roundId === roundId &&
            m.playerId === e.playerId &&
            player(m.markerPlayerId)?.email === me.email,
        ),
    );
  if (!entries.length)
    return empty(
      "No eligible players.",
      "<p>An organiser must register your player profile using your account email.</p>",
    );
  if (!entries.some((e) => e.playerId === playerId))
    playerId = entries[0].playerId;
  const p = player(playerId),
    entry = {
      ...entries.find((e) => e.playerId === playerId),
      handicap: roundSettings(
        s,
        r,
        playerId,
        entries.find((e) => e.playerId === playerId).handicap,
      ).handicap,
    },
    c = s.cards.find((c) => c.roundId === r.id && c.playerId === p.id);
  r = { ...r, ...roundSettings(s, r, playerId, entry.handicap) };
  const assigned = s.markerAssignments.some(
    (m) =>
      m.roundId === roundId &&
      m.playerId === playerId &&
      player(m.markerPlayerId)?.email === me.email,
  );
  const scores = c?.scores || Array(18).fill(null);
  const t = cardTotals(scores, r.pars, r.indexes, entry.handicap);
  const locked =
    r.status !== "Open" ||
    c?.status === "Attested" ||
    !["Open", "Live"].includes(event().status);
  return `<section class="panel score-panel"><div class="score-top">${roundPicker()}<label class="inline-label">Player<select id="player-picker">${entries.map((e) => `<option value="${e.playerId}" ${e.playerId === playerId ? "selected" : ""}>${esc(player(e.playerId)?.name)} · HCP ${e.handicap}</option>`).join("")}</select></label></div><div class="score-status"><strong>${esc(c?.status || "Not started")}</strong><span>Gross ${t.thru ? t.gross : "—"} · Net ${t.thru ? t.net : "—"} · ${event().format === "Bogey / Par" ? label(bogeyScore(scores, r.pars, r.indexes, entry.handicap)) + " vs par" : t.points + " points"} · ${t.thru}/18 holes</span></div><form id="score-form" data-version="${c?.version || 0}"><div class="scorecard">${r.pars.map((par, i) => `<label class="hole"><span>HOLE ${i + 1}</span><small>Par ${par} · SI ${r.indexes[i]}</small><input aria-label="Hole ${i + 1} score" name="hole-${i}" type="number" min="1" max="30" step="1" inputmode="numeric" value="${scores[i] ?? ""}" ${locked ? "disabled" : ""}></label>`).join("")}</div><div class="score-actions"><p>Playing handicap ${entry.handicap}. Blank holes are unplayed.<br>Gross scores only; net strokes and Stableford use this round’s stroke indexes.</p><div class="button-row">${!locked ? '<button class="outline" type="submit" name="mode" value="draft">Save draft</button><button class="primary" type="submit" name="mode" value="submit">Submit card</button>' : ""}${c && (scorer() || assigned) && event().format !== "Match play" && c.status !== "Attested" ? button("Attest card", "attest", "outline") : ""}${c?.status === "Attested" && manager() ? button("Unlock card", "unlock", "outline") : ""}</div></div></form><div class="panel-foot">Another scorer must attest cards entered by a scorer. Organisers may attest or unlock with an audit record. Submitted cards remain editable until attested.</div></section>`;
}
function leaderboardView() {
  if (teamFormats.includes(event().format)) return teamLeaderboardView();
  if (event().format === "Match play") return matchesView();
  const divisions = [...new Set(rows.map((r) => r.division))];
  return `<section class="panel"><div class="panel-head"><div><h2>${esc(event().format)} standings</h2><p>Refreshes every 10 seconds. ${event().tiebreak === "Countback" ? "Countback: last 9, 6, 3, 1 holes of the final completed round." : "Ties share a position."}</p></div>${button("Export CSV", "export-scores", "outline")}</div>${
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
              event().format === "Bogey / Par" ? "BOGEY / PAR" : "POINTS",
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
                const rank = r.position;
                return `<tr><td>${r.position ?? (r.status !== "Registered" ? esc(r.status) : "—")}</td><td>${esc(r.name)}</td><td>${r.handicap}</td><td>${r.thru}</td><td>${r.thru ? r.gross : "—"}</td><td>${r.thru ? r.net : "—"}</td><td>${r.thru ? label(r.toPar) : "—"}</td><td>${event().format === "Bogey / Par" ? label(r.bogey) : r.points}</td><td>${r.attested}/${s.rounds.filter((x) => x.eventId === eventId).length}</td></tr>`;
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
  return `${heading("Courses & tees", "Real course pars and stroke indexes power every scorecard.", manager() ? button("＋ Add course", "new-course") + button("Import tee sets", "import-courses", "outline") + button("Export tee sets", "export-courses", "outline") + button("Worldwide directory", "course-directory", "outline") : "")}${s.courses.map((c) => `<section class="panel course-panel"><div class="panel-head"><div><h2>${esc(c.name)} · ${esc(c.tee)}</h2><p>Par ${c.pars.reduce((a, b) => a + b, 0)} · Rating ${c.rating ?? "—"} · Slope ${c.slope ?? "—"} · ${esc(c.ratedFor || "Unspecified")}</p><p>${esc([c.location, c.country].filter(Boolean).join(", "))} · Organiser-provided${c.ratingAsOf ? " · As of " + esc(c.ratingAsOf) : ""}${c.ratingSource ? " · " + esc(c.ratingSource) : ""}</p></div>${manager() ? button("Edit course", "edit-course", "outline", `data-id="${c.id}"`) : ""}${button("Handicap calculator", "course-calculator", "outline", `data-id="${c.id}"`)}</div>${table(["", "", ...c.pars.map((_, i) => i + 1)], `<tr><td colspan="2">Par</td>${c.pars.map((p) => `<td>${p}</td>`).join("")}</tr><tr><td colspan="2">Stroke index</td>${c.indexes.map((p) => `<td>${p}</td>`).join("")}</tr>${c.lengths?.some((n) => n != null) ? `<tr><td colspan="2">${esc(c.lengthUnit || "yards")}</td>${c.lengths.map((n) => `<td>${n ?? "—"}</td>`).join("")}</tr>` : ""}`)}${c.directoryAttribution ? `<p class="panel-foot">${esc(c.directoryAttribution)}${c.directoryURL ? ` · <a href="${esc(c.directoryURL)}" target="_blank" rel="noopener noreferrer">Venue source</a>` : ""}</p>` : ""}</section>`).join("") || empty("Add your first course.")}`;
}
function bookingsView() {
  return `${heading("Tee bookings", "Book a tee slot for up to four players. Times are shown in your browser timezone.", (manager() || org.role === "player" ? button("＋ Book tee time", "new-booking") : "") + (manager() ? button("Booking rules", "booking-rules", "outline") : ""))}<section class="panel">${table(
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
  return `${heading("Memberships", "Annual plans, membership dates, and invoices.", manager() ? button("＋ Create plan", "new-plan") + button("Assign membership", "new-subscription", "outline") : "")}<div class="plan-grid">${s.plans.map((p) => `<article class="panel plan"><h2>${esc(p.name)}</h2><strong>${money(p.amount)}</strong><p>Annual plan · GBP</p>${config.paymentProvider && (manager() || org.role === "player") && p.amount >= 50 ? button("Subscribe annually", "membership-checkout", "outline", `data-id="${p.id}"`) : ""}</article>`).join("")}</div>${manager() || org.role === "player" ? `<section class="panel">${table(["PLAYER", "PLAN", "START", "END", "STATUS", ""], s.subscriptions.map((m) => `<tr><td>${esc(player(m.playerId)?.name)}</td><td>${esc(s.plans.find((p) => p.id === m.planId)?.name)}</td><td>${shortDate(m.start)}</td><td>${shortDate(m.end)}</td><td>${m.status === "Active" && (m.paidUntil ? Date.parse(m.paidUntil) <= Date.now() : m.end < today()) ? "Expired" : m.status}</td><td>${m.status === "Active" && manager() && !m.billingId ? button("Cancel", "cancel-subscription", "text-button", `data-id="${m.id}"`) : ""}</td></tr>`).join(""))}</section>` : "<p>Contact your club organiser for your membership record.</p>"}${manager() || org.role === "player" ? `<section class="panel"><div class="panel-head"><h2>Online membership billing</h2><p>Renewals extend membership only after a verified paid invoice. Stopping renewal retains the period already paid.</p></div>${table(["PLAYER", "PLAN", "ANNUAL PRICE", "BILLING STATUS", "RENEWAL", ""], (s.onlineMemberships || []).map((m) => `<tr><td>${esc(player(m.playerId)?.name)}</td><td>${esc(m.planName)}</td><td>${money(m.amount)}</td><td>${esc(m.status)}</td><td>${m.cancelAtEnd || m.status === "Cancelled" ? "Stopped" : ["Active", "Past due"].includes(m.status) ? "Annual" : "Awaiting checkout"}</td><td>${["Creating", "Checkout"].includes(m.status) ? button("Resume checkout", "membership-resume", "text-button", `data-id="${m.id}"`) : ["Active", "Past due", "Awaiting payment", "Cancelled"].includes(m.status) ? button("Billing portal", "membership-portal", "text-button", `data-id="${m.id}"`) + (!m.cancelAtEnd && m.status !== "Cancelled" ? button("Stop renewal", "membership-cancel", "text-button", `data-id="${m.id}"`) : "") : ""}</td></tr>`).join(""))}</section>` : ""}`;
}
function financeView() {
  if (!manager() && org.role !== "player")
    return empty(
      "Finance is available to organisers and players with invoices.",
    );
  const paid = s.invoices
      .filter((i) => i.status === "Paid")
      .reduce((n, i) => n + i.amount - (i.refundedAmount || 0), 0),
    unpaid = s.invoices
      .filter((i) => i.status === "Unpaid")
      .reduce((n, i) => n + i.amount, 0);
  return `${heading("Finance", "Track entry and membership invoices. Record payments collected outside ApexLinks.", manager() ? button("Export accounting ledger", "accounting-ledger", "outline") : "")}<div class="info-banner">${config.paymentProvider ? "Pay online opens Stripe Checkout; an invoice is marked paid only after a verified webhook." : "Online payments are not configured."} “Record payment” records a payment already received outside this app.</div><section class="stats"><article><span>Paid less confirmed refunds</span><strong>${money(paid)}</strong></article><article><span>Outstanding</span><strong>${money(unpaid)}</strong></article></section><section class="panel">${table(["PLAYER", "DESCRIPTION", "AMOUNT", "STATUS", "REFERENCE", ""], s.invoices.map((i) => `<tr><td>${esc(player(i.playerId)?.name)}</td><td>${esc(i.description)}</td><td>${money(i.amount)}</td><td>${i.status}${i.refundedAmount ? `<small class="decision-reason">Refunded ${money(i.refundedAmount)}</small>` : ""}</td><td>${esc(i.reference || "—")}</td><td>${i.status === "Unpaid" && i.billingId ? button("Billing portal", "membership-portal", "text-button", `data-id="${i.billingId}"`) : i.status === "Unpaid" ? (manager() ? button("Record payment", "pay-invoice", "text-button", `data-id="${i.id}"`) + button("Void", "void-invoice", "text-button", `data-id="${i.id}"`) : "") + (config.paymentProvider ? button("Pay online", "checkout", "text-button", `data-id="${i.id}"`) + button("Check payment status", "checkout-status", "text-button", `data-id="${i.id}"`) : "") : manager() && config.paymentProvider && i.paymentIntent && (i.refundedAmount || 0) < i.amount ? button("Refund", "refund-invoice", "text-button", `data-id="${i.id}"`) : ""}</td></tr>`).join(""))}</section>${manager() ? `<section class="panel"><div class="panel-head"><h2>Refund history</h2><p>Unconfirmed refunds reserve the amount until Stripe confirms the outcome.</p></div>${table(["INVOICE", "AMOUNT", "REASON", "STATUS", ""], (s.refunds || []).map((r) => `<tr><td>${esc(s.invoices.find((i) => i.id === r.invoiceId)?.description)}</td><td>${money(r.amount)}</td><td>${esc(r.reason)}</td><td>${esc(r.status)}</td><td>${["Creating", "Pending"].includes(r.status) ? button(r.status === "Creating" ? "Retry safely" : "Check refund status", "refund-status", "text-button", `data-id="${r.id}"`) : ""}</td></tr>`).join(""))}</section>` : ""}`;
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
function campaignsView() {
  if (!manager()) return empty("Email campaigns are available to organisers.");
  return `${heading("Email campaigns", "Send scheduled, consent-based club emails.", button("Draft campaign", "campaign-new"))}<div class="info-banner">Only golfers who verified their email and explicitly subscribed are eligible. Provider acceptance does not confirm delivery. SMS and push are not connected.</div><section class="panel">${table(
    ["SUBJECT", "AUDIENCE", "STATUS", "RESULTS", ""],
    (s.campaigns || [])
      .map(
        (c) =>
          `<tr><td>${esc(c.subject)}</td><td>${esc(c.eventId ? s.events.find((e) => e.id === c.eventId)?.name : "All subscribed golfers")}</td><td>${esc(c.status)}</td><td>${
            Object.entries(c.counts)
              .map(([status, count]) => `${esc(status)}: ${count}`)
              .join(" · ") || "Not queued"
          }</td><td>${c.status === "Draft" ? button("Preview / schedule", "campaign-schedule", "text-button", `data-id="${c.id}"`) : ""}${["Draft", "Queued"].includes(c.status) ? button("Cancel", "campaign-cancel", "text-button", `data-id="${c.id}"`) : ""}</td></tr>`,
      )
      .join(""),
  )}</section>`;
}
function settingsView() {
  return `${heading("Workspace settings", "Manage access to your organisations and secure your account.")}<section class="panel settings-section"><h2>${esc(org.name)}</h2><p>Your role: ${esc(org.role)} · Signed in as ${esc(me.email)}</p><div class="button-row">${org.role === "admin" ? button("Invite member", "invite") + button("Manage roles", "members", "outline") : ""}${button("New organisation", "new-org", "outline")}${button("Join organisation", "join", "outline")}${button("Change password", "password", "outline")}${button("Email preferences", "email-preferences", "outline")}${me.emailVerified ? '<span class="badge">Email verified</span>' : button("Verify email", "verify-email", "outline")}${button(offlineEnabled(me.id) ? "Remove offline workspace" : "Enable offline workspace", "offline-workspace", "outline")}${button("Sign out", "logout", "outline")}</div></section>${
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
  }<section class="panel settings-section"><h2>Integration status</h2><p>${config.paymentProvider ? "Stripe checkout configured; paid status requires a signed webhook." : "Stripe checkout not configured."} ${config.mailProvider ? "Recovery email provider configured." : "Recovery email not configured."} SMS, official federation services and accounting sync are not connected. Federation records are organiser-provided until approved API access is supplied. Match play, shared team cards, countback, and local offline score queues are available. Provider-backed email and card checkout require secure configuration.</p></section>`;
}
function opsContext() {
  return { s, me, org, eventId, roundId };
}
function opsHelpers() {
  return {
    heading,
    button,
    table,
    esc,
    time,
    shortDate,
    dialog,
    input,
    select,
    textArea,
    write,
    api,
    render,
    toast,
    downloadCSV,
    today,
    localTime,
    iso,
  };
}
function render() {
  if (!me || !s) return renderAuth();
  s.seasons ||= [];
  s.seasonEvents ||= [];
  const names = Object.keys(nav).filter(
    (n) =>
      (n !== "Campaigns" || manager()) &&
      (manager() || org.role === "player" || !["Finance"].includes(n)),
  );
  document.querySelector("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="/"> <span class="brand-symbol">A</span>ApexLinks<span class="brand-dot">.</span></a><label class="org-switch">Workspace<select id="org-picker">${orgs.map((o) => `<option value="${o.id}" ${o.id === org.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label><div class="nav-label">WORKSPACE</div><nav>${names.map((n) => `<button class="nav-item ${page === n || (page === "Tournament" && n === "Tournaments") ? "selected" : ""}" data-page="${n}"><span>${nav[n]}</span>${n}${n === "Inbox" && s.messages.filter((m) => !s.receipts.some((r) => r.messageId === m.id && r.userId === me.id)).length ? '<b class="nav-count">' + s.messages.filter((m) => !s.receipts.some((r) => r.messageId === m.id && r.userId === me.id)).length + "</b>" : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="account"><span class="avatar">${initials(me.name)}</span><div><strong>${esc(me.name)}</strong><small>${esc(org.role)}</small></div></div></div></aside><div class="main-shell"><header><div class="breadcrumb">${esc(org.name)} <span>/</span><strong>${page}</strong></div><div class="top-tools"><label class="search"><span>⌕</span><input id="search" aria-label="Search" placeholder="Search tournaments or players…" value="${esc(query)}"></label>${button("Sign out", "logout", "text-button")}</div></header><main>${offlineSession ? '<div class="warning-banner">Offline workspace — cached data may be out of date. Score changes queue on this device and must be synced after reconnecting.</div>' : ""}${me && readQueue(me.id).length ? `<div class="warning-banner">${readQueue(me.id).length} scorecard draft(s) saved on this device, waiting to sync. ${button("Review queued scores", "score-queue", "outline")}</div>` : ""}${config.storage === "ephemeral" ? '<div class="warning-banner">Render storage is temporary. Your data can disappear on redeploy or restart. Attach a persistent disk before adding real data.</div>' : ""}${page === "Overview" ? overview() : page === "Tournaments" ? tournaments() : page === "Tournament" ? tournament() : page === "Players" ? playersView() : page === "Seasons" ? seasonsView({ s, org, selectedSeasonId }, opsHelpers()) : page === "Courses" ? coursesView() : page === "Bookings" ? bookingsView() : page === "Memberships" ? membershipsView() : page === "Finance" ? financeView() : page === "Reports" ? reportsView() + reportsExtension(opsContext(), opsHelpers()) : page === "Operations" ? operationsView(opsContext(), opsHelpers()) : page === "Inbox" ? inboxView(opsContext(), opsHelpers()) : page === "Campaigns" ? campaignsView() : page === "Handicaps" ? handicapsView() : settingsView()}<footer><span>APEXLINKS · Golf, beautifully organised.</span><span>Server saved · ${esc(org.name)}</span></footer></main></div>`;
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
      select("Format", "format", formats, e?.format || "Stableford") +
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
      select(
        "Tiebreak",
        "tiebreak",
        ["Shared", "Countback"],
        e?.tiebreak || "Shared",
      ) +
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
        'min="-72" max="144" step="1" required',
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
    c?.id ? "Edit course" : "Add course",
    input("Course name", "name", c?.name || "", "text", "required") +
      input("Tee name", "tee", c?.tee || "White", "text", "required") +
      input("Location", "location", c?.location || "") +
      input("Country", "country", c?.country || "") +
      select(
        "Rating category",
        "ratedFor",
        ["Men", "Women", "Unspecified"],
        c?.ratedFor || "Unspecified",
      ) +
      input("Rating source", "ratingSource", c?.ratingSource || "") +
      input("Rating source URL", "sourceURL", c?.sourceURL || "", "url") +
      input("Rating as-of date", "ratingAsOf", c?.ratingAsOf || "", "date") +
      select(
        "Hole length unit",
        "lengthUnit",
        ["yards", "metres"],
        c?.lengthUnit || "yards",
      ) +
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
      `<p>Enter each stroke index from 1 to 18 exactly once. Existing rounds keep their captured course settings.</p><div class="course-editor">${(c?.pars || Array(18).fill(null)).map((par, i) => `<div><strong>Hole ${i + 1}</strong>${input("Hole length (optional)", "length-" + i, c?.lengths?.[i] ?? "", "number", 'min="30" max="1000"')}${input("Par", "par-" + i, par ?? "", "number", 'min="3" max="6" required')}${input("Stroke index", "si-" + i, c?.indexes?.[i] ?? "", "number", 'min="1" max="18" required')}</div>`).join("")}</div>`,
    async (f) =>
      write(
        c?.id ? "courses/" + c.id : "courses",
        {
          ...Object.fromEntries(
            [
              "location",
              "country",
              "ratedFor",
              "ratingSource",
              "sourceURL",
              "ratingAsOf",
              "lengthUnit",
            ].map((key) => [key, f.get(key)]),
          ),
          directoryURL: c?.directoryURL || "",
          directoryAttribution: c?.directoryAttribution || "",
          lengths: Array.from({ length: 18 }, (_, i) =>
            f.get("length-" + i) ? number(f, "length-" + i) : null,
          ),
          name: f.get("name"),
          tee: f.get("tee"),
          rating: f.get("rating") ? number(f, "rating") : null,
          slope: f.get("slope") ? number(f, "slope") : null,
          pars: Array.from({ length: 18 }, (_, i) => number(f, "par-" + i)),
          indexes: Array.from({ length: 18 }, (_, i) => number(f, "si-" + i)),
        },
        c?.id ? "PATCH" : "POST",
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
      (!e
        ? select(
            "If the event is full",
            "waitlist",
            [
              ["yes", "Join waiting list"],
              ["no", "Reject registration"],
            ],
            "yes",
          )
        : "") +
      (manager()
        ? input(
            "Playing handicap (blank uses player handicap)",
            "handicap",
            e?.handicap ?? "",
            "number",
            'min="-72" max="144" step="1"',
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
      const b = {
        ...Object.fromEntries(f),
        eventId,
        waitlist: f.get("waitlist") === "yes",
      };
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
function matchesView() {
  return `<section class="panel"><div class="panel-head"><div><h2>Knockout bracket</h2><p>Seeded singles net match play. 2–64 entrants; top-seed byes fill the bracket.</p></div>${roundPicker()}${manager() ? button("Generate next stage", "new-matches", "outline") : ""}</div>${table(
    ["STAGE", "MATCH", "PLAYER A", "PLAYER B", "RESULT", ""],
    s.matches
      .filter((m) => m.eventId === eventId)
      .map((m) => {
        if (!m.playerA || !m.playerB)
          return `<tr><td>${m.stage}</td><td>${m.slot}</td><td>${esc(player(m.winner)?.name)}</td><td>Bye</td><td>Advanced automatically</td><td></td></tr>`;
        const r = s.rounds.find((r) => r.id === m.roundId),
          a = s.cards.find(
            (c) => c.roundId === m.roundId && c.playerId === m.playerA,
          ),
          b = s.cards.find(
            (c) => c.roundId === m.roundId && c.playerId === m.playerB,
          ),
          ea = s.entries.find(
            (e) => e.eventId === eventId && e.playerId === m.playerA,
          ),
          eb = s.entries.find(
            (e) => e.eventId === eventId && e.playerId === m.playerB,
          ),
          result = matchResult(
            a?.scores || [],
            b?.scores || [],
            r,
            ea.handicap,
            eb.handicap,
          );
        return `<tr><td>${m.stage}</td><td>${m.slot}</td><td>${esc(player(m.playerA)?.name)}</td><td>${esc(player(m.playerB)?.name)}</td><td>${esc(m.status === "Completed" ? `${player(m.winner)?.name} wins: ${m.result}` : result.label)}</td><td>${manager() && m.status !== "Completed" ? button("Playoff hole", "ops-playoff", "text-button", `data-id="${m.id}"`) : ""}${manager() ? button(m.status === "Completed" ? "Reopen" : "Finalise", "finalise-match", "text-button", `data-id="${m.id}"`) : ""}</td></tr>`;
      })
      .join(""),
  )}<div class="panel-foot">Strokes are the difference in playing handicaps, allocated by stroke index. Tied matches need an organiser-recorded playoff decision. The bracket advances only after the prior stage is finalised.</div></section>`;
}
function teamScoringView() {
  const r = round();
  if (!r) return roundPicker();
  const names = [
    ...new Set(
      field()
        .filter(
          (e) =>
            e.team &&
            (org.role !== "player" || player(e.playerId)?.email === me.email),
        )
        .map((e) => e.team),
    ),
  ];
  if (!names.length) return empty("Assign players to teams first.");
  if (!names.includes(selectedTeam)) selectedTeam = names[0];
  const c = s.teamCards.find(
      (c) => c.roundId === r.id && c.team === selectedTeam,
    ),
    scores = c?.scores || Array(18).fill(null),
    locked =
      r.status !== "Open" ||
      c?.status === "Attested" ||
      !["Open", "Live"].includes(event().status);
  if (!c && !manager())
    return `<section class="panel score-panel">${roundPicker()}<h2>Team card not initialised</h2><p>An organiser must enter and save the team playing handicap first.</p></section>`;
  return `<section class="panel score-panel"><div class="score-top">${roundPicker()}<label class="inline-label">Team<select id="team-picker">${names.map((n) => `<option ${n === selectedTeam ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label></div><h2>${esc(event().format)} — one shared card per team</h2><p>Enter the team's actual gross score on each hole. The team playing handicap is set explicitly by the organiser; it is not an automatic federation allowance.</p><div class="score-status"><strong>${esc(c?.status || "Not started")}</strong></div><form id="score-form" data-version="${c?.version || 0}">${input("Team playing handicap", "teamHandicap", c?.handicap ?? 0, "number", `min="-72" max="144" step="1" ${c ? "readonly" : ""} required`)}<div class="scorecard">${r.pars.map((par, i) => `<label class="hole"><span>HOLE ${i + 1}</span><small>Par ${par} · SI ${r.indexes[i]}</small><input aria-label="Hole ${i + 1} score" name="hole-${i}" type="number" min="1" max="30" step="1" value="${scores[i] ?? ""}" ${locked ? "disabled" : ""}></label>`).join("")}</div><div class="button-row">${!locked ? '<button class="outline" type="submit" value="draft">Save draft</button><button class="primary" type="submit" value="submit">Submit card</button>' : ""}${c && scorer() && c.status !== "Attested" ? button("Attest card", "attest", "outline") : ""}${c?.status === "Attested" && manager() ? button("Unlock card", "unlock", "outline") : ""}</div></form></section>`;
}
function teamLeaderboardView() {
  const standings = teamStandings(s, event());
  return `<section class="panel"><div class="panel-head"><h2>${esc(event().format)} team standings</h2>${button("Export teams", "export-teams", "outline")}</div>${table(["POS", "TEAM", "THRU", "GROSS", "NET", "ATTESTED"], standings.map((t, i, a) => `<tr><td>${t.thru ? a.findIndex((x) => x.net === t.net && x.thru === t.thru) + 1 : "—"}</td><td>${esc(t.name)}</td><td>${t.thru}</td><td>${t.thru ? t.gross : "—"}</td><td>${t.thru ? t.net : "—"}</td><td>${t.attested}/${s.rounds.filter((r) => r.eventId === eventId).length}</td></tr>`).join(""))}<div class="panel-foot">One shared gross card per team, ranked by net strokes. Team handicap is organiser-specified. Tied teams share positions; individual countback does not apply to this team view.</div></section>`;
}
function handicapsView() {
  return `${heading("Handicaps & federation records", "Provider-labelled records, source dates, and course handicap calculations.", manager() ? button("Record handicap", "new-handicap") + button("Import records", "import-handicaps", "outline") + button("Export attested rounds", "export-handicaps", "outline") : "")}<div class="info-banner">Live England Golf / MyEG and USGA / GHIN access is not connected. The records below are supplied by your organiser and are explicitly marked unverified.</div><div class="plan-grid"><article class="panel plan"><h2>England Golf / MyEG</h2><p>Request authorised WHS/CDH integration access through England Golf. Ask for the partner agreement, API documentation, sandbox, credentials, and golfer consent requirements.</p><a class="text-button" href="https://www.englandgolf.org/" target="_blank" rel="noopener noreferrer">England Golf website →</a></article><article class="panel plan"><h2>USGA / GHIN</h2><p>Ask USGA/GHIN or your Allied Golf Association about approved software access and score-posting permissions. A golfer's normal app login is not a partner API credential.</p><a class="text-button" href="https://www.usga.org/handicapping/ghin.html" target="_blank" rel="noopener noreferrer">USGA GHIN information →</a></article></div><section class="panel">${table(["PLAYER", "PROVIDER", "MEMBERSHIP ID", "INDEX", "AS OF", "PLAYING HCP", "SOURCE"], s.handicapRecords.map((r) => `<tr><td>${esc(player(r.playerId)?.name)}</td><td>${esc(r.provider)}</td><td>${esc(r.membershipId)}</td><td>${r.index}</td><td>${shortDate(r.asOf)}</td><td>${r.playingHandicap ?? "—"}</td><td>Organiser-provided · unverified</td></tr>`).join(""))}<div class="panel-foot">Calculation: index × slope / 113 + course rating − par, then allowance and rounding. Confirm competition rules with your governing body. Existing event handicaps are not silently changed.</div></section>`;
}
function renderPasswordReset(token) {
  document.querySelector("#app").innerHTML =
    `<section class="auth-form"><a class="brand" href="/">ApexLinks.</a><h2>Choose a new password</h2><form id="password-reset">${input("New password", "password", "", "password", 'required minlength="12" maxlength="128" autocomplete="new-password"')}<p class="form-error" role="alert"></p><button class="primary" type="submit">Reset password</button></form></section>`;
  document.querySelector("#password-reset").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const d = await api("auth/reset", "POST", {
        token,
        password: new FormData(e.target).get("password"),
      });
      history.replaceState({}, "", "/");
      me = null;
      csrf = "";
      renderAuth();
      toast(d.message);
    } catch (err) {
      e.target.querySelector(".form-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
}
function queueDialog() {
  const queue = readQueue(me.id),
    d = dialog(
      "Queued scorecards",
      "<p>These drafts are saved on this device only. Sync checks the original card version. Conflicting scores will never overwrite newer server scores automatically.</p>" +
        queue
          .map(
            (q, i) =>
              `<section class="notice"><h3>${esc(q.body.team || player(q.body.playerId)?.name || "Player card")}</h3><p>${time(q.saved)} · ${q.body.scores.map((n) => n ?? "–").join(", ")}</p><div class="button-row"><button type="button" class="primary" data-sync="${i}">Sync card</button><button type="button" class="outline" data-discard="${i}">Discard local draft</button></div><p class="form-error" data-queue-error="${i}" role="alert"></p></section>`,
          )
          .join(""),
      null,
      { wide: true },
    );
  d.querySelectorAll("[data-sync]").forEach(
    (btn) =>
      (btn.onclick = action(async () => {
        const q = queue[Number(btn.dataset.sync)];
        let saved = false;
        try {
          await api(`orgs/${q.orgId}/${q.path}`, "POST", q.body);
          saved = true;
          removeQueued(me.id, q.key);
          await refresh();
          d.close();
          toast("Queued scorecard synced.");
        } catch (err) {
          if (saved) {
            d.close();
            toast(
              "Your scorecard was saved on the server. Reload to refresh this view.",
            );
            return;
          }
          d.querySelector(
            `[data-queue-error="${btn.dataset.sync}"]`,
          ).textContent =
            err.message +
            " Your local scores remain above. Review the current server card before deciding which scores to keep.";
        }
      })),
  );
  d.querySelectorAll("[data-discard]").forEach(
    (btn) =>
      (btn.onclick = () => {
        if (confirm("Permanently discard this local draft?")) {
          removeQueued(me.id, queue[Number(btn.dataset.discard)].key);
          d.close();
          render();
        }
      }),
  );
}

function bind() {
  document
    .querySelector("#season-picker")
    ?.addEventListener("change", (event) => {
      selectedSeasonId = event.target.value;
      render();
    });
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
  document.querySelector("#team-picker")?.addEventListener("change", (e) => {
    if (dirty && !confirm("Discard unsaved scores?")) {
      e.target.value = selectedTeam;
      return;
    }
    dirty = false;
    selectedTeam = e.target.value;
    render();
  });
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
      const f = e.target,
        btn = e.submitter;
      btn.disabled = true;
      const team = teamFormats.includes(event().format),
        path = team ? "team-cards" : "cards",
        body = {
          roundId,
          ...(team
            ? {
                team: selectedTeam,
                handicap: Number(f.elements.teamHandicap.value),
              }
            : { playerId }),
          scores: Array.from({ length: 18 }, (_, i) =>
            f.elements["hole-" + i].value === ""
              ? null
              : Number(f.elements["hole-" + i].value),
          ),
          version: Number(f.dataset.version),
          submit: btn.value === "submit",
        };
      try {
        await write(path, body);
        dirty = false;
        await loadLeaderboard();
        render();
        toast("Scorecard saved on the server.");
      } catch (err) {
        if (err instanceof TypeError || !navigator.onLine) {
          try {
            queueScore(me.id, org.id, path, body);
            dirty = false;
            render();
            toast(
              "Connection lost. Scorecard queued on this device; review and sync when online.",
            );
          } catch {
            toast(
              "Unable to save locally. Keep this page open and copy your scores.",
            );
          }
        } else toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  document.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        const id = b.dataset.id;
        if (
          await seasonAction(
            b.dataset.action,
            id,
            { s, org },
            {
              ...opsHelpers(),
              setSeason: (value) => {
                selectedSeasonId = value;
              },
            },
          )
        )
          return;
        if (
          await operationsAction(
            b.dataset.action,
            id,
            opsContext(),
            opsHelpers(),
          )
        )
          return;
        switch (b.dataset.action) {
          case "import-handicaps":
            dialog(
              "Import supplied handicap records",
              "<p>Paste a JSON array exported or prepared by your club. Each record needs playerEmail, provider, membershipId, index and asOf. This does not contact or verify a federation service.</p>" +
                textArea(
                  "Records JSON",
                  "records",
                  '[{"playerEmail":"player@example.com","provider":"USGA / GHIN","membershipId":"1234567","index":12.4,"asOf":"2026-10-19"}]',
                ),
              async (f) => {
                let records;
                try {
                  records = JSON.parse(f.get("records"));
                } catch {
                  throw Error("Enter a valid JSON array.");
                }
                await write("handicap-import", { records });
              },
              { wide: true },
            );
            break;
          case "export-handicaps": {
            const records = s.cards
              .filter((c) => c.status === "Attested")
              .map((c) => attestedRoundRecord(s, c));
            download(
              "apexlinks-attested-rounds.json",
              JSON.stringify(records, null, 2),
              "application/json",
            );
            break;
          }
          case "score-queue":
            queueDialog();
            break;
          case "new-matches":
            if (!round()) return toast("Add a competition round first.");
            if (
              confirm("Generate the next bracket stage in the selected round?")
            ) {
              await write("matches", { roundId });
              render();
            }
            break;
          case "finalise-match": {
            const m = s.matches.find((m) => m.id === id);
            if (m.status === "Completed") {
              if (confirm("Reopen this match and its scorecards?")) {
                await write("matches/" + id + "/reopen");
                render();
              }
              break;
            }
            dialog(
              "Finalise match",
              select(
                "Winner decision",
                "winner",
                [
                  ["", "Use calculated result"],
                  [m.playerA, player(m.playerA).name],
                  [m.playerB, player(m.playerB).name],
                ],
                "",
              ) +
                textArea(
                  "Reason (required for playoff / concession override)",
                  "reason",
                ) +
                "<p>An explicit winner records an organiser decision. It does not invent or post extra-hole scores.</p>",
              async (f) =>
                write("matches/" + id + "/finalise", Object.fromEntries(f)),
            );
            break;
          }
          case "entry-status": {
            const entry = s.entries.find((e) => e.id === id);
            dialog(
              "Entry status",
              select(
                "Competition status",
                "status",
                ["Registered", "Withdrawn", "Disqualified", "No return"],
                entry.status === "Waitlisted" ? "Registered" : entry.status,
              ) +
                textArea(
                  "Reason for withdrawal / decision",
                  "reason",
                  entry.reason || "",
                ) +
                "<p>Withdrawing before play promotes the first waiting-list player. This does not refund or void an invoice.</p>",
              async (f) => write("entry-status/" + id, Object.fromEntries(f)),
            );
            break;
          }
          case "new-handicap":
            if (!s.players.length) return toast("Add a player first.");
            dialog(
              "Record supplied handicap",
              select("Player", "playerId", playerOptions(), s.players[0].id) +
                select(
                  "Record provider",
                  "provider",
                  [
                    "England Golf / MyEG",
                    "USGA / GHIN",
                    "Other federation",
                    "Manual",
                  ],
                  "England Golf / MyEG",
                ) +
                input(
                  "Membership / CDH / GHIN number",
                  "membershipId",
                  "",
                  "text",
                  'required maxlength="80"',
                ) +
                input(
                  "Handicap index",
                  "index",
                  18,
                  "number",
                  'min="-10" max="54" step="0.1" required',
                ) +
                input("Record date", "asOf", today(), "date", "required") +
                select(
                  "Calculate playing handicap for course (optional)",
                  "courseId",
                  [
                    ["", "Store record only"],
                    ...s.courses.map((c) => [c.id, c.name + " · " + c.tee]),
                  ],
                  "",
                ) +
                input(
                  "Competition allowance (%)",
                  "allowance",
                  100,
                  "number",
                  'min="1" max="100" required',
                ) +
                "<p>This records a value you supply. It is not a verified federation API response. Calculating a playing handicap changes the player profile, not existing tournament entries.</p>",
              async (f) =>
                write("handicap-records", {
                  ...Object.fromEntries(f),
                  index: number(f, "index"),
                  allowance: number(f, "allowance"),
                }),
            );
            break;
          case "booking-rules":
            if (!s.courses.length) return toast("Add a course first.");
            {
              const c = course(id) || s.courses[0],
                r = s.bookingRules.find((r) => r.courseId === c.id);
              dialog(
                "Booking hours & holidays",
                select(
                  "Course",
                  "courseId",
                  s.courses.map((c) => [c.id, c.name + " · " + c.tee]),
                  c.id,
                ) +
                  input(
                    "Timezone",
                    "timezone",
                    r?.timezone || "Europe/London",
                    "text",
                    "required",
                  ) +
                  input(
                    "Opening time",
                    "open",
                    r?.open || "07:00",
                    "time",
                    "required",
                  ) +
                  input(
                    "Last slot must finish by",
                    "close",
                    r?.close || "20:00",
                    "time",
                    "required",
                  ) +
                  input(
                    "Slot interval (minutes)",
                    "interval",
                    r?.interval || 10,
                    "number",
                    'min="5" max="30" required',
                  ) +
                  "<fieldset><legend>Closed weekdays</legend>" +
                  [
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ]
                    .map(
                      (day, i) =>
                        `<label class="check-label"><input type="checkbox" name="closedDays" value="${i}" ${r?.closedDays.includes(i) ? "checked" : ""}>${day}</label>`,
                    )
                    .join("") +
                  "</fieldset>" +
                  textArea(
                    "Closed dates (YYYY-MM-DD, one per line)",
                    "closedDates",
                    r?.closedDates.join("\n") || "",
                  ),
                async (f) =>
                  write("booking-rules", {
                    ...Object.fromEntries(f),
                    interval: number(f, "interval"),
                    closedDays: f.getAll("closedDays").map(Number),
                    closedDates: String(f.get("closedDates"))
                      .split(/\s+/)
                      .filter(Boolean),
                  }),
              );
              break;
            }
          case "membership-resume":
          case "membership-checkout": {
            const pending =
              b.dataset.action === "membership-resume"
                ? s.onlineMemberships.find((m) => m.id === id)
                : null;
            const plan = s.plans.find((p) => p.id === (pending?.planId || id));
            const golfers = s.players.filter((p) =>
              pending
                ? p.id === pending.playerId
                : manager() || p.email === me.email,
            );
            if (!golfers.length)
              throw Error(
                "Ask your club organiser to link a player profile to your account email.",
              );
            dialog(
              "Annual recurring membership",
              `<p>${esc(pending?.planName || plan.name)} renews every year at ${money(pending?.amount ?? plan.amount)} until you stop renewal. Your membership starts after Stripe confirms the paid invoice.</p>` +
                select(
                  "Golfer",
                  "playerId",
                  golfers.map((p) => [p.id, p.name]),
                  golfers[0].id,
                ) +
                '<label class="check-label"><input type="checkbox" required>I agree to annual recurring payments through Stripe.</label>',
              async (form) => {
                const result = await api(
                  endpoint(`billing/${pending?.planId || id}/checkout`),
                  "POST",
                  { playerId: form.get("playerId") },
                );
                const url = new URL(result.url);
                if (
                  url.protocol !== "https:" ||
                  url.hostname !== "checkout.stripe.com"
                )
                  throw Error("Invalid membership checkout URL.");
                location.assign(url.href);
              },
              { submit: "Continue to Stripe" },
            );
            break;
          }
          case "membership-portal": {
            const result = await api(
              endpoint(`billing/${id}/portal`),
              "POST",
              {},
            );
            const url = new URL(result.url);
            if (
              url.protocol !== "https:" ||
              url.hostname !== "billing.stripe.com"
            )
              throw Error("Invalid billing portal URL.");
            location.assign(url.href);
            break;
          }
          case "membership-cancel":
            if (
              confirm(
                "Stop future annual renewal in Stripe? The membership period already paid for is retained.",
              )
            ) {
              const result = await write(`billing/${id}/cancel`, {});
              render();
              toast(result.message);
            }
            break;
          case "checkout-status": {
            const d = await api(endpoint("checkout-status/" + id), "POST", {});
            toast(d.message);
            break;
          }
          case "checkout": {
            const result = await api(endpoint("checkout/" + id), "POST", {});
            const url = new URL(result.url);
            if (
              url.protocol !== "https:" ||
              url.hostname !== "checkout.stripe.com"
            )
              throw Error("Invalid checkout URL.");
            location.assign(url.href);
            break;
          }
          case "export-teams":
            downloadCSV("apexlinks-team-results.csv", [
              ["Team", "Holes", "Gross", "Net", "Attested"],
              ...teamStandings(s, event()).map((t) => [
                t.name,
                t.thru,
                t.gross,
                t.net,
                t.attested,
              ]),
            ]);
            break;

          case "offline-workspace":
            if (offlineEnabled(me.id)) {
              clearOffline();
              render();
              toast(
                "Offline workspace removed. Queued drafts are retained for this account.",
              );
            } else if (
              confirm(
                "Store club data on this device for up to 12 hours? Use a trusted personal device. Passwords and session tokens are not stored.",
              )
            ) {
              if (!("serviceWorker" in navigator))
                throw Error(
                  "Offline workspaces require a supported browser over HTTPS.",
                );
              enableOffline(me.id);
              const cached = cacheWorkspace({
                me,
                orgs,
                org,
                s,
                eventId,
                roundId,
                playerId,
                config,
              });
              if (!cached) {
                clearOffline(me.id);
                throw Error(
                  "Device storage is unavailable or full. Offline workspace was not enabled.",
                );
              }
              render();
              toast("Offline workspace enabled. Keep this device secure.");
            }
            break;
          case "logout":
            if (dirty && !confirm("Discard unsaved scores?")) return;
            try {
              await api("auth/logout", "POST", {});
            } catch (err) {
              if (err instanceof TypeError || !navigator.onLine)
                localStorage.setItem("apexlinks.pendingLogout", "true");
              else throw err;
            }
            clearOffline();
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
          case "course-directory": {
            const d = dialog(
              "Worldwide course directory",
              "<p>Search OpenStreetMap course locations. Coverage is incomplete; official slope/ratings and hole data must be supplied separately. No course is added until you enter and save its tee data.</p>" +
                input("Course name search", "name", "", "search") +
                input(
                  "Country code (optional)",
                  "country",
                  "",
                  "text",
                  'maxlength="2" placeholder="GB, US, …"',
                ) +
                '<button type="button" class="primary" id="directory-search">Search directory</button><div id="directory-results" role="status"></div><p>© OpenStreetMap contributors · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">ODbL attribution</a></p>',
              null,
              { wide: true },
            );
            if (org.role === "admin") {
              const controls = document.createElement("div");
              controls.innerHTML =
                '<button type="button" class="outline" id="download-open-directory">Download open course directory</button><p id="download-open-status" role="status"></p>';
              d.querySelector("form").append(controls);
              const start = controls.querySelector("button"),
                status = controls.querySelector("p");
              const poll = async () => {
                try {
                  const job = await api(endpoint("course-directory/download"));
                  status.textContent = `${job.status} · ${job.total || 0} stored locations${job.error ? " · " + job.error : ""}`;
                  start.disabled = ["Downloading", "Importing"].includes(
                    job.status,
                  );
                } catch (error) {
                  status.textContent = error.message;
                }
              };
              start.onclick = async () => {
                if (
                  !confirm(
                    "Download openly licensed OpenStreetMap course locations? This may take several minutes. Official tee ratings are not included.",
                  )
                )
                  return;
                start.disabled = true;
                try {
                  await api(endpoint("course-directory/download"), "POST", {});
                  await poll();
                } catch (error) {
                  status.textContent = error.message;
                  start.disabled = false;
                }
              };
              const timer = setInterval(() => {
                if (!d.isConnected) {
                  clearInterval(timer);
                  return;
                }
                poll();
              }, 3000);
              d.addEventListener("close", () => clearInterval(timer), {
                once: true,
              });
              poll();
            }
            bindCourseDirectory(d, {
              api,
              path: endpoint("course-directory"),
              esc,
              onAdd(venue) {
                d.close();
                courseDialog({
                  ...venue,
                  id: null,
                  pars: Array(18).fill(null),
                  indexes: Array(18).fill(null),
                  lengths: Array(18).fill(null),
                  rating: null,
                  slope: null,
                  tee: "",
                });
              },
            });
            break;
          }
          case "course-calculator": {
            const tee = course(id);
            const d = dialog(
              "Course and playing handicap",
              `<p>${esc(tee.name)} · ${esc(tee.tee)} · Rating ${tee.rating ?? "missing"} · Slope ${tee.slope ?? "missing"}. This preview does not change player or tournament handicaps.</p>` +
                input(
                  "Handicap index",
                  "index",
                  "",
                  "number",
                  'min="-10" max="54" step="0.1" required',
                ) +
                input(
                  "Allowance (%)",
                  "allowance",
                  100,
                  "number",
                  'min="1" max="100" required',
                ) +
                '<p id="handicap-result" role="status"></p>',
              null,
            );
            const calculate = () => {
              try {
                const form = new FormData(d.querySelector("form"));
                if (!form.get("index")) return;
                const result = calculateHandicap(
                  Number(form.get("index")),
                  tee,
                  Number(form.get("allowance")),
                );
                d.querySelector("#handicap-result").textContent =
                  `Course handicap: ${result.courseHandicap} · Playing handicap: ${result.playingHandicap}`;
              } catch (error) {
                d.querySelector("#handicap-result").textContent = error.message;
              }
            };
            d.querySelectorAll("input").forEach(
              (input) => (input.oninput = calculate),
            );
            break;
          }
          case "export-courses":
            download(
              "apexlinks-course-tees.json",
              JSON.stringify(
                s.courses.map(({ id, ...c }) => c),
                null,
                2,
              ),
              "application/json",
            );
            break;
          case "import-courses": {
            const d = dialog(
              "Import course tee sets",
              '<p>Choose a CSV/JSON file or paste data below. Import 1–100 tee sets, up to 95 KB. All rows are validated before saving. Rating sources remain organiser-provided.</p><button type="button" class="outline" id="course-template">Download CSV template</button><label>Course data file<input id="course-import-file" type="file" accept=".csv,.json,text/csv,application/json"></label><label>Course tee sets JSON or CSV<textarea name="courses" rows="10" maxlength="95000" required>[]</textarea></label>',
              async (form) =>
                write("course-import", {
                  courses: parseCourseImport(form.get("courses")),
                }),
              { wide: true },
            );
            d.querySelector("#course-template").onclick = () =>
              downloadCSV("apexlinks-course-template.csv", [courseCSVColumns]);
            d.querySelector("#course-import-file").onchange = async (event) => {
              const file = event.target.files[0];
              if (!file) return;
              try {
                if (file.size > 95000)
                  throw Error("Split files into batches no larger than 95 KB.");
                const content = await file.text();
                parseCourseImport(content);
                d.querySelector('[name="courses"]').value = content;
                d.querySelector(".form-error").textContent = "";
              } catch (error) {
                d.querySelector(".form-error").textContent = error.message;
              }
            };
            break;
          }
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
            const team = teamFormats.includes(event().format),
              c = team
                ? s.teamCards.find(
                    (c) => c.roundId === roundId && c.team === selectedTeam,
                  )
                : s.cards.find(
                    (c) => c.roundId === roundId && c.playerId === playerId,
                  );
            await write(
              (team ? "team-cards" : "cards") + "/_/" + b.dataset.action,
              {
                roundId,
                ...(team ? { team: selectedTeam } : { playerId }),
                version: c.version,
              },
            );
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
          case "accounting-ledger":
            dialog(
              "Export accounting ledger",
              "<p>Cash receipts and confirmed Stripe refunds, using UTC dates. Amounts are GBP. This export does not calculate tax, fees, or bank settlement totals.</p>" +
                input(
                  "From date",
                  "from",
                  today().slice(0, 4) + "-01-01",
                  "date",
                  "required",
                ) +
                input("To date", "to", today(), "date", "required"),
              async (f) => {
                const result = await api(
                  endpoint("accounting-ledger") +
                    "?" +
                    new URLSearchParams({
                      from: f.get("from"),
                      to: f.get("to"),
                    }),
                );
                downloadCSV("apexlinks-accounting-ledger.csv", [
                  result.columns,
                  ...result.rows,
                ]);
              },
              { submit: "Export CSV" },
            );
            break;
          case "refund-invoice": {
            const invoice = s.invoices.find((i) => i.id === id);
            dialog(
              "Refund Stripe payment",
              `<p>This sends money back through Stripe. Maximum ${money(invoice.amount - (invoice.refundedAmount || 0))}.</p>` +
                input(
                  "Amount (GBP)",
                  "amount",
                  (
                    (invoice.amount - (invoice.refundedAmount || 0)) /
                    100
                  ).toFixed(2),
                  "number",
                  'required min="0.01" step="0.01"',
                ) +
                input(
                  "Refund reason",
                  "reason",
                  "",
                  "text",
                  'required maxlength="240"',
                ),
              async (f) => {
                const result = await write("refunds", {
                  invoiceId: id,
                  amount: Math.round(Number(f.get("amount")) * 100),
                  reason: f.get("reason"),
                });
                alert(result.message);
              },
              { submit: "Send refund" },
            );
            break;
          }
          case "refund-status": {
            const row = s.refunds.find((r) => r.id === id);
            const result = await write(
              `refunds/${id}/${row.status === "Creating" ? "retry" : "status"}`,
              {},
            );
            render();
            toast(result.message);
            break;
          }
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
                  ["manager", "scorer", "player", "viewer"],
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
                    `<div class="member-row"><strong>${esc(m.name)}</strong><small>${esc(m.email)}</small>${select("Role", m.id, ["admin", "manager", "scorer", "player", "viewer"], m.role)}</div>`,
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
          case "email-preferences": {
            const data = await api(endpoint("email-preferences"));
            dialog(
              "Club email preferences",
              "<p>Subscribe to club campaigns for this workspace. You can withdraw consent here or through any campaign email. Verify your email before subscribing.</p>" +
                (data.preferences
                  .map(
                    (p) =>
                      `<label class="check-label"><input type="checkbox" name="${esc(p.playerId)}" ${p.consented ? "checked" : ""}>${esc(p.name)} — receive club email campaigns</label>`,
                  )
                  .join("") ||
                  "<p>No player profile is linked to your account email in this club. Ask the organiser to link your player profile.</p>"),
              async (form) => {
                for (const preference of data.preferences)
                  await api(endpoint("email-preferences"), "POST", {
                    playerId: preference.playerId,
                    consented: form.has(preference.playerId),
                  });
              },
            );
            break;
          }
          case "campaign-new":
            dialog(
              "Draft email campaign",
              input(
                "Email subject",
                "subject",
                "",
                "text",
                'required maxlength="180"',
              ) +
                textArea("Email message", "body", "", "required") +
                select(
                  "Audience",
                  "eventId",
                  [
                    ["", "All subscribed golfers"],
                    ...s.events.map((e) => [e.id, e.name]),
                  ],
                  "",
                ),
              async (form) => write("campaigns", Object.fromEntries(form)),
            );
            break;
          case "campaign-schedule": {
            const preview = await api(endpoint("campaigns/" + id));
            const campaign = s.campaigns.find((c) => c.id === id);
            dialog(
              "Preview and schedule email",
              `<h3>${esc(campaign.subject)}</h3><p class="multiline">${esc(campaign.body)}</p><p>${preview.eligible} currently eligible email address(es). Consent is checked again before delivery.</p>` +
                input(
                  "Send at (your timezone; blank sends now)",
                  "sendAt",
                  "",
                  "datetime-local",
                ) +
                '<label class="check-label"><input type="checkbox" name="confirmed" required>I confirm this campaign should be sent through the email provider.</label>',
              async (form) =>
                write(`campaigns/${id}/schedule`, {
                  sendAt: form.get("sendAt")
                    ? new Date(form.get("sendAt")).toISOString()
                    : "",
                }),
              { submit: "Queue campaign" },
            );
            break;
          }
          case "campaign-cancel":
            if (
              confirm(
                "Cancel unsent campaign emails? Emails already being accepted cannot be recalled.",
              )
            ) {
              await write(`campaigns/${id}/cancel`, {});
              render();
            }
            break;
          case "verify-email": {
            const result = await api("auth/verify-request", "POST", {});
            toast(result.message);
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
                "Bogey / Par",
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
                r.bogey ?? "",
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
  const unsubscribeCode = new URLSearchParams(location.search).get(
    "unsubscribe",
  );
  if (unsubscribeCode) {
    history.replaceState({}, "", "/");
    document.querySelector("#app").innerHTML =
      '<section class="auth-form"><a class="brand" href="/">ApexLinks.</a><h2>Club email preferences</h2><p>Confirm that you want to stop campaign emails from this club.</p><button id="unsubscribe" class="primary">Unsubscribe from club emails</button><p id="unsubscribe-result" role="status"></p><a href="/">Return to ApexLinks</a></section>';
    document.querySelector("#unsubscribe").onclick = async (event) => {
      event.target.disabled = true;
      try {
        const session = await api("auth/me");
        csrf = session.csrf || "";
        const result = await api("unsubscribe", "POST", {
          token: unsubscribeCode,
        });
        document.querySelector("#unsubscribe-result").textContent =
          result.message;
        event.target.remove();
      } catch (error) {
        document.querySelector("#unsubscribe-result").textContent =
          error.message;
        event.target.disabled = false;
      }
    };
    return;
  }
  const verificationCode = new URLSearchParams(location.search).get("verify");
  if (verificationCode) {
    history.replaceState({}, "", "/");
    document.querySelector("#app").innerHTML =
      '<section class="auth-form"><a class="brand" href="/">ApexLinks.</a><h2>Verify your email</h2><p>Confirm that you requested this verification link.</p><button id="verify-email" class="primary">Confirm email verification</button><p id="verify-result" role="status"></p><a href="/">Return to ApexLinks</a></section>';
    document.querySelector("#verify-email").onclick = async (event) => {
      event.target.disabled = true;
      try {
        const session = await api("auth/me");
        csrf = session.csrf || "";
        const result = await api("auth/verify", "POST", {
          token: verificationCode,
        });
        document.querySelector("#verify-result").textContent = result.message;
        event.target.remove();
      } catch (error) {
        document.querySelector("#verify-result").textContent = error.message;
        event.target.disabled = false;
      }
    };
    return;
  }
  const resetCode = new URLSearchParams(location.search).get("reset");
  if (resetCode) return renderPasswordReset(resetCode);
  const publicCode = new URLSearchParams(location.search).get("leaderboard");
  if (publicCode) return publicBoard(publicCode);
  try {
    config = await api("config");
    const d = await api("auth/me");
    if (localStorage.getItem("apexlinks.pendingLogout")) {
      csrf = d.csrf || "";
      if (d.user) await api("auth/logout", "POST", {});
      localStorage.removeItem("apexlinks.pendingLogout");
      me = null;
      csrf = "";
      return renderAuth();
    }
    me = d.user;
    if (!me) {
      clearOffline();
      return renderAuth();
    }
    csrf = d.csrf;
    orgs = d.organisations;
    await loadOrg(
      orgs.find((o) => o.id === sessionStorage.getItem("apex-org"))?.id ||
        orgs[0].id,
    );
    render();
  } catch (err) {
    const cached = cachedWorkspace();
    if (
      !err.status &&
      (err instanceof TypeError || !navigator.onLine) &&
      cached &&
      !localStorage.getItem("apexlinks.pendingLogout")
    ) {
      ({ me, orgs, org, s, eventId, roundId, playerId, config } = cached);
      csrf = "";
      offlineSession = true;
      page = eventId ? "Tournament" : "Overview";
      tab = "Scoring";
      render();
      return;
    }
    document.querySelector("#app").innerHTML =
      `<div class="empty"><h1>Unable to connect</h1><p>${esc(err.message)}</p><button id="retry" class="primary">Try again</button></div>`;
    document.querySelector("#retry").onclick = boot;
  }
}
function spectatorTable(d) {
  if (teamFormats.includes(d.event.format))
    return table(
      ["TEAM", "THRU", "GROSS", "NET"],
      (d.teamStandings || [])
        .map(
          (t) =>
            `<tr><td>${esc(t.name)}</td><td>${t.thru}</td><td>${t.thru ? t.gross : "—"}</td><td>${t.thru ? t.net : "—"}</td></tr>`,
        )
        .join(""),
    );
  if (d.event.format === "Match play")
    return table(
      ["STAGE", "PLAYER A", "PLAYER B", "STATUS", "RESULT"],
      (d.matches || [])
        .map(
          (m) =>
            `<tr><td>${m.stage}</td><td>${esc(m.nameA)}</td><td>${esc(m.nameB)}</td><td>${m.status}</td><td>${esc(m.winnerName ? m.winnerName + " wins: " + m.result : "In progress")}</td></tr>`,
        )
        .join(""),
    );
  return table(
    [
      "POS",
      "PLAYER",
      "DIVISION",
      "THRU",
      "GROSS",
      "NET",
      d.event.format === "Bogey / Par" ? "BOGEY / PAR" : "POINTS",
    ],
    d.rows
      .map(
        (r) =>
          `<tr><td>${r.position ?? (r.status !== "Registered" ? esc(r.status) : "—")}</td><td>${esc(r.name)}</td><td>${esc(r.division)}</td><td>${r.thru}</td><td>${r.thru ? r.gross : "—"}</td><td>${r.thru ? r.net : "—"}</td><td>${d.event.format === "Bogey / Par" ? label(r.bogey) : r.points}</td></tr>`,
      )
      .join(""),
  );
}
async function publicBoard(code) {
  const update = async () => {
    try {
      const d = await api("public/" + encodeURIComponent(code));
      document.querySelector("#app").innerHTML =
        `<div class="spectator"><a class="brand" href="/">ApexLinks.</a>${heading(d.event.name, `${shortDate(d.event.date)} · ${d.event.format} · ${d.event.status}`)}<section class="panel">${spectatorTable(d)}</section><p>Provisional until competition rounds close. Refreshes every 10 seconds. Positions follow the organiser's configured tiebreak rules. Stroke totals depend on holes played.</p></div>`;
    } catch (err) {
      document.querySelector("#app").innerHTML =
        `<div class="empty"><h1>Leaderboard unavailable</h1><p>${esc(err.message)}</p><a href="/">Return to ApexLinks</a></div>`;
    }
  };
  await update();
  setInterval(update, 10000);
}
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .catch(() => {});
window.addEventListener("online", async () => {
  if (!me) return;
  try {
    const auth = await api("auth/me");
    if (auth.user?.id !== me.id) {
      toast("Sign in again before syncing your drafts.");
      return;
    }
    csrf = auth.csrf;
    offlineSession = false;
    if (
      !dirty &&
      !document.querySelector("dialog") &&
      !(page === "Tournament" && tab === "Scoring")
    )
      await refresh();
    if (readQueue(me.id).length)
      toast("Online again. Review queued scores to sync safely.");
  } catch {}
});
boot();
