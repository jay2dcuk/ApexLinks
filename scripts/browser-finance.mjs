import { once } from "node:events";
import { createHmac, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
let checkoutMetadata, verification;
const password = "Browser-" + randomBytes(18).toString("hex");
const server = createApp({
  database: ":memory:",
  secure: false,
  demoPassword: password,
  mailOptions: {
    key: "test-only",
    from: "Club <test@example.com>",
    appURL: "https://app.example",
    fetcher: async (_url, opts) => {
      verification = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: "email_browser" }) };
    },
  },
  paymentOptions: {
    key: "test-only",
    webhookSecret: "test-secret",
    appURL: "https://app.example",
    fetcher: async (url, opts) => {
      if (url.endsWith("/checkout/sessions")) {
        checkoutMetadata = Object.fromEntries(
          ["orgId", "invoiceId", "attempt"].map((k) => [
            k,
            opts.body.get(`metadata[${k}]`),
          ]),
        );
        return {
          ok: true,
          json: async () => ({
            id: "cs_browser",
            url: "https://checkout.stripe.com/c/pay/test",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        };
      }
      assert.equal(url, "https://api.stripe.com/v1/refunds");
      return {
        ok: true,
        json: async () => ({
          id: "re_browser",
          payment_intent: "pi_browser",
          amount: Number(opts.body.get("amount")),
          currency: "gbp",
          status: "succeeded",
        }),
      };
    },
  },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext(),
  p = await ctx.newPage(),
  errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("dialog", (d) => d.accept());
try {
  await p.goto(base);
  await p.getByLabel("Email address").fill("club@demo.apexlinks.test");
  await p.getByLabel("Password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Sign in →", exact: true }).click();
  await p.getByRole("heading", { name: "A great day starts here." }).waitFor();
  let auth = await (await p.request.get(base + "/api/auth/me")).json();
  const orgId = auth.organisations[0].id;
  const post = async (path, data) => {
    const response = await p.request.post(
      base + "/api/orgs/" + orgId + "/" + path,
      { headers: { "X-CSRF-Token": auth.csrf }, data },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  let state = (
    await (await p.request.get(`${base}/api/orgs/${orgId}/state`)).json()
  ).state;
  await post("plans", {
    name: "Annual club plan",
    amount: 5000,
    currency: "GBP",
  });
  state = (
    await (await p.request.get(`${base}/api/orgs/${orgId}/state`)).json()
  ).state;
  await post("subscriptions", {
    planId: state.plans[0].id,
    playerId: state.players[0].id,
    start: "2026-01-01",
    end: "2026-12-31",
  });
  state = (
    await (await p.request.get(`${base}/api/orgs/${orgId}/state`)).json()
  ).state;
  await post("checkout/" + state.invoices[0].id, {});
  const event = {
    id: "evt_browser",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_browser",
        payment_status: "paid",
        amount_total: 5000,
        currency: "gbp",
        payment_intent: "pi_browser",
        metadata: checkoutMetadata,
      },
    },
  };
  const raw = JSON.stringify(event),
    stamp = Math.floor(Date.now() / 1000);
  const webhook = await p.request.post(base + "/api/payments/webhook", {
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": `t=${stamp},v1=${createHmac("sha256", "test-secret")
        .update(stamp + "." + raw)
        .digest("hex")}`,
    },
    data: raw,
  });
  assert.equal(webhook.status(), 200, await webhook.text());
  await p.reload();
  await p.locator('nav [data-page="Finance"]').click();
  await p.getByRole("button", { name: "Refund", exact: true }).click();
  await p.getByLabel("Amount (GBP)").fill("15.00");
  await p.getByLabel("Refund reason").fill("Partial membership adjustment");
  await p.getByRole("button", { name: "Send refund", exact: true }).click();
  await p.getByRole("cell", { name: "Succeeded", exact: true }).waitFor();
  await p.getByText("Refunded £15.00", { exact: true }).waitFor();
  await p
    .getByRole("button", { name: "Export accounting ledger", exact: true })
    .click();
  const downloadEvent = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "apexlinks-accounting-ledger.csv");
  const ledger = await (
    await p.request.get(
      `${base}/api/orgs/${orgId}/accounting-ledger?from=2020-01-01&to=2030-01-01`,
    )
  ).json();
  assert.deepEqual(ledger.rows.map((r) => r[1]).sort(), ["Payment", "Refund"]);
  assert.equal(
    ledger.rows.reduce((n, r) => n + Number(r[9]), 0),
    35,
  );
  await p.locator('nav [data-page="Settings"]').click();
  await p.getByRole("button", { name: "Verify email", exact: true }).click();
  await p
    .getByRole("status")
    .filter({ hasText: "Verification link sent" })
    .waitFor();
  const token = new URL(
    verification.text.match(/https:\/\/app.example\/\?verify=[a-f0-9]+/)[0],
  ).searchParams.get("verify");
  await p.goto(base + "/?verify=" + token);
  assert.equal(new URL(p.url()).search, "");
  await p.getByRole("button", { name: "Confirm email verification" }).click();
  await p.getByText("Your email is verified.", { exact: true }).waitFor();
  await p.getByRole("link", { name: "Return to ApexLinks" }).click();
  await p.getByRole("heading", { name: "A great day starts here." }).waitFor();
  await p.locator('nav [data-page="Settings"]').click();
  await p.getByText("Email verified", { exact: true }).waitFor();
  const player = await browser.newContext(),
    pp = await player.newPage();
  await pp.goto(base);
  await pp.getByLabel("Email address").fill("player@demo.apexlinks.test");
  await pp.getByLabel("Password", { exact: true }).fill(password);
  await pp.getByRole("button", { name: "Sign in →", exact: true }).click();
  await pp.getByRole("heading", { name: "A great day starts here." }).waitFor();
  const pa = await (await pp.request.get(base + "/api/auth/me")).json();
  const denied = await pp.request.post(`${base}/api/orgs/${orgId}/refunds`, {
    headers: { "X-CSRF-Token": pa.csrf },
    data: {
      invoiceId: state.invoices[0].id,
      amount: 1,
      reason: "Not authorised",
    },
  });
  assert.equal(denied.status(), 403);
  assert.equal(
    (
      await pp.request.get(
        `${base}/api/orgs/${orgId}/accounting-ledger?from=2020-01-01&to=2030-01-01`,
      )
    ).status(),
    403,
  );
  assert.equal(
    (await pp.request.get(`${base}/api/orgs/${orgId}/campaigns`)).status(),
    403,
  );
  const verifyPlayer = await pp.request.post(
    base + "/api/auth/verify-request",
    {
      headers: { "X-CSRF-Token": pa.csrf },
      data: {},
    },
  );
  assert.equal(verifyPlayer.status(), 200);
  const playerToken = new URL(
    verification.text.match(/https:\/\/app.example\/\?verify=[a-f0-9]+/)[0],
  ).searchParams.get("verify");
  await pp.goto(base + "/?verify=" + playerToken);
  await pp.getByRole("button", { name: "Confirm email verification" }).click();
  await pp.getByText("Your email is verified.", { exact: true }).waitFor();
  await pp.getByRole("link", { name: "Return to ApexLinks" }).click();
  await pp.getByRole("heading", { name: "A great day starts here." }).waitFor();
  await pp.locator('nav [data-page="Settings"]').click();
  await pp
    .getByRole("button", { name: "Email preferences", exact: true })
    .click();
  await pp.getByRole("checkbox").check();
  await pp.getByRole("button", { name: "Save", exact: true }).click();
  await pp.locator("dialog").waitFor({ state: "detached" });
  await p.bringToFront();
  await p.locator('nav [data-page="Campaigns"]').click();
  await p.getByRole("button", { name: "Draft campaign", exact: true }).click();
  await p
    .getByLabel("Email subject", { exact: true })
    .fill("Club practice briefing");
  await p
    .getByLabel("Email message", { exact: true })
    .fill("Please meet the starter before play.");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p
    .getByRole("cell", { name: "Club practice briefing", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Preview / schedule", exact: true })
    .click();
  await p.getByText(/1 currently eligible email/).waitFor();
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Queue campaign", exact: true }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  try {
    await p.getByRole("cell", { name: "Accepted: 1", exact: true }).waitFor();
  } catch (error) {
    console.log(
      "Campaign diagnostic:",
      await (await p.request.get(`${base}/api/orgs/${orgId}/campaigns`)).json(),
    );
    throw error;
  }
  const unsubscribeToken = new URL(
    verification.text.match(
      /https:\/\/app.example\/\?unsubscribe=[a-f0-9]+/,
    )[0],
  ).searchParams.get("unsubscribe");
  await pp.goto(base + "/?unsubscribe=" + unsubscribeToken);
  await pp
    .getByRole("button", { name: "Unsubscribe from club emails" })
    .click();
  await pp
    .getByText("Club campaign emails are disabled for this address.", {
      exact: true,
    })
    .waitFor();
  const prefs = await (
    await pp.request.get(`${base}/api/orgs/${orgId}/email-preferences`)
  ).json();
  assert.equal(prefs.preferences[0].consented, false);
  await player.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: verified payment, partial refund, accounting export, email verification, player consent, queued campaign acceptance, unsubscribe and restricted permissions (mock providers only).",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
