import { once } from "node:events";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  password = "Browser-" + randomBytes(18).toString("hex");
const server = createApp({
  database: ":memory:",
  secure: false,
  demoPassword: password,
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
async function login(email) {
  const ctx = await browser.newContext({
      viewport: { width: 1360, height: 1000 },
    }),
    page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in →", exact: true }).click();
  await page
    .getByRole("heading", { name: "A great day starts here." })
    .waitFor();
  return { ctx, page };
}
try {
  const { ctx, page: p } = await login("admin@demo.apexlinks.test");
  assert.equal(await p.locator("#org-picker option").count(), 2);
  const me = await (await p.request.get(base + "/api/auth/me")).json(),
    orgId = me.organisations.find((o) => o.name === "Apex Demo Club").id;
  await p.locator("#org-picker").selectOption(orgId);
  await p.getByRole("heading", { name: "A great day starts here." }).waitFor();
  const info = await (
      await p.request.get(`${base}/api/orgs/${orgId}/state`)
    ).json(),
    players = info.state.players,
    course = info.state.courses[0];
  async function post(path, body) {
    const r = await p.request.post(`${base}/api/orgs/${orgId}/${path}`, {
      data: body,
      headers: { "X-CSRF-Token": me.csrf },
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  }
  async function setup(name, format, team) {
    const event = await post("events", {
      name,
      date: "2027-06-10",
      format,
      capacity: 2,
    });
    const r = await p.request.patch(
      `${base}/api/orgs/${orgId}/events/${event.id}`,
      {
        data: { ...event, status: "Open" },
        headers: { "X-CSRF-Token": me.csrf },
      },
    );
    assert.equal(r.status(), 200);
    const round = await post("rounds", {
      eventId: event.id,
      courseId: course.id,
      date: "2027-06-10",
    });
    for (const pl of players)
      await post("entries", {
        eventId: event.id,
        playerId: pl.id,
        handicap: 0,
        team: team ? "Green" : "",
      });
    return { event, round };
  }
  async function open(name) {
    await p.locator('nav [data-page="Tournaments"]').click();
    const card = p
      .locator(".event-card")
      .filter({ has: p.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: "Open →", exact: true }).click();
    await p.getByRole("heading", { name, exact: true, level: 1 }).waitFor();
  }
  await setup("Browser Scramble", "Scramble", true);
  await open("Browser Scramble");
  await p.getByRole("button", { name: "Scoring", exact: true }).click();
  await p.getByLabel("Team playing handicap").fill("5");
  for (let i = 1; i <= 18; i++)
    await p
      .getByRole("spinbutton", { name: `Hole ${i} score`, exact: true })
      .fill("4");
  await p.getByRole("button", { name: "Submit card" }).click();
  await p.getByText("Submitted", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Attest card" }).click();
  await p.getByText("Attested", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Leaderboard", exact: true }).click();
  await p.getByRole("heading", { name: "Scramble team standings" }).waitFor();
  assert.match(await p.locator("tbody").innerText(), /67/);
  await setup("Browser Knockout", "Match play", false);
  await open("Browser Knockout");
  await p.getByRole("button", { name: "Matches", exact: true }).click();
  await p.getByRole("button", { name: "Generate next stage" }).click();
  await p.getByRole("button", { name: "Finalise", exact: true }).waitFor();
  await p.getByRole("button", { name: "Scoring", exact: true }).click();
  for (let i = 1; i <= 10; i++)
    await p
      .getByRole("spinbutton", { name: `Hole ${i} score`, exact: true })
      .fill("3");
  await p.getByRole("button", { name: "Submit card" }).click();
  await p.getByText("Submitted", { exact: true }).waitFor();
  await p.locator("#player-picker").selectOption(players[1].id);
  for (let i = 1; i <= 10; i++)
    await p
      .getByRole("spinbutton", { name: `Hole ${i} score`, exact: true })
      .fill("4");
  await p.getByRole("button", { name: "Submit card" }).click();
  await p.getByText("Submitted", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Matches", exact: true }).click();
  await p.getByRole("button", { name: "Finalise", exact: true }).click();
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.getByRole("button", { name: "Reopen", exact: true }).waitFor();
  assert.match(await p.locator("tbody").innerText(), /10 & 8/);
  await setup("Browser Offline Round", "Stroke play", false);
  await open("Browser Offline Round");
  await p.getByRole("button", { name: "Scoring", exact: true }).click();
  await p
    .getByRole("spinbutton", { name: "Hole 1 score", exact: true })
    .fill("3");
  await ctx.setOffline(true);
  await p.getByRole("button", { name: "Save draft" }).click();
  await p.getByRole("button", { name: "Review queued scores" }).waitFor();
  await ctx.setOffline(false);
  await p.getByRole("button", { name: "Review queued scores" }).click();
  await p.getByRole("button", { name: "Sync card", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  assert.equal(
    await p
      .getByRole("spinbutton", { name: "Hole 1 score", exact: true })
      .inputValue(),
    "3",
  );
  assert.equal(
    await p.getByRole("button", { name: "Review queued scores" }).count(),
    0,
  );
  await p.locator('nav [data-page="Handicaps"]').click();
  await p.getByRole("button", { name: "Record handicap", exact: true }).click();
  await p.getByLabel("Membership / CDH / GHIN number").fill("DEMO123");
  await p.getByLabel("Handicap index", { exact: true }).fill("12.4");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.getByRole("cell", { name: "DEMO123", exact: true }).waitFor();
  assert.match(await p.locator("tbody").innerText(), /unverified/);
  const viewer = await login("viewer@demo.apexlinks.test");
  assert.equal(
    await viewer.page
      .getByRole("button", { name: "Create tournament" })
      .count(),
    0,
  );
  const vme = await (
    await viewer.page.request.get(base + "/api/auth/me")
  ).json();
  const denied = await viewer.page.request.post(
    `${base}/api/orgs/${orgId}/events`,
    { data: {}, headers: { "X-CSRF-Token": vme.csrf } },
  );
  assert.equal(denied.status(), 403);
  await viewer.ctx.close();
  for (const email of [
    "club@demo.apexlinks.test",
    "organiser@demo.apexlinks.test",
    "scorer@demo.apexlinks.test",
    "player@demo.apexlinks.test",
    "player2@demo.apexlinks.test",
  ]) {
    const role = await login(email);
    assert.equal(await role.page.locator("#org-picker option").count(), 1);
    await role.ctx.close();
  }
  assert.deepEqual(errors, []);
  await p.screenshot({ path: "/tmp/apex-handicap-screen.png", fullPage: true });
  console.log(
    "PASS: all seven demo accounts, multi-club scope, viewer denial, shared scramble scoring, match-play early result, offline queue/sync, and labelled handicap record.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
