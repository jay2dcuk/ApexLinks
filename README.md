# ApexLinks

Original golf and club management software for clubs, societies, and multi-organisation operators. This release replaces the browser-only demonstration with authenticated accounts, server-side SQLite storage, and shared tournament workflows. It is not a complete Golf Genius replacement; the remaining capabilities are listed below.

## Start locally

Requires **Node.js 24**. The app has no third-party runtime dependencies.

```sh
npm test
npm start
```

The server uses port 3000 by default; `PORT` overrides it. `npm run dev` restarts the server on changes; refresh the browser after frontend changes. Open the app, choose **Create an account**, and create your organisation. No default accounts are enabled. Optional fictional demo users can be enabled explicitly as described below. Add your course and player records or choose **Load sample tournament** in an empty workspace.

## Implemented workflows

- **Accounts:** registration, login/logout, password change, scrypt password hashing, database-backed HttpOnly sessions, CSRF checks, authentication throttling, and input validation.
- **Organisations:** separate workspaces, administrator/manager/scorer/player/viewer roles, expiring email-bound invitation codes, role management, and protection against removing the last administrator.
- **Courses:** configurable 18-hole pars, unique stroke indexes, tee names, rating, and slope. Each round captures its own par/index snapshot. Ratings and slope are stored for reference; playing handicaps are entered manually.
- **Players:** names, clubs, account emails, manually entered playing handicaps including plus handicaps, and active/inactive status.
- **Tournaments:** dates, descriptions, fees, capacity, Draft/Open/Live/Completed/Cancelled status, event-specific fields, registration, divisions, teams, multiple rounds and courses. Entry fees create unpaid invoices, not card charges.
- **Pairings:** groups of two to four ordered by name, handicap, or prior standings; tee intervals, starting holes, editable tee times, and printable tee sheets. Ordinary booking conflicts are checked in both directions.
- **Scoring:** round-specific 18-hole cards, partial drafts, submission, organiser/scorer attestation, organiser unlock, closed-round protection, and optimistic version checks to prevent lost concurrent changes. Players may enter only their own linked profile's scores. Scorers cannot attest a card they entered; organisers can, with an audit record.
- **Leaderboards:** gross stroke, net stroke and Stableford; division tables; tied positions; team net best ball per round; CSV export. Shared screens refresh every ten seconds. Organisers can enable a public read-only spectator link and revoke it. Public links reveal player names and scores, never emails, billing, or audit history.
- **Bookings:** one to four golfers, timezone-aware timestamps, duplicate and overlapping tee-slot checks, tournament reservations, and cancellations. Times display in each viewer's browser timezone.
- **Memberships:** annual plan prices, dated memberships, overlapping membership prevention, cancellations, and invoicing. These are club records, not recurring card subscriptions. Players can view their own membership and invoice records.
- **Finance:** paid/outstanding invoice totals, external payment references, and voiding of unpaid invoices. Stripe Checkout is available after secure provider configuration; otherwise collect money separately and record the external reference. Cancelling an entry or membership does not automatically void/refund its invoice.
- **Club operations:** shared noticeboard, player participation and scoring reports, full records export for organisers, and up to 1,000 recent mutation audit records per organisation.

Members sign in using their invited email. To enable player registration and scoring, an organiser must create a player profile with the same email and register it for the event. Players can self-register their linked profile while an event is Open. Organisers can change playing handicaps, teams, and divisions before a player starts scoring.

Before completing an event, attest all registered players' cards and close every round. Submitted scores remain editable until attested. Reopen the tournament and round before making post-competition corrections. Gross/net standings compare totals and should be treated as provisional when players have played different numbers of holes. By default ties share a position. Organisers may select last-9/6/3/1 countback on the final completed round for individual stroke, net stroke or Stableford events. Official handicap verification is not connected.

## Render deployment and durable storage

The existing Render Web Service can deploy this repository with:

- Branch: `main`
- Build command: `npm test`
- Start command: `npm start`
- Health check: `/api/health`
- Environment: `NODE_VERSION=24.19.0`, `NODE_ENV=production`

**Render's free service does not retain SQLite files across deployments/restarts.** The app displays a warning there. Before entering real accounts or club records, choose a Render service plan that supports persistent disks, attach a disk at `/var/data`, and set:

```text
DATABASE_PATH=/var/data/apexlinks.sqlite
```

Changing to a paid plan is a user action; the included `render.yaml` does not buy or enable a paid plan. It preserves the existing free service option for evaluation. Configure the disk and environment variables in Render, then redeploy. Existing local database files are not automatically moved when `DATABASE_PATH` changes. If real data was entered on temporary storage, preserve/export it before any deployment or path change. Organisation exports are not full database backups: they omit user password hashes and sessions.

SQLite uses WAL transactions and is intended for a single app instance with its own mounted disk. Do not horizontally scale this version using independent disks. Use PostgreSQL and an appropriate migration before a multi-instance deployment. Arrange encrypted off-site backups and verify restoration before production use. Keep the database and its WAL/SHM files out of Git. For a live consistent backup use SQLite's online backup facilities, rather than copying only the main file while the server is writing.

The old browser demo's localStorage is not silently imported into the new database. It remains on the original browser until cleared. New accounts create empty organisations.

Production sessions use Secure cookies when `NODE_ENV=production`; use HTTPS. The application intentionally restricts framing now that it has authenticated club data. Open the Render URL directly rather than through this chat's visualization panel.

## Verification

`npm test` runs scoring tests plus an HTTP integration lifecycle covering accounts, CSRF/origin rejection, organisation isolation, courses, registration, bookings and pairing conflicts, limited invitations, independent scorer permissions, stale score versions, attestation, round closure, memberships, payment records, public leaderboard revocation, audit records, and database/session restoration after restart. Each test uses a disposable database.

A reproducible Chromium smoke test is available with optional development tooling:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
```

Use `BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser` for a system Chromium. The smoke test starts its own temporary server and database and exercises account creation, pairings, scoring/attestation, export, memberships, billing records, bookings, invitations, mobile layout, and session restoration. It does not use a live club database or process card payments.

## Version 0.3 additions

- Seeded singles-net knockout match play, staged bracket advancement, early results, and organiser-recorded playoff/concession decisions. Brackets accept 2, 4, 8, 16, 32 or 64 entrants; automatic byes and extra-hole score entry are not implemented.
- Scramble and foursomes share one card per team, with an explicitly entered team playing handicap, version checks, attestation and net team standings. The app records scores; it does not validate on-course shot selection/alternation or calculate federation-specific team allowances.
- Individual final-round countback (last 9/6/3/1); withdrawal, disqualification and no-return status with reasons. Those statuses are excluded from winning positions. Waiting-list players are admitted in entry order when a place is released before play.
- Offline score queues for an **already loaded** card. Network failures save the draft to that user's device; Review queued scores offers explicit sync/discard. Conflicts retain local scores for human review. This is not a fully offline PWA: initial page loading and login still require a connection, and device/browser storage must remain available.
- Course-local booking hours, slot intervals, closed weekdays and holiday dates. Rules use an IANA timezone and account for daylight saving.
- Supplied handicap records, atomic JSON import, an allowance calculation, and attested-round exports. Federation records remain labelled unverified until approved provider integration is built.
- Optional Stripe card checkout with idempotency, signed payment webhooks, and expiry reconciliation; optional Resend single-use password recovery. Tests simulate provider responses; no live payments or emails were sent.

Run `npm run test:browser:advanced` with the same optional Playwright tooling to exercise all seven demo logins, multi-club permissions, scramble cards, match-play results, offline queue/sync and the handicap-record screen.

## Demo accounts on Render

Use **a persistent disk** before creating accounts you want to retain. In Render → Environment add:

```text
ENABLE_DEMO_ACCOUNTS=true
DEMO_PASSWORD=<a test-only password of 16–128 characters>
```

Enter the password securely in Render; it is not hardcoded or stored in Git. On first startup, the app creates fictional Apex Demo Club and Apex Demo Society workspaces. Existing accounts, passwords and records are never overwritten. Reserved demo emails belonging to unrelated accounts cause setup to abort rather than taking them over. Changing `DEMO_PASSWORD` later does not reset existing demo passwords.

| Username (email)              | Demo role                | Scope                     |
| ----------------------------- | ------------------------ | ------------------------- |
| admin@demo.apexlinks.test     | Multi-club administrator | Both demo workspaces      |
| club@demo.apexlinks.test      | Club administrator       | Demo club                 |
| organiser@demo.apexlinks.test | Organiser / manager      | Demo club                 |
| scorer@demo.apexlinks.test    | Scorer                   | Demo club                 |
| player@demo.apexlinks.test    | Player                   | Linked demo player        |
| player2@demo.apexlinks.test   | Second player            | Linked second demo player |
| viewer@demo.apexlinks.test    | Read-only viewer         | Demo club                 |

All newly created demo accounts initially use the password you supplied. The multi-club administrator is an administrator of those two workspaces, **not** a global superuser over unrelated clubs. Demo passwords must not be reused for real accounts.

For local role testing, run `npm run seed:demo -- --show-password` to generate accounts and display a generated password for newly created users, or supply `DEMO_PASSWORD` securely and run `npm run seed:demo`. To permanently disable demo users, remove the Render enable/password variables and run `npm run demo:disable` against the same database. This revokes their sessions, removes their workspace memberships and disables their passwords while preserving club records. Normal startup seeding cannot silently re-enable disabled users.

## Provider configuration and remaining work

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for Stripe, Resend, England Golf/MyEG and USGA/GHIN access steps, privacy requirements and supported import formats. Card and email adapters require your own provider accounts and secure Render variables. No live MyEG/USGA connection, automatic handicap sync or official score posting exists yet; proprietary endpoints and access rights are not invented.

Remaining product gaps include automatic knockout byes, extra-hole scorecards, full offline app loading, multiple tee sets within one round, automated shotgun assignment, dedicated marker assignment, a custom report designer, recurring billing, refunds, email campaigns/SMS/push, email verification, accounting sync and approved federation API adapters. Team ties currently remain shared; individual countback does not apply to the shared-team leaderboard. Increasing event capacity alone does not automatically promote waiting-list players: use their entry status deliberately, or release a registered entry before play.

Before production launch, configure and verify real provider services, backups/restoration, monitoring, accessibility/security review and load testing. This version has not undergone independent production certification or a full Golf Genius feature-parity audit.
