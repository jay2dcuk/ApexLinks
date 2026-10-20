import { operationsOperation } from "./operations-api.js";
import { accountingLedger, ledgerColumns } from "../public/accounting.js";
import { createCampaigns } from "./campaigns.js";
import {
  randomUUID,
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { emptyState } from "./store.js";
import {
  fail,
  text,
  integer,
  choice,
  email,
  date,
  timestamp,
  courseData,
} from "./validation.js";
import {
  leaderboard,
  teamLeaderboard,
  defaultPars,
  defaultIndexes,
} from "./scoring.js";
import { createMailer, createPayments } from "./providers.js";
import {
  competitionOperation,
  validateBookingRules,
} from "./competition-api.js";
import {
  formats,
  teamFormats,
  matchResult,
  teamStandings,
} from "../public/competition.js";
const scrypt = promisify(rawScrypt),
  id = () => randomUUID(),
  secret = () => randomBytes(32).toString("hex"),
  hash = (s) => createHash("sha256").update(s).digest("hex");
const roles = ["admin", "manager", "scorer", "player", "viewer"];
const staff = ["admin", "manager"];
const scoringRoles = ["admin", "manager", "scorer"];
const ttl = 7 * 24 * 60 * 60 * 1000;
export function createApi(
  db,
  {
    secure = false,
    mailer = createMailer(),
    payments = createPayments(db),
    campaigns = createCampaigns(db, mailer),
  } = {},
) {
  const limits = new Map();
  function throttle(ip) {
    const now = Date.now();
    if (limits.size > 10000)
      for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    const l = limits.get(ip) || { count: 0, until: now + 600000 };
    if (l.until < now) {
      l.count = 0;
      l.until = now + 600000;
    }
    l.count++;
    limits.set(ip, l);
    if (l.count > 30)
      fail(429, "Too many authentication attempts. Try again in 10 minutes.");
  }
  function session(req) {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("apex_session="))
      ?.slice(13);
    if (!cookie) return null;
    return db
      .prepare(
        "SELECT s.*,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
      )
      .get(hash(cookie), Date.now());
  }
  function login(res, user) {
    const token = secret(),
      csrf = secret();
    db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      hash(token),
      user.id,
      csrf,
      Date.now() + ttl,
    );
    res.setHeader(
      "Set-Cookie",
      `apex_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl / 1000}${secure ? "; Secure" : ""}`,
    );
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: Boolean(
          db
            .prepare(
              "SELECT 1 FROM verified_emails WHERE user_id=? AND email=?",
            )
            .get(user.id, user.email),
        ),
      },
      csrf,
    };
  }
  function organisations(userId) {
    return db
      .prepare(
        "SELECT o.id,o.name,m.role FROM orgs o JOIN members m ON m.org_id=o.id WHERE m.user_id=? ORDER BY o.name",
      )
      .all(userId);
  }
  function getState(orgId) {
    const org = db.prepare("SELECT * FROM orgs WHERE id=?").get(orgId);
    if (!org) fail(404, "Organisation not found.");
    return { org, state: { ...emptyState(), ...JSON.parse(org.state) } };
  }
  function member(orgId, userId) {
    const m = db
      .prepare("SELECT role FROM members WHERE org_id=? AND user_id=?")
      .get(orgId, userId);
    if (!m) fail(403, "You are not a member of this organisation.");
    return m.role;
  }
  function transact(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function mutate(orgId, actor, role, action, fn) {
    return transact(() => {
      const { state } = getState(orgId);
      const result = fn(state);
      state.version++;
      state.audit.unshift({
        id: id(),
        actor: actor.name,
        action,
        time: new Date().toISOString(),
      });
      state.audit = state.audit.slice(0, 1000);
      db.prepare("UPDATE orgs SET state=? WHERE id=?").run(
        JSON.stringify(state),
        orgId,
      );
      return result;
    });
  }
  function requireRole(role, allowed = staff) {
    if (!allowed.includes(role))
      fail(403, "Your role does not allow this action.");
  }
  function find(items, key, label) {
    const item = items.find((x) => x.id === key);
    if (!item) fail(404, `${label} not found.`);
    return item;
  }
  function newOrg(user, name) {
    const orgId = id();
    transact(() => {
      db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
        orgId,
        text(name, "Organisation name"),
        JSON.stringify(emptyState()),
      );
      db.prepare("INSERT INTO members VALUES(?,?,?)").run(
        orgId,
        user.id,
        "admin",
      );
    });
    return { id: orgId };
  }
  function publicState(s, role, userEmail) {
    if (role === "admin" || role === "manager") return s;
    const clean = structuredClone(s);
    clean.audit = [];
    clean.tasks = clean.tasks.filter(
      (t) =>
        t.assignee ===
        db.prepare("SELECT id FROM users WHERE email=?").get(userEmail)?.id,
    );
    clean.incidents = clean.incidents.filter(
      (i) =>
        i.createdBy ===
        db.prepare("SELECT id FROM users WHERE email=?").get(userEmail)?.id,
    );
    clean.messages = clean.messages.filter(
      (m) =>
        !m.playerIds.length ||
        m.playerIds.some(
          (id) => clean.players.find((p) => p.id === id)?.email === userEmail,
        ),
    );
    clean.receipts = clean.receipts.filter(
      (r) =>
        r.userId ===
        db.prepare("SELECT id FROM users WHERE email=?").get(userEmail)?.id,
    );
    clean.reportViews = [];
    clean.handicapRecords = clean.handicapRecords.filter(
      (r) =>
        clean.players.find((p) => p.id === r.playerId)?.email === userEmail,
    );
    const ownIds = new Set(
      clean.players.filter((p) => p.email === userEmail).map((p) => p.id),
    );
    clean.invoices = clean.invoices.filter((i) => ownIds.has(i.playerId));
    clean.subscriptions = clean.subscriptions.filter((i) =>
      ownIds.has(i.playerId),
    );
    clean.players.forEach((p) => {
      if (p.email !== userEmail) delete p.email;
    });
    return clean;
  }
  return async function api(req, res, url, b) {
    const parts = url.pathname.split("/").filter(Boolean).slice(1),
      method = req.method;
    if (parts[0] === "health") return { ok: true };
    if (parts[0] === "public" && method === "GET") {
      const token = parts[1];
      if (!token || !/^[a-f0-9]{64}$/.test(token))
        fail(404, "Leaderboard link not found.");
      const found = db
        .prepare(
          "SELECT state FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(orgs.state,'$.events') WHERE json_extract(value,'$.publicCode')=?)",
        )
        .get(token);
      if (!found) fail(404, "This leaderboard link is unavailable.");
      const state = { ...emptyState(), ...JSON.parse(found.state) },
        event = state.events.find((e) => e.publicCode === token);
      return {
        event: {
          name: event.name,
          date: event.date,
          format: event.format,
          status: event.status,
        },
        rows: leaderboard(state, event),
        teamStandings: teamStandings(state, event),
        matches: state.matches
          .filter((m) => m.eventId === event.id)
          .map((m) => ({
            stage: m.stage,
            slot: m.slot,
            nameA: state.players.find((p) => p.id === m.playerA)?.name,
            nameB: state.players.find((p) => p.id === m.playerB)?.name,
            winnerName: state.players.find((p) => p.id === m.winner)?.name,
            result: m.result,
            status: m.status,
          })),
        rounds: state.rounds
          .filter((r) => r.eventId === event.id)
          .map((r) => ({ number: r.number, status: r.status })),
      };
    }
    const user = session(req);
    if (method !== "GET") {
      const origin = req.headers.origin;
      if (origin) {
        let host;
        try {
          host = new URL(origin).host;
        } catch {
          fail(403, "Invalid origin.");
        }
        if (host !== req.headers.host)
          fail(403, "Cross-origin request rejected.");
      }
      if (user && req.headers["x-csrf-token"] !== user.csrf)
        fail(403, "Your security token expired. Reload and retry.");
    }
    if (parts[0] === "auth") {
      const action = parts[1];
      if (method === "GET" && action === "me") {
        if (!user) return { user: null };
        return {
          user: {
            id: user.user_id,
            name: user.name,
            email: user.email,
            emailVerified: Boolean(
              db
                .prepare(
                  "SELECT 1 FROM verified_emails WHERE user_id=? AND email=?",
                )
                .get(user.user_id, user.email),
            ),
          },
          csrf: user.csrf,
          organisations: organisations(user.user_id),
        };
      }
      if (method === "POST" && ["register", "login"].includes(action)) {
        throttle(req.socket.remoteAddress || "unknown");
        const address = email(b.email);
        const password = text(b.password, "Password", 128);
        if (action === "register") {
          if (password.length < 12)
            fail(400, "Choose a password with at least 12 characters.");
          const name = text(b.name, "Name", 100),
            orgName = text(b.organisation, "Organisation name");
          const salt = secret();
          const key = await scrypt(password, salt, 64);
          const u = { id: id(), name, email: address };
          try {
            transact(() => {
              db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
                u.id,
                address,
                name,
                `${salt}:${key.toString("hex")}`,
                new Date().toISOString(),
              );
              const orgId = id();
              db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
                orgId,
                orgName,
                JSON.stringify(emptyState()),
              );
              db.prepare("INSERT INTO members VALUES(?,?,?)").run(
                orgId,
                u.id,
                "admin",
              );
            });
          } catch (e) {
            if (
              e.code?.startsWith("ERR_SQLITE") &&
              db.prepare("SELECT id FROM users WHERE email=?").get(address)
            )
              fail(
                409,
                "An account already exists for this email. Sign in instead.",
              );
            throw e;
          }
          return { ...login(res, u), organisations: organisations(u.id) };
        }
        const u = db.prepare("SELECT * FROM users WHERE email=?").get(address);
        const salt = u?.password.split(":")[0] || "unregistered-user";
        const key = await scrypt(password, salt, 64);
        if (
          !u ||
          !timingSafeEqual(key, Buffer.from(u.password.split(":")[1], "hex"))
        )
          fail(401, "Email or password is incorrect.");
        return { ...login(res, u), organisations: organisations(u.id) };
      }
      if (action === "verify-request" && method === "POST") {
        if (!user) fail(401, "Sign in to verify your email.");
        if (!mailer.configured) fail(503, "Email delivery is not configured.");
        if (
          db
            .prepare(
              "SELECT 1 FROM verified_emails WHERE user_id=? AND email=?",
            )
            .get(user.user_id, user.email)
        )
          return { message: "Your email is already verified." };
        const last = db
          .prepare(
            "SELECT MAX(created) AS created FROM verification_tokens WHERE user_id=?",
          )
          .get(user.user_id);
        if (last.created && Date.now() - last.created < 60000)
          fail(
            429,
            "Wait one minute before requesting another verification link.",
          );
        const token = secret(),
          created = Date.now();
        db.prepare("INSERT INTO verification_tokens VALUES(?,?,?,?)").run(
          hash(token),
          user.user_id,
          created + 86400000,
          created,
        );
        try {
          await mailer.sendVerification(user.email, token);
        } catch (error) {
          db.prepare("DELETE FROM verification_tokens WHERE token=?").run(
            hash(token),
          );
          throw error;
        }
        return { message: "Verification link sent. Check your inbox." };
      }
      if (action === "verify" && method === "POST") {
        throttle(req.socket.remoteAddress || "unknown");
        const token = hash(text(b.token, "Verification code", 100));
        return transact(() => {
          const record = db
            .prepare(
              "SELECT v.*,u.email FROM verification_tokens v JOIN users u ON u.id=v.user_id WHERE token=? AND expires>?",
            )
            .get(token, Date.now());
          if (!record)
            fail(
              400,
              "This verification link is invalid or expired. Request a new one in Settings.",
            );
          if (user && user.user_id !== record.user_id)
            fail(403, "Sign out before verifying another account’s email.");
          db.prepare(
            "INSERT OR REPLACE INTO verified_emails VALUES(?,?,?)",
          ).run(record.user_id, record.email, new Date().toISOString());
          db.prepare("DELETE FROM verification_tokens WHERE user_id=?").run(
            record.user_id,
          );
          return { message: "Your email is verified." };
        });
      }
      if (action === "recover" && method === "POST") {
        throttle(req.socket.remoteAddress || "unknown");
        const address = email(b.email);
        if (!mailer.configured)
          fail(
            503,
            "Email recovery is not configured. Contact your club organiser.",
          );
        const u = db.prepare("SELECT id FROM users WHERE email=?").get(address);
        if (u) {
          const token = secret();
          db.prepare("INSERT INTO recovery VALUES(?,?,?)").run(
            hash(token),
            u.id,
            Date.now() + 1800000,
          );
          try {
            await mailer.sendRecovery(address, token);
          } catch (e) {
            db.prepare("DELETE FROM recovery WHERE token=?").run(hash(token));
            throw e;
          }
        }
        return { message: "If an account exists, a reset link will be sent." };
      }
      if (action === "reset" && method === "POST") {
        throttle(req.socket.remoteAddress || "unknown");
        const token = hash(text(b.token, "Reset code", 100)),
          password = text(b.password, "Password", 128);
        if (password.length < 12) fail(400, "Use at least 12 characters.");
        if (
          !db
            .prepare("SELECT user_id FROM recovery WHERE token=? AND expires>?")
            .get(token, Date.now())
        )
          fail(400, "Reset link is invalid or expired.");
        const salt = secret(),
          key = await scrypt(password, salt, 64);
        transact(() => {
          const r = db
            .prepare("SELECT user_id FROM recovery WHERE token=? AND expires>?")
            .get(token, Date.now());
          if (!r) fail(400, "Reset link is invalid or expired.");
          db.prepare("UPDATE users SET password=? WHERE id=?").run(
            salt + ":" + key.toString("hex"),
            r.user_id,
          );
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(r.user_id);
          db.prepare("DELETE FROM recovery WHERE user_id=?").run(r.user_id);
        });
        return { message: "Password updated. Sign in with your new password." };
      }
      if (action === "logout" && method === "POST") {
        if (user)
          db.prepare("DELETE FROM sessions WHERE token=?").run(user.token);
        res.setHeader(
          "Set-Cookie",
          `apex_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
        );
        return { ok: true };
      }
      if (action === "password" && method === "POST") {
        if (!user) fail(401, "Sign in first.");
        const u = db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(user.user_id);
        const current = await scrypt(
          text(b.current, "Current password", 128),
          u.password.split(":")[0],
          64,
        );
        if (
          !timingSafeEqual(
            current,
            Buffer.from(u.password.split(":")[1], "hex"),
          )
        )
          fail(401, "Current password is incorrect.");
        const password = text(b.password, "New password", 128);
        if (password.length < 12) fail(400, "Use at least 12 characters.");
        const salt = secret(),
          key = await scrypt(password, salt, 64);
        transact(() => {
          db.prepare("UPDATE users SET password=? WHERE id=?").run(
            `${salt}:${key.toString("hex")}`,
            user.user_id,
          );
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.user_id);
        });
        return login(res, {
          id: user.user_id,
          name: user.name,
          email: user.email,
        });
      }
      fail(404, "Unknown account endpoint.");
    }
    if (parts[0] === "unsubscribe" && method === "POST")
      return campaigns.unsubscribe(b.token);
    if (!user) fail(401, "Please sign in.");
    if (parts[0] === "join" && method === "POST") {
      return transact(() => {
        const inv = db
          .prepare("SELECT * FROM invites WHERE token=? AND expires>?")
          .get(hash(text(b.code, "Invitation code", 100)), Date.now());
        if (!inv || inv.email !== user.email)
          fail(
            400,
            "Invitation is invalid, expired, or for a different email.",
          );
        db.prepare(
          "INSERT INTO members VALUES(?,?,?) ON CONFLICT DO NOTHING",
        ).run(inv.org_id, user.user_id, inv.role);
        db.prepare("DELETE FROM invites WHERE token=?").run(inv.token);
        return { organisations: organisations(user.user_id) };
      });
    }
    if (parts[0] !== "orgs") fail(404, "Unknown API endpoint.");
    if (parts.length === 1) {
      if (method === "GET")
        return { organisations: organisations(user.user_id) };
      if (method === "POST") return newOrg({ id: user.user_id }, b.name);
    }
    const orgId = parts[1],
      role = member(orgId, user.user_id),
      resource = parts[2],
      resourceId = parts[3],
      action = parts[4];
    if (resource === "email-preferences") {
      if (method === "GET")
        return { preferences: campaigns.preferences(orgId, user) };
      if (method === "POST")
        return campaigns.setPreference(orgId, user, b.playerId, b.consented);
    }
    if (resource === "campaigns") {
      requireRole(role);
      if (method === "GET")
        return resourceId
          ? campaigns.preview(orgId, resourceId)
          : { campaigns: campaigns.list(orgId) };
      if (method === "POST") {
        if (!resourceId) return campaigns.draft(orgId, b, user.name);
        if (action === "schedule")
          return campaigns.schedule(orgId, resourceId, b.sendAt, user.name);
        if (action === "cancel")
          return campaigns.cancel(orgId, resourceId, user.name);
      }
      fail(404, "Unknown campaign action.");
    }
    if (resource === "state" && method === "GET") {
      const { org, state } = getState(orgId);
      if (staff.includes(role)) {
        state.refunds = payments.refunds.list(orgId);
        state.campaigns = campaigns.list(orgId);
      }
      const ownPlayerIds = state.players
        .filter((p) => p.email === user.email)
        .map((p) => p.id);
      state.onlineMemberships = payments.billing
        .list(orgId)
        .filter(
          (m) =>
            staff.includes(role) ||
            (role === "player" && ownPlayerIds.includes(m.playerId)),
        );
      return {
        organisation: { id: org.id, name: org.name, role },
        state: publicState(state, role, user.email),
      };
    }
    if (resource === "billing" && method === "POST") {
      if (!staff.includes(role) && role !== "player")
        fail(403, "Only organisers and the linked golfer can manage billing.");
      const { state } = getState(orgId);
      if (action === "checkout") {
        const golfer = find(state.players, b.playerId, "Player");
        if (!staff.includes(role) && golfer.email !== user.email)
          fail(403, "You can only subscribe your own player profile.");
        return payments.billing.checkout(
          orgId,
          resourceId,
          golfer.id,
          user.name,
        );
      }
      const membership = payments.billing.get(orgId, resourceId);
      const golfer = find(state.players, membership.playerId, "Player");
      if (!staff.includes(role) && golfer.email !== user.email)
        fail(403, "This membership belongs to another golfer.");
      if (action === "portal")
        return payments.billing.portal(orgId, resourceId);
      if (action === "cancel")
        return payments.billing.cancel(orgId, resourceId, user.name);
      fail(404, "Unknown billing action.");
    }
    if (resource === "refunds" && method === "POST") {
      requireRole(role);
      if (resourceId && action === "retry")
        return payments.refunds.retry(orgId, resourceId);
      if (resourceId && action === "status")
        return payments.refunds.reconcile(orgId, resourceId);
      if (resourceId) fail(404, "Unknown refund action.");
      return payments.refunds.create(
        orgId,
        text(b.invoiceId, "Invoice"),
        b.amount,
        b.reason,
        user.name,
      );
    }
    if (resource === "accounting-ledger" && method === "GET") {
      requireRole(role);
      const from = date(url.searchParams.get("from")),
        to = date(url.searchParams.get("to"));
      if (from > to) fail(400, "The end date must follow the start date.");
      const { state } = getState(orgId);
      return {
        columns: ledgerColumns,
        rows: accountingLedger(state, payments.refunds.list(orgId), from, to),
      };
    }
    if (
      ["checkout", "checkout-status"].includes(resource) &&
      method === "POST"
    ) {
      const { state } = getState(orgId),
        invoice = find(state.invoices, resourceId, "Invoice"),
        p = find(state.players, invoice.playerId, "Player");
      if (
        !staff.includes(role) &&
        !(role === "player" && p.email === user.email)
      )
        fail(403, "You cannot pay this invoice.");
      if (invoice.billingId)
        fail(
          409,
          "This invoice is managed by recurring billing. Use the billing portal.",
        );
      return resource === "checkout"
        ? payments.checkout(orgId, invoice.id)
        : payments.reconcile(orgId, invoice.id);
    }
    if (resource === "directory" && method === "GET") {
      requireRole(role);
      return {
        members: db
          .prepare(
            "SELECT u.id,u.name,m.role FROM users u JOIN members m ON m.user_id=u.id WHERE m.org_id=? ORDER BY u.name",
          )
          .all(orgId),
      };
    }
    if (resource === "members") {
      requireRole(role, ["admin"]);
      if (method === "GET")
        return {
          members: db
            .prepare(
              "SELECT u.id,u.name,u.email,m.role FROM users u JOIN members m ON m.user_id=u.id WHERE m.org_id=?",
            )
            .all(orgId),
        };
      if (method === "PATCH") {
        return transact(() => {
          const existing = db
            .prepare("SELECT role FROM members WHERE org_id=? AND user_id=?")
            .get(orgId, resourceId);
          if (!existing) fail(404, "Member not found.");
          const next = choice(b.role, roles, "Role");
          if (
            existing.role === "admin" &&
            next !== "admin" &&
            db
              .prepare(
                "SELECT count(*) n FROM members WHERE org_id=? AND role='admin'",
              )
              .get(orgId).n <= 1
          )
            fail(409, "Keep at least one administrator.");
          db.prepare(
            "UPDATE members SET role=? WHERE org_id=? AND user_id=?",
          ).run(next, orgId, resourceId);
          return { ok: true };
        });
      }
    }
    if (resource === "invites" && method === "POST") {
      requireRole(role, ["admin"]);
      const code = secret();
      db.prepare("INSERT INTO invites VALUES(?,?,?,?,?)").run(
        hash(code),
        orgId,
        email(b.email),
        choice(b.role, ["manager", "scorer", "player", "viewer"], "Role"),
        Date.now() + ttl,
      );
      return { code, expires: new Date(Date.now() + ttl).toISOString() };
    }
    if (resource === "leaderboard" && method === "GET") {
      const { state } = getState(orgId);
      const event = find(state.events, resourceId, "Tournament");
      return {
        rows: leaderboard(state, event),
        teamStandings: teamStandings(state, event),
        matches: state.matches.filter((m) => m.eventId === event.id),
        teams: teamLeaderboard(
          state,
          event,
          url.searchParams.get("round") ||
            state.rounds.find((r) => r.eventId === event.id)?.id,
        ),
      };
    }
    if (resource === "export" && method === "GET") {
      requireRole(role);
      const { state } = getState(orgId);
      return {
        players: state.players,
        events: state.events,
        entries: state.entries,
        rounds: state.rounds,
        cards: state.cards,
        teamCards: state.teamCards,
        matches: state.matches,
        handicapRecords: state.handicapRecords,
        bookings: state.bookings,
        invoices: state.invoices,
        audit: state.audit,
      };
    }
    if (method === "GET") fail(404, "Unknown API endpoint.");
    return mutate(
      orgId,
      user,
      role,
      `${method} ${resource}${resourceId ? " " + resourceId : ""}${action ? " " + action : ""}`,
      (s) => {
        const operations = operationsOperation(s, {
          resource,
          resourceId,
          action,
          b,
          role,
          user,
          method,
          orgMembers: db
            .prepare(
              "SELECT u.id,u.name,u.email,m.role FROM users u JOIN members m ON m.user_id=u.id WHERE m.org_id=?",
            )
            .all(orgId),
        });
        if (operations.handled) return operations.result;
        const advanced = competitionOperation(s, {
          resource,
          resourceId,
          action,
          b,
          role,
          user,
          method,
        });
        if (advanced.handled) return advanced.result;
        if (resource === "sharing") {
          requireRole(role);
          const event = find(s.events, b.eventId, "Tournament");
          if (typeof b.enabled !== "boolean")
            fail(400, "Choose whether sharing is enabled.");
          event.publicCode = b.enabled ? event.publicCode || secret() : null;
          return { code: event.publicCode };
        }
        if (resource === "seed") {
          requireRole(role);
          if (s.players.length || s.courses.length || s.events.length)
            fail(
              409,
              "Sample data can only be added to an empty organisation.",
            );
          const course = {
            id: id(),
            name: "Apex Links",
            tee: "White",
            pars: defaultPars,
            indexes: defaultIndexes,
            rating: 72,
            slope: 125,
          };
          s.courses.push(course);
          for (const [name, handicap] of [
            ["Oliver Bennett", 6],
            ["Sophie Clarke", 4],
            ["James Mitchell", 8],
            ["Emma Wilson", 10],
          ])
            s.players.push({
              id: id(),
              name,
              email: "",
              club: "Apex Links",
              handicap,
              memberStatus: "Active",
            });
          const event = {
            id: id(),
            name: "Club Invitational",
            date: new Date().toISOString().slice(0, 10),
            format: "Stableford",
            status: "Open",
            capacity: 72,
            fee: 0,
            description:
              "Sample tournament. Edit this event to make it your own.",
            currency: "GBP",
          };
          s.events.push(event);
          s.rounds.push({
            id: id(),
            eventId: event.id,
            number: 1,
            courseId: course.id,
            date: event.date,
            status: "Open",
            pars: [...course.pars],
            indexes: [...course.indexes],
          });
          s.players.forEach((p) =>
            s.entries.push({
              id: id(),
              eventId: event.id,
              playerId: p.id,
              handicap: p.handicap,
              division: "Open",
              team: "",
              status: "Registered",
            }),
          );
          return { ok: true };
        }
        if (resource === "players") {
          requireRole(role);
          if (method === "POST") {
            const p = {
              id: id(),
              name: text(b.name, "Player name"),
              email: b.email ? email(b.email) : "",
              club: text(b.club || "Independent", "Club"),
              handicap: integer(b.handicap, "Playing handicap", -10, 54),
              memberStatus: choice(
                b.memberStatus || "Active",
                ["Active", "Inactive"],
                "Membership status",
              ),
            };
            if (p.email && s.players.some((x) => x.email === p.email))
              fail(409, "A player already has that email.");
            s.players.push(p);
            return p;
          }
          const p = find(s.players, resourceId, "Player");
          if (method === "PATCH") {
            p.name = text(b.name, "Player name");
            const address = b.email ? email(b.email) : "";
            if (
              address &&
              s.players.some((x) => x.id !== p.id && x.email === address)
            )
              fail(409, "A player already has that email.");
            Object.assign(p, {
              email: address,
              club: text(b.club || "Independent", "Club"),
              handicap: integer(b.handicap, "Handicap", -10, 54),
              memberStatus: choice(
                b.memberStatus,
                ["Active", "Inactive"],
                "Status",
              ),
            });
            return p;
          }
          if (method === "DELETE") {
            if (
              s.entries.some((e) => e.playerId === p.id) ||
              s.bookings.some((e) => e.playerIds.includes(p.id)) ||
              s.subscriptions.some((e) => e.playerId === p.id) ||
              s.invoices.some((e) => e.playerId === p.id)
            )
              fail(
                409,
                "This player has records. Set their status to Inactive instead.",
              );
            s.players = s.players.filter((x) => x.id !== p.id);
            return { ok: true };
          }
        }
        if (resource === "courses") {
          requireRole(role);
          const c = courseData(b);
          if (method === "POST") {
            const row = { id: id(), ...c };
            s.courses.push(row);
            return row;
          }
          if (method === "PATCH") {
            const row = find(s.courses, resourceId, "Course");
            Object.assign(row, c);
            return row;
          }
        }
        if (resource === "events") {
          requireRole(role);
          if (method === "POST") {
            const e = {
              id: id(),
              name: text(b.name, "Tournament name"),
              date: date(b.date),
              format: choice(b.format, formats, "Format"),
              tiebreak: choice(
                b.tiebreak || "Shared",
                ["Shared", "Countback"],
                "Tiebreak",
              ),
              status: "Draft",
              capacity: integer(b.capacity, "Capacity", 1, 500),
              fee: integer(b.fee || 0, "Entry fee in pence", 0, 1000000),
              currency: "GBP",
              description:
                typeof b.description === "string"
                  ? b.description.slice(0, 3000)
                  : "",
            };
            s.events.push(e);
            return e;
          }
          const event = find(s.events, resourceId, "Tournament");
          if (method === "PATCH") {
            const next = choice(
              b.status,
              ["Draft", "Open", "Live", "Completed", "Cancelled"],
              "Status",
            );
            if (next === "Completed") {
              if (event.format === "Match play") {
                const matches = s.matches.filter((m) => m.eventId === event.id),
                  stage = Math.max(0, ...matches.map((m) => m.stage)),
                  last = matches.filter((m) => m.stage === stage);
                if (last.length !== 1 || last[0].status !== "Completed")
                  fail(
                    409,
                    "Complete the knockout final before completing the event.",
                  );
              }
              const rounds = s.rounds.filter((r) => r.eventId === event.id);
              if (!rounds.length || rounds.some((r) => r.status !== "Closed"))
                fail(409, "Close all rounds before completing the tournament.");
            }
            event.name = text(b.name, "Tournament name");
            event.date = date(b.date);
            if (
              b.format !== event.format &&
              s.rounds.some(
                (r) =>
                  r.eventId === event.id &&
                  s.cards.some((c) => c.roundId === r.id),
              )
            )
              fail(409, "The format cannot change after scoring starts.");
            event.format = choice(b.format, formats, "Format");
            const capacity = integer(b.capacity, "Capacity", 1, 500);
            if (
              s.entries.filter(
                (e) => e.eventId === event.id && e.status === "Registered",
              ).length > capacity
            )
              fail(
                409,
                "Capacity cannot be smaller than the registered field.",
              );
            if (b.tiebreak)
              event.tiebreak = choice(
                b.tiebreak,
                ["Shared", "Countback"],
                "Tiebreak",
              );
            Object.assign(event, {
              status: next,
              capacity,
              fee: integer(b.fee || 0, "Fee", 0, 1000000),
              description:
                typeof b.description === "string"
                  ? b.description.slice(0, 3000)
                  : "",
            });
            return event;
          }
        }
        if (resource === "rounds") {
          requireRole(role);
          if (method === "POST") {
            const event = find(s.events, b.eventId, "Tournament");
            if (["Completed", "Cancelled"].includes(event.status))
              fail(409, "This tournament is closed.");
            const course = find(s.courses, b.courseId, "Course");
            const r = {
              id: id(),
              eventId: event.id,
              number: s.rounds.filter((r) => r.eventId === event.id).length + 1,
              courseId: course.id,
              date: date(b.date),
              status: "Open",
              pars: [...course.pars],
              indexes: [...course.indexes],
            };
            s.rounds.push(r);
            return r;
          }
          const r = find(s.rounds, resourceId, "Round");
          if (method === "PATCH") {
            const event = find(s.events, r.eventId, "Tournament");
            if (["Completed", "Cancelled"].includes(event.status))
              fail(409, "Reopen the tournament before editing rounds.");
            const status = choice(b.status, ["Open", "Closed"], "Round status");
            if (status === "Closed" && event.format === "Match play") {
              const matches = s.matches.filter((m) => m.roundId === r.id);
              if (
                !matches.length ||
                matches.some((m) => m.status !== "Completed")
              )
                fail(409, "Finalise every match before closing this round.");
              r.status = status;
              return r;
            }
            if (status === "Closed" && teamFormats.includes(event.format)) {
              const entries = s.entries.filter(
                (e) => e.eventId === event.id && e.status === "Registered",
              );
              if (!entries.length || entries.some((e) => !e.team))
                fail(409, "Assign every player to a team.");
              for (const team of new Set(entries.map((e) => e.team)))
                if (
                  !s.teamCards.some(
                    (c) =>
                      c.roundId === r.id &&
                      c.team === team &&
                      c.status === "Attested",
                  )
                )
                  fail(409, "Attest every team scorecard before closing.");
              r.status = status;
              return r;
            }
            if (status === "Closed") {
              const entries = s.entries.filter(
                (e) => e.eventId === r.eventId && e.status === "Registered",
              );
              if (!entries.length)
                fail(409, "Register players before closing a round.");
              if (
                entries.some(
                  (e) =>
                    !s.cards.some(
                      (c) =>
                        c.roundId === r.id &&
                        c.playerId === e.playerId &&
                        c.status === "Attested",
                    ),
                )
              )
                fail(
                  409,
                  "Every registered player needs an attested scorecard before closing.",
                );
            }
            r.status = status;
            return r;
          }
        }
        if (resource === "entries") {
          if (method === "POST") {
            const event = find(s.events, b.eventId, "Tournament"),
              p = find(s.players, b.playerId, "Player");
            if (role === "player") {
              if (p.email !== user.email)
                fail(403, "You can only register your own player profile.");
              if (event.status !== "Open")
                fail(409, "Registration is not open.");
            } else requireRole(role);
            if (!["Draft", "Open"].includes(event.status))
              fail(409, "Registration is closed.");
            if (
              s.entries.some(
                (e) =>
                  e.eventId === event.id &&
                  e.playerId === p.id &&
                  ["Registered", "Waitlisted"].includes(e.status),
              )
            )
              fail(409, "Player is already registered or waitlisted.");
            const full =
              s.entries.filter(
                (e) => e.eventId === event.id && e.status === "Registered",
              ).length >= event.capacity;
            if (full && !b.waitlist)
              fail(409, "Tournament is full. Choose the waiting list instead.");
            const row = {
              id: id(),
              eventId: event.id,
              playerId: p.id,
              handicap: integer(
                staff.includes(role) ? (b.handicap ?? p.handicap) : p.handicap,
                "Playing handicap",
                -10,
                54,
              ),
              division: staff.includes(role)
                ? text(b.division || "Open", "Division", 60)
                : "Open",
              team:
                staff.includes(role) && typeof b.team === "string"
                  ? b.team.slice(0, 80)
                  : "",
              status: full ? "Waitlisted" : "Registered",
              created: new Date().toISOString(),
            };
            s.entries.push(row);
            if (event.fee && !full) {
              s.invoices.push({
                id: id(),
                playerId: p.id,
                eventId: event.id,
                description: event.name + " entry",
                amount: event.fee,
                currency: "GBP",
                status: "Unpaid",
                reference: "",
                created: new Date().toISOString(),
              });
            }
            return row;
          }
          requireRole(role);
          const entry = find(s.entries, resourceId, "Entry");
          if (method === "PATCH") {
            const event = find(s.events, entry.eventId, "Tournament");
            if (["Completed", "Cancelled"].includes(event.status))
              fail(409, "Tournament is closed.");
            if (
              s.cards.some(
                (c) =>
                  c.playerId === entry.playerId &&
                  s.rounds.some(
                    (r) => r.id === c.roundId && r.eventId === entry.eventId,
                  ),
              )
            )
              fail(409, "Entry details are locked once scoring starts.");
            entry.division = text(b.division || "Open", "Division", 60);
            entry.team = typeof b.team === "string" ? b.team.slice(0, 80) : "";
            entry.handicap = integer(b.handicap, "Handicap", -10, 54);
            return entry;
          }
          if (method === "DELETE") {
            if (
              s.cards.some(
                (c) =>
                  c.playerId === entry.playerId &&
                  s.rounds.some(
                    (r) => r.id === c.roundId && r.eventId === entry.eventId,
                  ),
              )
            )
              fail(409, "A scored entry cannot be removed.");
            if (entry.status === "Registered")
              competitionOperation(s, {
                resource: "entry-status",
                resourceId: entry.id,
                b: {
                  status: "Withdrawn",
                  reason: "Entry removed by organiser",
                },
                role,
                user,
                method: "POST",
              });
            s.entries = s.entries.filter((e) => e.id !== entry.id);
            s.teeTimes.forEach((t) => {
              if (
                s.rounds.some(
                  (r) => r.id === t.roundId && r.eventId === entry.eventId,
                )
              )
                t.playerIds = t.playerIds.filter((x) => x !== entry.playerId);
            });
            return { ok: true };
          }
        }
        if (resource === "pairings") {
          requireRole(role);
          const round = find(s.rounds, b.roundId, "Round");
          if (round.status !== "Open") fail(409, "Round is closed.");
          const players = s.entries.filter(
            (e) => e.eventId === round.eventId && e.status === "Registered",
          );
          if (!players.length) fail(400, "Register players first.");
          if (s.cards.some((c) => c.roundId === round.id))
            fail(409, "Pairings are locked once scoring starts.");
          const order = b.order;
          const groupSize = integer(b.groupSize, "Group size", 2, 4),
            interval = integer(b.interval, "Tee interval", 5, 30),
            start = timestamp(b.start);
          choice(
            b.order,
            ["Name", "Handicap", "Previous round"],
            "Pairing order",
          );
          if (b.order === "Previous round") {
            const rows = leaderboard(
              s,
              find(s.events, round.eventId, "Tournament"),
            );
            players.sort(
              (a, b) =>
                rows.findIndex((r) => r.playerId === b.playerId) -
                rows.findIndex((r) => r.playerId === a.playerId),
            );
          } else
            players.sort((a, b) =>
              order === "Handicap"
                ? a.handicap - b.handicap
                : find(s.players, a.playerId, "Player").name.localeCompare(
                    find(s.players, b.playerId, "Player").name,
                  ),
            );
          s.teeTimes = s.teeTimes.filter((t) => t.roundId !== round.id);
          for (let i = 0; i < players.length; i += groupSize) {
            const slot = Date.parse(start) + (i / groupSize) * interval * 60000;
            if (
              s.bookings.some(
                (x) =>
                  x.status === "Confirmed" &&
                  x.courseId === round.courseId &&
                  Date.parse(x.start) < slot + interval * 60000 &&
                  Date.parse(x.start) + x.duration * 60000 > slot,
              )
            )
              fail(409, "A generated tee time overlaps an existing booking.");
            if (
              s.teeTimes.some(
                (t) =>
                  s.rounds.some(
                    (r) => r.id === t.roundId && r.courseId === round.courseId,
                  ) && Math.abs(Date.parse(t.start) - slot) < interval * 60000,
              )
            )
              fail(409, "A generated tee time overlaps another tournament.");
            s.teeTimes.push({
              id: id(),
              roundId: round.id,
              start: new Date(
                Date.parse(start) + (i / groupSize) * interval * 60000,
              ).toISOString(),
              hole: 1,
              playerIds: players.slice(i, i + groupSize).map((e) => e.playerId),
            });
          }
          return { ok: true };
        }
        if (resource === "tee-times") {
          requireRole(role);
          const t = find(s.teeTimes, resourceId, "Tee time");
          const round = find(s.rounds, t.roundId, "Round");
          if (
            round.status !== "Open" ||
            s.cards.some((c) => c.roundId === round.id)
          )
            fail(409, "Tee sheet is locked after scoring starts.");
          const next = timestamp(b.start);
          if (
            s.bookings.some(
              (x) =>
                x.status === "Confirmed" &&
                x.courseId === round.courseId &&
                Date.parse(x.start) < Date.parse(next) + 10 * 60000 &&
                Date.parse(x.start) + x.duration * 60000 > Date.parse(next),
            )
          )
            fail(409, "This time overlaps a tee booking.");
          if (
            s.teeTimes.some(
              (x) =>
                x.id !== t.id &&
                s.rounds.some(
                  (r) => r.id === x.roundId && r.courseId === round.courseId,
                ) &&
                Math.abs(Date.parse(x.start) - Date.parse(next)) < 5 * 60000,
            )
          )
            fail(409, "This time overlaps another tee time.");
          t.start = next;
          t.hole = integer(b.hole, "Starting hole", 1, 18);
          return t;
        }
        if (resource === "cards") {
          const round = find(s.rounds, b.roundId, "Round"),
            event = find(s.events, round.eventId, "Tournament"),
            player = find(s.players, b.playerId, "Player");
          if (
            round.status !== "Open" ||
            !["Open", "Live"].includes(event.status)
          )
            fail(409, "Scoring is closed.");
          if (teamFormats.includes(event.format))
            fail(400, "Use the shared team card for this format.");
          if (
            event.format === "Match play" &&
            !s.matches.some(
              (m) =>
                m.roundId === round.id &&
                [m.playerA, m.playerB].includes(player.id),
            )
          )
            fail(409, "Generate this player’s match before scoring.");
          if (
            event.format === "Match play" &&
            s.matches.some(
              (m) =>
                m.roundId === round.id &&
                [m.playerA, m.playerB].includes(player.id) &&
                m.playoff?.length,
            )
          )
            fail(
              409,
              "Regulation cards are locked after playoff scoring begins. An organiser must reopen the match to correct them.",
            );
          const assigned = s.markerAssignments.some(
            (m) =>
              m.roundId === round.id &&
              m.playerId === player.id &&
              s.players.find((p) => p.id === m.markerPlayerId)?.email ===
                user.email,
          );
          if (role === "player" && player.email !== user.email && !assigned)
            fail(403, "You can only enter your own score.");
          if (role !== "player") requireRole(role, scoringRoles);
          if (
            !s.entries.some(
              (e) =>
                e.playerId === player.id &&
                e.eventId === event.id &&
                e.status === "Registered",
            )
          )
            fail(400, "Player is not registered for this tournament.");
          let c = s.cards.find(
            (c) => c.roundId === round.id && c.playerId === player.id,
          );
          if ((c?.version || 0) !== b.version)
            fail(
              409,
              "Another scorer updated this card. Reload it before saving.",
            );
          if (c?.status === "Attested" && action !== "unlock")
            fail(
              409,
              "The card is attested. An organiser must unlock it first.",
            );
          if (action === "unlock") {
            requireRole(role);
            if (!c) fail(404, "Card not found.");
            c.status = "Draft";
            c.version++;
            c.updated = new Date().toISOString();
            return c;
          }
          if (action === "attest") {
            if (!(role === "player" && assigned))
              requireRole(role, scoringRoles);
            if (event.format === "Match play")
              fail(
                409,
                "An organiser must finalise the match to attest partial match-play cards.",
              );
            if (!c || c.scores.some((n) => n === null))
              fail(409, "Complete all 18 holes before attesting.");
            if (
              c.updatedBy === user.user_id &&
              ["scorer", "player"].includes(role)
            )
              fail(403, "A different scorer must attest this card.");
            c.status = "Attested";
            c.attestedBy = user.name;
            c.version++;
            return c;
          }
          if (
            !Array.isArray(b.scores) ||
            b.scores.length !== 18 ||
            b.scores.some(
              (n) => n !== null && (!Number.isInteger(n) || n < 1 || n > 30),
            )
          )
            fail(
              400,
              "Provide 18 scores, each blank or a whole number from 1 to 30.",
            );
          if (!c) {
            c = {
              id: id(),
              roundId: round.id,
              playerId: player.id,
              version: 0,
            };
            s.cards.push(c);
          }
          Object.assign(c, {
            scores: b.scores,
            status: b.submit ? "Submitted" : "Draft",
            version: c.version + 1,
            updated: new Date().toISOString(),
            updatedBy: user.user_id,
          });
          if (
            b.submit &&
            event.format !== "Match play" &&
            c.scores.some((n) => n === null)
          )
            fail(400, "Complete every hole before submitting.");
          return c;
        }
        if (resource === "bookings") {
          if (method === "POST") {
            const course = find(s.courses, b.courseId, "Course");
            if (
              !Array.isArray(b.playerIds) ||
              b.playerIds.length < 1 ||
              b.playerIds.length > 4 ||
              new Set(b.playerIds).size !== b.playerIds.length
            )
              fail(400, "Choose one to four different players.");
            const players = b.playerIds.map((p) =>
              find(s.players, p, "Player"),
            );
            if (
              role === "player" &&
              !players.some((p) => p.email === user.email)
            )
              fail(403, "Your booking must include your player profile.");
            if (role !== "player") requireRole(role);
            const start = timestamp(b.start),
              duration = integer(
                s.bookingRules.find((r) => r.courseId === course.id)
                  ?.interval ||
                  b.duration ||
                  10,
                "Tee interval",
                5,
                30,
              );
            validateBookingRules(s, course.id, start, duration);
            if (Date.parse(start) < Date.now())
              fail(400, "Choose a future tee time.");
            if (
              s.bookings.some(
                (x) =>
                  x.status === "Confirmed" &&
                  x.courseId === course.id &&
                  Date.parse(x.start) < Date.parse(start) + duration * 60000 &&
                  Date.parse(x.start) + x.duration * 60000 > Date.parse(start),
              )
            )
              fail(409, "This tee slot has already been booked.");
            if (
              s.teeTimes.some(
                (t) =>
                  s.rounds.some(
                    (r) => r.id === t.roundId && r.courseId === course.id,
                  ) &&
                  (t.mode === "Shotgun"
                    ? Date.parse(start) >=
                        Date.parse(t.start) - duration * 60000 &&
                      Date.parse(start) <
                        Date.parse(t.start) +
                          18 *
                            (s.rounds.find((r) => r.id === t.roundId)
                              ?.minutesPerHole || 14) *
                            60000
                    : Math.abs(Date.parse(t.start) - Date.parse(start)) <
                      duration * 60000),
              )
            )
              fail(409, "This slot is reserved for a tournament.");
            const row = {
              id: id(),
              courseId: course.id,
              playerIds: b.playerIds,
              start,
              duration,
              status: "Confirmed",
              createdBy: user.user_id,
            };
            s.bookings.push(row);
            return row;
          }
          const booking = find(s.bookings, resourceId, "Booking");
          if (!staff.includes(role) && booking.createdBy !== user.user_id)
            fail(403, "You cannot cancel this booking.");
          booking.status = "Cancelled";
          return booking;
        }
        if (resource === "plans") {
          requireRole(role);
          const row = {
            id: id(),
            name: text(b.name, "Plan name"),
            amount: integer(b.amount, "Annual price in pence", 0, 10000000),
            currency: "GBP",
          };
          s.plans.push(row);
          return row;
        }
        if (resource === "subscriptions") {
          requireRole(role);
          if (method === "POST") {
            if (payments.billing.hasPending(orgId, b.playerId))
              fail(
                409,
                "Online membership billing already exists for this golfer. Manage it before adding a manual membership.",
              );
            const p = find(s.players, b.playerId, "Player"),
              plan = find(s.plans, b.planId, "Plan");
            const start = date(b.start),
              end = date(b.end);
            if (end <= start)
              fail(400, "End date must be after the start date.");
            if (
              s.subscriptions.some(
                (x) =>
                  x.playerId === p.id &&
                  x.status === "Active" &&
                  x.start <= end &&
                  x.end >= start,
              )
            )
              fail(
                409,
                "This player already has an overlapping active membership.",
              );
            const row = {
              id: id(),
              playerId: p.id,
              planId: plan.id,
              start,
              end,
              status: "Active",
            };
            s.subscriptions.push(row);
            s.invoices.push({
              id: id(),
              playerId: p.id,
              description: plan.name + " membership",
              amount: plan.amount,
              currency: "GBP",
              status: plan.amount ? "Unpaid" : "Paid",
              reference: "",
              created: new Date().toISOString(),
            });
            return row;
          }
          const row = find(s.subscriptions, resourceId, "Membership");
          if (row.billingId)
            fail(
              409,
              "Use online membership billing to cancel renewal. Paid periods are retained.",
            );
          row.status = "Cancelled";
          return row;
        }
        if (resource === "invoices") {
          requireRole(role);
          if (
            db
              .prepare(
                "SELECT invoice_id FROM payments WHERE org_id=? AND invoice_id=? AND status IN ('Open','Creating')",
              )
              .get(orgId, resourceId)
          )
            fail(
              409,
              "An online checkout is active. Use Check payment status to verify expiry before recording an external payment or voiding.",
            );
          const row = find(s.invoices, resourceId, "Invoice");
          if (row.billingId)
            fail(
              409,
              "Stripe manages this recurring invoice. Use the billing portal.",
            );
          if (action === "paid") {
            if (row.status !== "Unpaid")
              fail(409, "Only unpaid invoices can be settled.");
            row.status = "Paid";
            row.reference = text(
              b.reference,
              "External payment reference",
              200,
            );
            row.paidAt = new Date().toISOString();
            row.recordedBy = user.name;
            return row;
          }
          if (action === "void") {
            if (row.status !== "Unpaid")
              fail(
                409,
                "Paid invoices cannot be voided; record refunds in your payment system.",
              );
            row.status = "Void";
            return row;
          }
        }
        if (resource === "announcements") {
          requireRole(role);
          if (method === "POST") {
            const row = {
              id: id(),
              title: text(b.title, "Title"),
              body: text(b.body, "Message", 3000),
              created: new Date().toISOString(),
              author: user.name,
            };
            s.announcements.unshift(row);
            return row;
          }
          if (method === "DELETE") {
            find(s.announcements, resourceId, "Announcement");
            s.announcements = s.announcements.filter(
              (a) => a.id !== resourceId,
            );
            return { ok: true };
          }
        }
        fail(404, "Unknown operation.");
      },
    );
  };
}
