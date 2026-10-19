import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function openStore(filename) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS payments(org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,attempt TEXT NOT NULL,status TEXT NOT NULL,url TEXT NOT NULL,expires INTEGER NOT NULL,session_id TEXT NOT NULL,PRIMARY KEY(org_id,invoice_id));
CREATE TABLE IF NOT EXISTS webhooks(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS demo_users(user_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS recovery(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orgs(id TEXT PRIMARY KEY,name TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(org_id TEXT NOT NULL REFERENCES orgs(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(org_id,user_id));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES orgs(id),email TEXT NOT NULL,role TEXT NOT NULL,expires INTEGER NOT NULL);`);
  return db;
}
export function emptyState() {
  return {
    version: 0,
    templates: [],
    markerAssignments: [],
    roundTees: [],
    checkpoints: [],
    incidents: [],
    tasks: [],
    messages: [],
    receipts: [],
    reportViews: [],
    players: [],
    courses: [],
    events: [],
    rounds: [],
    entries: [],
    cards: [],
    teamCards: [],
    matches: [],
    handicapRecords: [],
    bookingRules: [],
    teeTimes: [],
    bookings: [],
    plans: [],
    subscriptions: [],
    invoices: [],
    announcements: [],
    audit: [],
  };
}
