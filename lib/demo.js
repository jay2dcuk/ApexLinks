import { scryptSync, randomUUID, randomBytes } from "node:crypto";
import { emptyState } from "./store.js";
import { defaultPars, defaultIndexes } from "./scoring.js";
export const demoUsers = [
  {
    email: "admin@demo.apexlinks.test",
    name: "Demo Multi-club Admin",
    role: "admin",
    both: true,
  },
  {
    email: "club@demo.apexlinks.test",
    name: "Demo Club Administrator",
    role: "admin",
  },
  {
    email: "organiser@demo.apexlinks.test",
    name: "Demo Organiser",
    role: "manager",
  },
  { email: "scorer@demo.apexlinks.test", name: "Demo Scorer", role: "scorer" },
  { email: "player@demo.apexlinks.test", name: "Demo Player", role: "player" },
  {
    email: "player2@demo.apexlinks.test",
    name: "Demo Player Two",
    role: "player",
  },
  {
    email: "viewer@demo.apexlinks.test",
    name: "Demo Read-only Viewer",
    role: "viewer",
  },
];
export function seedDemoAccounts(db, password) {
  if (
    typeof password !== "string" ||
    password.length < 16 ||
    password.length > 128
  )
    throw Error(
      "DEMO_PASSWORD must have 16–128 characters. Demo accounts were not created.",
    );
  if (db.prepare("SELECT value FROM settings WHERE key='demo_disabled'").get())
    return { disabled: true, accounts: [], organisationIds: [] };
  const createdAccounts = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db
      .prepare("SELECT value FROM settings WHERE key='demo_organisations'")
      .get();
    let orgIds = existing ? JSON.parse(existing.value) : [];
    if (!orgIds.length) {
      for (const name of ["Apex Demo Club", "Apex Demo Society"]) {
        const orgId = randomUUID(),
          s = emptyState(),
          course = {
            id: randomUUID(),
            name: name + " Course",
            tee: "White",
            pars: defaultPars,
            indexes: defaultIndexes,
            rating: 72,
            slope: 125,
          };
        s.courses.push(course);
        s.events.push({
          id: randomUUID(),
          name: "Demo Invitational",
          date: new Date().toISOString().slice(0, 10),
          format: "Stableford",
          status: "Open",
          capacity: 32,
          fee: 0,
          description: "Fictional data for role testing only.",
          currency: "GBP",
        });
        s.rounds.push({
          id: randomUUID(),
          eventId: s.events[0].id,
          number: 1,
          courseId: course.id,
          date: s.events[0].date,
          status: "Open",
          pars: defaultPars,
          indexes: defaultIndexes,
        });
        db.prepare("INSERT INTO orgs VALUES(?,?,?)").run(
          orgId,
          name,
          JSON.stringify(s),
        );
        orgIds.push(orgId);
      }
      db.prepare("INSERT INTO settings VALUES('demo_organisations',?)").run(
        JSON.stringify(orgIds),
      );
    }
    for (const account of demoUsers) {
      let user = db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(account.email);
      if (
        user &&
        !db
          .prepare("SELECT user_id FROM demo_users WHERE user_id=?")
          .get(user.id)
      )
        throw Error(
          "A demo email belongs to an unmanaged account. No accounts were changed.",
        );
      if (!user) {
        createdAccounts.push(account.email);
        const salt = randomBytes(32).toString("hex");
        user = { id: randomUUID() };
        db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
          user.id,
          account.email,
          account.name,
          salt + ":" + scryptSync(password, salt, 64).toString("hex"),
          new Date().toISOString(),
        );
        db.prepare("INSERT INTO demo_users VALUES(?)").run(user.id);
      }
      for (const orgId of account.both ? orgIds : [orgIds[0]])
        db.prepare(
          "INSERT INTO members VALUES(?,?,?) ON CONFLICT DO NOTHING",
        ).run(orgId, user.id, account.role);
    }
    const org = db.prepare("SELECT state FROM orgs WHERE id=?").get(orgIds[0]),
      s = { ...emptyState(), ...JSON.parse(org.state) };
    for (const [index, account] of demoUsers
      .filter((u) => u.role === "player")
      .entries()) {
      if (s.players.some((p) => p.email === account.email)) continue;
      const p = {
        id: randomUUID(),
        name: account.name,
        email: account.email,
        club: "Apex Demo Club",
        handicap: 12 + index * 6,
        memberStatus: "Active",
      };
      s.players.push(p);
      s.entries.push({
        id: randomUUID(),
        eventId: s.events[0].id,
        playerId: p.id,
        handicap: p.handicap,
        division: "Open",
        team: index ? "Blue" : "Green",
        status: "Registered",
      });
    }
    db.prepare("UPDATE orgs SET state=? WHERE id=?").run(
      JSON.stringify(s),
      orgIds[0],
    );
    db.exec("COMMIT");
    return {
      createdAccounts,
      accounts: demoUsers.map(({ email, name, role }) => ({
        email,
        name,
        role,
      })),
      organisationIds: orgIds,
    };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function disableDemoAccounts(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const users = db.prepare("SELECT user_id FROM demo_users").all();
    for (const { user_id } of users) {
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user_id);
      db.prepare("DELETE FROM members WHERE user_id=?").run(user_id);
      const salt = randomBytes(32).toString("hex");
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        salt + ":" + scryptSync(randomBytes(32), salt, 64).toString("hex"),
        user_id,
      );
    }
    db.prepare(
      "INSERT INTO settings VALUES('demo_disabled','true') ON CONFLICT(key) DO UPDATE SET value='true'",
    ).run();
    db.exec("COMMIT");
    return users.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
