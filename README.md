# ApexLinks

Original golf and club management software for clubs, societies, and multi-organisation operators. This release replaces the browser-only demonstration with authenticated accounts, server-side SQLite storage, and shared tournament workflows. It is not a complete Golf Genius replacement; the remaining capabilities are listed below.

## Start locally

Requires **Node.js 24**. The app has no third-party runtime dependencies.

```sh
npm test
npm start
```

The server uses port 3000 by default; `PORT` overrides it. `npm run dev` restarts the server on changes; refresh the browser after frontend changes. Open the app, choose **Create an account**, and create your organisation. No preset administrator or password exists. Add your course and player records or choose **Load sample tournament** in an empty workspace.

## Implemented workflows

- **Accounts:** registration, login/logout, password change, scrypt password hashing, database-backed HttpOnly sessions, CSRF checks, authentication throttling, and input validation.
- **Organisations:** separate workspaces, administrator/manager/scorer/player roles, expiring email-bound invitation codes, role management, and protection against removing the last administrator.
- **Courses:** configurable 18-hole pars, unique stroke indexes, tee names, rating, and slope. Each round captures its own par/index snapshot. Ratings and slope are stored for reference; playing handicaps are entered manually.
- **Players:** names, clubs, account emails, manually entered playing handicaps including plus handicaps, and active/inactive status.
- **Tournaments:** dates, descriptions, fees, capacity, Draft/Open/Live/Completed/Cancelled status, event-specific fields, registration, divisions, teams, multiple rounds and courses. Entry fees create unpaid invoices, not card charges.
- **Pairings:** groups of two to four ordered by name, handicap, or prior standings; tee intervals, starting holes, editable tee times, and printable tee sheets. Ordinary booking conflicts are checked in both directions.
- **Scoring:** round-specific 18-hole cards, partial drafts, submission, organiser/scorer attestation, organiser unlock, closed-round protection, and optimistic version checks to prevent lost concurrent changes. Players may enter only their own linked profile's scores. Scorers cannot attest a card they entered; organisers can, with an audit record.
- **Leaderboards:** gross stroke, net stroke and Stableford; division tables; tied positions; team net best ball per round; CSV export. Shared screens refresh every ten seconds. Organisers can enable a public read-only spectator link and revoke it. Public links reveal player names and scores, never emails, billing, or audit history.
- **Bookings:** one to four golfers, timezone-aware timestamps, duplicate and overlapping tee-slot checks, tournament reservations, and cancellations. Times display in each viewer's browser timezone.
- **Memberships:** annual plan prices, dated memberships, overlapping membership prevention, cancellations, and invoicing. These are club records, not recurring card subscriptions.
- **Finance:** paid/outstanding invoice totals, external payment references, and voiding of unpaid invoices. Money must be collected separately. Cancelling an entry or membership does not automatically void/refund its invoice.
- **Club operations:** shared noticeboard, player participation and scoring reports, full records export for organisers, and up to 1,000 recent mutation audit records per organisation.

Members sign in using their invited email. To enable player registration and scoring, an organiser must create a player profile with the same email and register it for the event. Players can self-register their linked profile while an event is Open. Organisers can change playing handicaps, teams, and divisions before a player starts scoring.

Before completing an event, attest all registered players' cards and close every round. Submitted scores remain editable until attested. Reopen the tournament and round before making post-competition corrections. Gross/net standings compare totals and should be treated as provisional when players have played different numbers of holes. Ties share a position; automatic countback and official handicap verification are not implemented.

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

## Remaining work for full product parity

Not yet implemented: match play/brackets, scramble/foursomes formats, official countback/tiebreak rules, disqualifications/withdrawals/no-return handling, handicapping allowances and WHS integration, multiple tee sets within one round, configurable shotgun assignment algorithms, offline scoring/synchronisation, marker-specific card assignment, automatic waiting lists, custom report designer, recurring payments/refunds, email/SMS/push notifications, account recovery and email verification, integration APIs, and configurable booking hours/holidays.

Card processing requires a payment provider account and signed webhooks; official handicap/course data requires authorised provider access; outbound mail and password recovery require a verified sending service. No such credentials were supplied, and these features are not represented as connected. Store future credentials in secure environment settings, never Git or chat.

Before a production launch, add those required providers, test backups, conduct independent security/accessibility review and load testing, and establish monitoring and account recovery. The current version has working shared club workflows, but has not undergone that production review.
