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
const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  }),
  p = await ctx.newPage(),
  errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("dialog", (d) => d.accept());
const local = (iso) => {
  const d = new Date(iso),
    pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
try {
  await p.goto(base);
  await p.getByLabel("Email address").fill("club@demo.apexlinks.test");
  await p.getByLabel("Password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Sign in →", exact: true }).click();
  await p.getByRole("heading", { name: "A great day starts here." }).waitFor();
  const auth = await (await p.request.get(base + "/api/auth/me")).json(),
    orgId = auth.organisations[0].id,
    state = (
      await (await p.request.get(`${base}/api/orgs/${orgId}/state`)).json()
    ).state,
    players = state.players,
    round = state.rounds[0];
  await p.locator('nav [data-page="Operations"]').click();
  await p.getByRole("heading", { name: "Club operations" }).waitFor();
  await p.getByRole("button", { name: "Create task", exact: true }).click();
  await p.getByLabel("Task title").fill("Prepare starter packs");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p
    .getByRole("cell", { name: "Prepare starter packs", exact: true })
    .waitFor();
  await p.getByRole("button", { name: "Complete", exact: true }).click();
  await p.getByRole("cell", { name: "Done", exact: true }).waitFor();
  await p.getByRole("button", { name: "Report incident", exact: true }).click();
  await p.getByLabel("Title", { exact: true }).fill("Bunker rake missing");
  await p
    .getByLabel("Details", { exact: true })
    .fill("Starter requested a replacement.");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByRole("cell", { name: /Bunker rake missing/ }).waitFor();
  await p.getByRole("button", { name: "Update", exact: true }).click();
  try {
    await p.locator("dialog").waitFor({ timeout: 3000 });
  } catch (err) {
    console.log(
      "Incident dialog diagnostic:",
      await p.locator("#toast").textContent(),
      await p
        .getByRole("button", { name: "Update", exact: true })
        .getAttribute("data-id"),
    );
    throw err;
  }
  await p.locator('dialog select[name="status"]').selectOption("Resolved");
  await p.getByLabel("Resolution notes").fill("Replacement delivered");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByRole("cell", { name: "Resolved", exact: true }).waitFor();
  await p.locator('nav [data-page="Inbox"]').click();
  await p.getByRole("button", { name: "New message" }).click();
  await p.getByLabel("Subject", { exact: true }).fill("Round briefing");
  await p.getByLabel("Message", { exact: true }).fill("The starter is ready.");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByRole("heading", { name: "Round briefing" }).waitFor();
  await p.getByRole("button", { name: "Mark read" }).click();
  await p.getByText("Read", { exact: true }).waitFor();
  await p.locator('nav [data-page="Reports"]').click();
  await p.getByRole("button", { name: "Build report" }).click();
  await p.getByLabel("Report name").fill("Starter roster");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByRole("cell", { name: "Starter roster", exact: true }).waitFor();
  const download = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export CSV", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "apexlinks-report.csv");
  await p.locator('nav [data-page="Tournaments"]').click();
  await p.getByRole("button", { name: "Open →", exact: true }).click();
  await p.getByRole("button", { name: "Save template", exact: true }).click();
  await p.getByLabel("Template name").fill("Society monthly");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.getByRole("button", { name: "Tee sheet", exact: true }).click();
  await p.getByRole("button", { name: "Shotgun start", exact: true }).click();
  await p
    .getByLabel("Start (your timezone)")
    .fill(local(Date.now() - 90 * 60000));
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.getByRole("button", { name: "Assign marker", exact: true }).click();
  await p.getByLabel("Player being marked").selectOption(players[0].id);
  await p.getByLabel("Marker player profile").selectOption(players[1].id);
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.locator('nav [data-page="Operations"]').click();
  await p
    .getByRole("button", { name: "Record checkpoint", exact: true })
    .click();
  await p.getByLabel("Number of completed holes").fill("4");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByRole("cell", { name: "Behind pace", exact: true }).waitFor();
  await p.screenshot({ path: "/tmp/apex-operations.png", fullPage: true });
  await p.locator('nav [data-page="Settings"]').click();
  await p.getByRole("button", { name: "Enable offline workspace" }).click();
  await p.getByRole("button", { name: "Remove offline workspace" }).waitFor();
  await p.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  const offlineSnapshot = await p.evaluate(() =>
    JSON.parse(localStorage.getItem("apexlinks.offline.workspace.v1")),
  );
  assert.equal(Object.hasOwn(offlineSnapshot, "csrf"), false);
  assert.equal(JSON.stringify(offlineSnapshot).includes(password), false);
  await ctx.setOffline(true);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p
    .getByRole("spinbutton", { name: "Hole 1 score", exact: true })
    .waitFor();
  await p
    .getByRole("spinbutton", { name: "Hole 1 score", exact: true })
    .fill("3");
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
  const marker = await browser.newContext(),
    mp = await marker.newPage();
  await mp.goto(base);
  await mp.getByLabel("Email address").fill("player2@demo.apexlinks.test");
  await mp.getByLabel("Password", { exact: true }).fill(password);
  await mp.getByRole("button", { name: "Sign in →", exact: true }).click();
  await mp.getByRole("heading", { name: "A great day starts here." }).waitFor();
  const privateMessage = await p.request.post(
    `${base}/api/orgs/${orgId}/messages`,
    {
      headers: { "X-CSRF-Token": auth.csrf },
      data: {
        title: "Private player note",
        body: "Recipient only",
        playerIds: [players[0].id],
      },
    },
  );
  assert.equal(privateMessage.status(), 200);
  const markerAuth = await (await mp.request.get(base + "/api/auth/me")).json();
  const markerState = (
    await (await mp.request.get(`${base}/api/orgs/${orgId}/state`)).json()
  ).state;
  assert.equal(
    markerState.messages.some((m) => m.title === "Private player note"),
    false,
  );
  assert.equal(markerState.incidents.length, 0);
  assert.equal(markerState.reportViews.length, 0);
  const marked = await mp.request.post(`${base}/api/orgs/${orgId}/cards`, {
    headers: { "X-CSRF-Token": markerAuth.csrf },
    data: {
      roundId: round.id,
      playerId: players[0].id,
      scores: round.pars,
      version: 1,
      submit: true,
    },
  });
  assert.equal(marked.status(), 200, await marked.text());
  const selfAttest = await mp.request.post(
    `${base}/api/orgs/${orgId}/cards/_/attest`,
    {
      headers: { "X-CSRF-Token": markerAuth.csrf },
      data: { roundId: round.id, playerId: players[0].id, version: 2 },
    },
  );
  assert.equal(selfAttest.status(), 403);
  await marker.close();
  await p.locator('header [data-action="logout"]').click();
  await p.getByRole("heading", { name: "Welcome back" }).waitFor();
  await ctx.setOffline(true);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.getByRole("heading", { name: "Unable to connect" }).waitFor();
  assert.equal(
    await p
      .getByRole("spinbutton", { name: "Hole 1 score", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: tasks, incidents, inbox/read receipts, custom reports, templates, shotgun, marker permissions, pace desk, cold offline reload, queued sync and logout clearing the offline workspace.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
