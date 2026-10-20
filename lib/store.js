import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function openStore(filename) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS payments(org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,attempt TEXT NOT NULL,status TEXT NOT NULL,url TEXT NOT NULL,expires INTEGER NOT NULL,session_id TEXT NOT NULL,PRIMARY KEY(org_id,invoice_id));
CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES orgs(id),invoice_id TEXT NOT NULL,amount INTEGER NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT NOT NULL,payment_intent TEXT NOT NULL,actor TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhooks(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS course_directory_queries(query TEXT PRIMARY KEY,payload TEXT NOT NULL,fetched INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS course_venues(id TEXT PRIMARY KEY,name TEXT NOT NULL,country TEXT NOT NULL,payload TEXT NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS demo_users(user_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS recovery(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS verification_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS verified_emails(user_id TEXT PRIMARY KEY REFERENCES users(id),email TEXT NOT NULL,verified_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS email_consents(org_id TEXT NOT NULL REFERENCES orgs(id),player_id TEXT NOT NULL,email TEXT NOT NULL,consented INTEGER NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(org_id,player_id));
CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES orgs(id),subject TEXT NOT NULL,body TEXT NOT NULL,event_id TEXT NOT NULL,status TEXT NOT NULL,scheduled INTEGER NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_recipients(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),player_id TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT NOT NULL,unsubscribe_token TEXT NOT NULL,unsubscribe_hash TEXT UNIQUE NOT NULL,attempts INTEGER NOT NULL,first_attempt INTEGER NOT NULL,retry_at INTEGER NOT NULL,lease INTEGER NOT NULL,UNIQUE(campaign_id,email));
CREATE TABLE IF NOT EXISTS billing(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES orgs(id),player_id TEXT NOT NULL,plan_id TEXT NOT NULL,plan_name TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,attempt TEXT NOT NULL,created INTEGER NOT NULL,session_id TEXT NOT NULL,url TEXT NOT NULL,expires INTEGER NOT NULL,customer_id TEXT NOT NULL,subscription_id TEXT UNIQUE,cancel_at_end INTEGER NOT NULL,event_time INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS billing_invoices(provider_id TEXT PRIMARY KEY,billing_id TEXT NOT NULL REFERENCES billing(id),invoice_id TEXT NOT NULL,period_start INTEGER NOT NULL,period_end INTEGER NOT NULL);
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
    seasons: [],
    seasonEvents: [],
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
