import { once } from "node:events";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { defaultPars, defaultIndexes } from "../public/scoring.js";
import { courseCSVColumns } from "../public/course-import.js";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  password = "Browser-" + randomBytes(18).toString("hex");
const server = createApp({
  database: ":memory:",
  secure: false,
  demoPassword: password,
  directoryOptions: {
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: "way",
            id: 123,
            tags: {
              name: "Fictional Test Links",
              "addr:city": "Testtown",
              "addr:country": "GB",
            },
            center: { lat: 56, lon: -3 },
          },
        ],
      }),
    }),
  },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  }),
  context = await browser.newContext(),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByLabel("Email address").fill("club@demo.apexlinks.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in →", exact: true }).click();
  await page
    .getByRole("heading", { name: "A great day starts here." })
    .waitFor();
  await page.locator('nav [data-page="Courses"]').click();
  await page
    .getByRole("button", { name: "Worldwide directory", exact: true })
    .click();
  await page.getByLabel("Course name search").fill("Fictional");
  await page.getByLabel("Country code (optional)").fill("GB");
  await page
    .getByRole("button", { name: "Search directory", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Fictional Test Links", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Add tee data", exact: true }).click();
  assert.equal(
    await page.locator('dialog input[name="rating"]').inputValue(),
    "",
  );
  assert.equal(
    await page.locator('dialog input[name="par-0"]').inputValue(),
    "",
  );
  await page.getByLabel("Tee name", { exact: true }).fill("White");
  await page.locator('dialog select[name="ratedFor"]').selectOption("Men");
  await page
    .getByLabel("Course rating (optional)", { exact: true })
    .fill("71.8");
  await page.getByLabel("Slope (optional)", { exact: true }).fill("128");
  await page
    .getByLabel("Rating source", { exact: true })
    .fill("Fictional browser fixture");
  await page
    .getByLabel("Rating as-of date", { exact: true })
    .fill("2026-10-01");
  for (let i = 0; i < 18; i++) {
    await page
      .locator(`dialog input[name="par-${i}"]`)
      .fill(String(defaultPars[i]));
    await page
      .locator(`dialog input[name="si-${i}"]`)
      .fill(String(defaultIndexes[i]));
    await page.locator(`dialog input[name="length-${i}"]`).fill("350");
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("heading", { name: "Fictional Test Links · White", exact: true })
    .waitFor();
  const panel = page.locator(".course-panel").filter({
    has: page.getByRole("heading", {
      name: "Fictional Test Links · White",
      exact: true,
    }),
  });
  await panel
    .getByRole("button", { name: "Handicap calculator", exact: true })
    .click();
  await page.getByLabel("Handicap index", { exact: true }).fill("12.4");
  await page.getByLabel("Allowance (%)", { exact: true }).fill("95");
  await page
    .getByText("Course handicap: 14 · Playing handicap: 13", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export tee sets", exact: true })
    .click();
  assert.equal(
    (await downloadEvent).suggestedFilename(),
    "apexlinks-course-tees.json",
  );
  await page
    .getByRole("button", { name: "Import tee sets", exact: true })
    .click();
  const row = {
    name: "Fictional Test Links",
    tee: "Red",
    country: "GB",
    location: "Testtown",
    ratedFor: "Women",
    rating: 73.2,
    slope: 130,
    pars: defaultPars,
    indexes: defaultIndexes,
  };
  await page.getByLabel("Course tee sets JSON").fill(JSON.stringify([row]));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("heading", { name: "Fictional Test Links · Red", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Import tee sets", exact: true })
    .click();
  const csvData = { ...row, tee: "Blue", slope: 131 };
  for (let i = 1; i <= 18; i++) {
    csvData["par" + i] = defaultPars[i - 1];
    csvData["si" + i] = defaultIndexes[i - 1];
  }
  const csv =
    courseCSVColumns.join(",") +
    "\n" +
    courseCSVColumns
      .map(
        (key) => '"' + String(csvData[key] ?? "").replaceAll('"', '""') + '"',
      )
      .join(",");
  await page
    .getByLabel("Course data file", { exact: true })
    .setInputFiles({
      name: "courses.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await page.waitForFunction(() =>
    document
      .querySelector('dialog textarea[name="courses"]')
      .value.startsWith("name,tee"),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("heading", { name: "Fictional Test Links · Blue", exact: true })
    .waitFor();
  const auth = await (await page.request.get(base + "/api/auth/me")).json(),
    orgId = auth.organisations[0].id,
    state = (
      await (await page.request.get(`${base}/api/orgs/${orgId}/state`)).json()
    ).state;
  assert.equal(
    state.courses.filter((c) => c.name === "Fictional Test Links").length,
    3,
  );
  const white = state.courses.find(
    (c) => c.name === "Fictional Test Links" && c.tee === "White",
  );
  assert.match(white.directoryAttribution, /OpenStreetMap/);
  assert.equal(white.verified, false);
  assert.equal(white.slope, 128);
  const write = async (path, body, method = "POST") => {
    const response = await page.request.fetch(
      `${base}/api/orgs/${orgId}/${path}`,
      { method, headers: { "X-CSRF-Token": auth.csrf }, data: body },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const event = await write("events", {
    name: "Bogey Test Cup",
    date: "2027-01-01",
    format: "Bogey / Par",
    capacity: 20,
    fee: 0,
    tiebreak: "Countback",
  });
  const round = await write("rounds", {
    eventId: event.id,
    courseId: white.id,
    date: "2027-01-01",
  });
  for (const p of state.players)
    await write("entries", { eventId: event.id, playerId: p.id, handicap: 0 });
  await write("events/" + event.id, { ...event, status: "Live" }, "PATCH");
  for (const [index, p] of state.players.entries()) {
    const scores = [...defaultPars];
    if (index === 1) scores[17]--;
    await write("cards", {
      roundId: round.id,
      playerId: p.id,
      scores,
      version: 0,
      submit: true,
    });
    await write("cards/_/attest", {
      roundId: round.id,
      playerId: p.id,
      version: 1,
    });
  }
  await write("rounds/" + round.id, { status: "Closed" }, "PATCH");
  await write("events/" + event.id, { ...event, status: "Completed" }, "PATCH");
  const standing = await (
    await page.request.get(`${base}/api/orgs/${orgId}/leaderboard/${event.id}`)
  ).json();
  assert.equal(standing.rows[0].bogey, 1);
  assert.equal(standing.rows[0].playerId, state.players[1].id);
  await write("sharing", { eventId: event.id, enabled: true });
  const latest = (
    await (await page.request.get(`${base}/api/orgs/${orgId}/state`)).json()
  ).state;
  await page.goto(
    base +
      "/?leaderboard=" +
      latest.events.find((e) => e.id === event.id).publicCode,
  );
  await page
    .getByRole("columnheader", { name: "BOGEY / PAR", exact: true })
    .waitFor();
  await page.getByRole("cell", { name: "+1", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: mocked global directory, blank ratings, tee persistence/provenance, handicap calculator/import/export, completed Bogey/Par tournament and spectator standings. No live directory or real course ratings assumed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
