import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { openStore } from "./lib/store.js";
import { createMailer, createPayments } from "./lib/providers.js";
import { seedDemoAccounts } from "./lib/demo.js";
import { createApi } from "./lib/api.js";
const root = path.resolve(fileURLToPath(new URL("./public/", import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
export function createApp({
  database = process.env.DATABASE_PATH || path.resolve("data/apexlinks.sqlite"),
  secure = process.env.NODE_ENV === "production",
  mailOptions,
  paymentOptions,
  demoPassword,
} = {}) {
  const db = openStore(database),
    mailer = createMailer(mailOptions),
    payments = createPayments(db, paymentOptions),
    api = createApi(db, { secure, mailer, payments });
  if (demoPassword !== undefined) seedDemoAccounts(db, demoPassword);
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
    );
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      res.writeHead(400);
      return res.end("Invalid URL");
    }
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      try {
        let body = {};
        if (!["GET", "HEAD"].includes(req.method)) {
          let chunks = [],
            length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 100000) {
              const e = new Error("Request too large.");
              e.status = 413;
              throw e;
            }
            chunks.push(chunk);
          }
          if (req.url === "/api/payments/webhook" && req.method === "POST") {
            const result = payments.webhook(
              Buffer.concat(chunks),
              req.headers["stripe-signature"],
            );
            return res.end(JSON.stringify(result));
          }
          if (length) {
            if (!req.headers["content-type"]?.startsWith("application/json")) {
              const e = new Error("Use application/json.");
              e.status = 415;
              throw e;
            }
            try {
              body = JSON.parse(Buffer.concat(chunks).toString());
            } catch {
              const e = new Error("Invalid JSON.");
              e.status = 400;
              throw e;
            }
            if (!body || Array.isArray(body) || typeof body !== "object") {
              const e = new Error("JSON body must be an object.");
              e.status = 400;
              throw e;
            }
          }
        }
        if (req.method === "GET" && url.pathname === "/api/config")
          return res.end(
            JSON.stringify({
              storage:
                process.env.RENDER && !process.env.DATABASE_PATH
                  ? "ephemeral"
                  : "local",
              paymentProvider: payments.configured,
              mailProvider: mailer.configured,
              demoAccounts: process.env.ENABLE_DEMO_ACCOUNTS === "true",
              handicapProvider: false,
            }),
          );
        const result = await api(req, res, url, body);
        res.end(JSON.stringify(result ?? { ok: true }));
      } catch (e) {
        res.statusCode = e.status || 500;
        if (!e.status) console.error("API error:", e);
        res.end(
          JSON.stringify({
            error: e.status
              ? e.message
              : "An unexpected server error occurred.",
          }),
        );
      }
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      return res.end("Method not allowed");
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return res.end("Invalid URL");
    }
    const target = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!target.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    try {
      const content = await readFile(target);
      res.setHeader(
        "Content-Type",
        types[path.extname(target)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-cache");
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", () => db.close());
  return server;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.env.ENABLE_DEMO_ACCOUNTS === "true" && !process.env.DEMO_PASSWORD)
    throw Error("Set DEMO_PASSWORD securely before enabling demo accounts.");
  const server = createApp({
    demoPassword:
      process.env.ENABLE_DEMO_ACCOUNTS === "true"
        ? process.env.DEMO_PASSWORD
        : undefined,
  });
  server.listen(Number(process.env.PORT) || 3000, "0.0.0.0", () => {
    console.log("ApexLinks listening on port " + (process.env.PORT || 3000));
    if (process.env.RENDER && !process.env.DATABASE_PATH)
      console.warn(
        "Storage is ephemeral. Attach a Render disk and set DATABASE_PATH=/var/data/apexlinks.sqlite before storing real data.",
      );
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    });
}
