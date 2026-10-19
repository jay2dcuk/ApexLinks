import { once } from "node:events";
import { createApp } from "../server.js";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const server = createApp({ database: ":memory:", secure: false });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
import assert from "node:assert/strict";
const b = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await p.goto(base);
  await p.getByRole("button", { name: "New here? Create an account" }).click();
  await p.getByLabel("Your name", { exact: true }).fill("Browser Owner");
  await p.getByLabel("Organisation / society name").fill("Browser Golf Club");
  await p.getByLabel("Email address").fill(`browser-${Date.now()}@example.com`);
  await p.getByLabel("Password", { exact: true }).fill("browser-password-123");
  await p.getByRole("button", { name: "Create workspace" }).click();
  await p.getByRole("heading", { name: "A great day starts here." }).waitFor();
  await p.getByRole("button", { name: "Load sample tournament" }).click();
  await p.getByRole("heading", { name: "Club Invitational" }).waitFor();
  await p.screenshot({ path: "/tmp/apex-full-dashboard.png", fullPage: true });
  await p.getByRole("button", { name: "Open →", exact: true }).click();
  await p.getByRole("button", { name: "Field", exact: true }).click();
  await p
    .getByRole("heading", { name: "Tournament field & waiting list" })
    .waitFor();
  assert.equal(await p.locator("tbody tr").count(), 4);
  await p.getByRole("button", { name: "Tee sheet", exact: true }).click();
  await p.getByRole("button", { name: "Generate pairings" }).click();
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  assert.equal(await p.locator("tbody tr").count(), 1);
  await p.getByRole("button", { name: "Scoring", exact: true }).click();
  for (let i = 1; i <= 18; i++)
    await p
      .getByRole("spinbutton", { name: `Hole ${i} score`, exact: true })
      .fill("4");
  await p.getByRole("button", { name: "Submit card" }).click();
  await p.getByText("Submitted", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Attest card" }).click();
  await p.getByText("Attested", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Leaderboard", exact: true }).click();
  await p.getByRole("heading", { name: "Stableford standings" }).waitFor();
  assert.match(await p.locator("tbody").first().innerText(), /72/);
  const download = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export CSV" }).click();
  assert.equal(
    (await download).suggestedFilename(),
    "apexlinks-leaderboard.csv",
  );
  await p.locator('nav [data-page="Players"]').click();
  await p.getByRole("button", { name: "Add player" }).click();
  await p.getByLabel("Full name").fill("New Browser Golfer");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByText("New Browser Golfer", { exact: true }).waitFor();
  await p.locator('nav [data-page="Memberships"]').click();
  await p.getByRole("button", { name: "Create plan" }).click();
  await p.getByLabel("Plan name").fill("Full member");
  await p.getByLabel("Annual fee (£)").fill("1200");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByRole("heading", { name: "Full member" }).waitFor();
  await p.getByRole("button", { name: "Assign membership" }).click();
  await p.getByLabel("End date", { exact: true }).fill("2028-12-31");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.locator('nav [data-page="Finance"]').click();
  await p.getByRole("button", { name: "Record payment" }).click();
  await p.getByLabel("Bank / cash / provider reference").fill("TEST BANK 123");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByText("Paid", { exact: true }).waitFor();
  await p.locator('nav [data-page="Bookings"]').click();
  await p.getByRole("button", { name: "Book tee time" }).click();
  await p.getByLabel("Start time (your timezone)").fill("2028-06-12T10:00");
  await p.getByRole("checkbox").first().check();
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByText("Confirmed", { exact: true }).waitFor();
  await p.locator('nav [data-page="Settings"]').click();
  await p.getByRole("button", { name: "Invite member" }).click();
  await p
    .getByLabel("Member email", { exact: true })
    .fill("new-person@example.com");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByLabel("Invitation code", { exact: true }).waitFor();
  assert.equal(
    (await p.getByLabel("Invitation code", { exact: true }).inputValue())
      .length,
    64,
  );
  await p.getByRole("button", { name: "Close dialog" }).click();
  await p.locator('nav [data-page="Tournaments"]').click();
  await p.getByRole("button", { name: "Open →", exact: true }).click();
  await p
    .getByRole("button", { name: "Share leaderboard", exact: true })
    .click();
  await p.getByRole("button", { name: "Enable sharing", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p
    .getByRole("button", { name: "Share leaderboard", exact: true })
    .click();
  const shareUrl = await p
    .getByLabel("Public leaderboard URL", { exact: true })
    .inputValue();
  const viewer = await b.newPage();
  await viewer.goto(shareUrl);
  await viewer.getByRole("heading", { name: "Club Invitational" }).waitFor();
  assert.match(await viewer.locator("tbody").innerText(), /72/);
  await p.getByRole("button", { name: "Disable sharing", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await viewer.reload();
  await viewer
    .getByRole("heading", { name: "Leaderboard unavailable" })
    .waitFor();
  await viewer.close();
  for (const name of [
    "Overview",
    "Tournaments",
    "Players",
    "Courses",
    "Bookings",
    "Memberships",
    "Finance",
    "Reports",
    "Settings",
  ]) {
    await p.locator(`nav [data-page="${name}"]`).click();
    await p.locator("main h1").waitFor();
    await p.waitForTimeout(100);
    assert.equal(await p.locator("main h1").count(), 1, name);
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator('nav [data-page="Overview"]').click();
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.screenshot({ path: "/tmp/apex-full-mobile.png", fullPage: true });
  await p.reload();
  await p.getByRole("heading", { name: "A great day starts here." }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: registration, sample setup, field, pairings, submitted/attested scorecard, leaderboard/CSV, players, memberships, invoice payment record, tee booking, invitation, nine sections, mobile layout, persisted session; no browser errors.",
  );
} finally {
  await b.close();
  await new Promise((resolve) => server.close(resolve));
}
