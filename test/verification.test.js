import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server.js";

test("verification emails use authenticated, rate-limited, single-use confirmation without resetting passwords", async () => {
  let message;
  const server = createApp({
    database: ":memory:",
    secure: false,
    mailOptions: {
      key: "test",
      from: "Club <test@example.com>",
      appURL: "https://app.example",
      fetcher: async (_url, opts) => {
        message = JSON.parse(opts.body);
        return { ok: true };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const post = async (route, body, auth, expected = 200) => {
    const response = await fetch(base + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    return {
      data,
      cookie: response.headers.getSetCookie()[0]?.split(";")[0],
      csrf: data.csrf,
    };
  };
  try {
    const credentials = {
      name: "Verify User",
      email: "verify@example.com",
      password: "secure-password-123",
      organisation: "Club",
    };
    const auth = await post("auth/register", credentials);
    assert.equal(auth.data.user.emailVerified, false);
    await post("auth/verify-request", {}, null, 401);
    await post("auth/verify-request", {}, auth);
    assert.equal(message.subject, "Verify your ApexLinks email");
    assert.deepEqual(message.to, [credentials.email]);
    const token = new URL(
      message.text.match(/https:\/\/app.example\/\?verify=[a-f0-9]+/)[0],
    ).searchParams.get("verify");
    await post("auth/verify-request", {}, auth, 429);
    const other = await post("auth/register", {
      ...credentials,
      email: "other@example.com",
    });
    await post("auth/verify", { token }, other, 403);
    await post(
      "auth/reset",
      { token, password: "wrong-purpose-123" },
      null,
      400,
    );
    await post("auth/verify", { token }, auth);
    await post("auth/verify", { token }, null, 400);
    const session = await (
      await fetch(base + "auth/me", { headers: { Cookie: auth.cookie } })
    ).json();
    assert.equal(session.user.emailVerified, true);
    const login = await post("auth/login", credentials);
    assert.equal(login.data.user.emailVerified, true);
    await post("auth/verify-request", {}, auth);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
