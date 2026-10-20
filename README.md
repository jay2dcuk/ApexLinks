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

- Seeded singles-net knockout match play, staged bracket advancement, early results, and organiser-recorded playoff/concession decisions. Version 0.4 accepts 2–64 entrants, fills top-seed byes automatically, and records actual sudden-death playoff holes.
- Scramble and foursomes share one card per team, with an explicitly entered team playing handicap, version checks, attestation and net team standings. The app records scores; it does not validate on-course shot selection/alternation or calculate federation-specific team allowances.
- Individual final-round countback (last 9/6/3/1); withdrawal, disqualification and no-return status with reasons. Those statuses are excluded from winning positions. Waiting-list players are admitted in entry order when a place is released before play.
- Offline score queues for an **already loaded** card. Network failures save the draft to that user's device; Review queued scores offers explicit sync/discard. Conflicts retain local scores for human review. Version 0.4 adds an installable app shell and optional offline workspace reload; see the device preparation instructions below. Login and initial preparation still need a connection.
- Course-local booking hours, slot intervals, closed weekdays and holiday dates. Rules use an IANA timezone and account for daylight saving.
- Supplied handicap records, atomic JSON import, an allowance calculation, and attested-round exports. Federation records remain labelled unverified until approved provider integration is built.
- Optional Stripe card checkout with idempotency, signed payment webhooks, and expiry reconciliation; optional Resend single-use password recovery. Tests simulate provider responses; no live payments or emails were sent.

Run `npm run test:browser:advanced` with the same optional Playwright tooling to exercise all seven demo logins, multi-club permissions, scramble cards, match-play results, offline queue/sync and the handicap-record screen.

## Version 0.4 competition and club operations

- **Brackets:** standard seed placement for 2–64 players, automatic top-seed byes, controlled advancement, and recorded extra-hole gross scores with net match-play resolution. An organiser finalises the result. Regulation cards lock once playoff scoring starts; reopening a match archives/reset its playoff sequence before corrections.
- **Shotgun starts:** choose starting holes, group size and one/two groups per hole. A/B waves start together. The course reservation checks conflicts; individual bookings cannot be created during the shotgun window. Tee-sheet generation locks once scoring starts.
- **Assigned markers:** organisers link a separate scoring-capable player account to a player's round. Assigned markers can enter that card and attest another person's entry, but cannot attest a card they themselves entered. This does not grant access to another club.
- **Individual tees:** snapshot a tee set and playing handicap for individual stroke/net/Stableford rounds before scoring. Tee sets must share the same course name. Team and match-play mixed tees are not supported. The net best-ball preview is unavailable when a round has individual tee overrides.
- **Reusable templates:** clone event settings and round/course snapshots into a dated Draft tournament. Entrants, scores, billing, messages and public sharing links are not copied.
- **Operations desk:** a transparent event-preparation checklist, manual pace checkpoints and delay flags, incident/resolution tracking, and assigned staff tasks. Readiness is guidance, not a hard start gate. Pace is based on checkpoint reports, not GPS or an automatic emergency response system.
- **In-app inbox:** club-wide or selected-player messages with explicit read receipts. These do not send email/SMS or push notifications.
- **Custom report views:** select a supported dataset, columns and optional status filter; save and export a CSV. Only organisers can create/use these views. Version 0.5 adds editable print layouts with portrait/landscape pages, club headings, subtitles, footers, monetary totals and browser PDF printing. Financial amounts are minor units (pence). Existing restricted export permissions remain in place.

The operations features are intended to improve everyday club workflows. No claim that a competitor lacks a particular feature has been independently verified.

### Prepare a trusted device for offline play

1. While online, sign in and open the event/round you need.
2. In **Settings**, choose **Enable offline workspace** and accept local device storage. Use a trusted personal device, not a shared kiosk.
3. The installable shell caches static app assets. The optional workspace snapshot stores the current organisation's permitted data for up to 12 hours; it never stores passwords or session/CSRF tokens. You can reload the prepared app without a connection and enter scores.
4. Offline saves go into a per-account queue. Once online, use **Review queued scores → Sync card**. The server rechecks the account, organisation permission, round state and original scorecard version. Conflicts retain the local draft for review rather than overwriting the server.
5. Signing out removes the offline workspace snapshot; queued drafts remain tied to the account. If you sign out offline, server logout is attempted when connectivity returns. Changing accounts or discovering an expired server session clears the previous workspace cache.

Offline sign-in, downloading a new organisation while disconnected, and provider payments/synchronisation without connectivity are not supported. Revocations made on another device cannot be learned while this device is offline; reconnect before relying on current permissions. Local score drafts remain until explicitly synced or discarded. Browser/device storage restrictions can prevent offline preparation. A prepared cached workspace is not a database backup.

Run `npm run test:browser:operations` with the optional Playwright setup to exercise tasks, incidents, inbox/read receipts, report views, templates, shotgun starts, marker permissions, pace reports, cold offline reload, queued synchronisation and offline-cache removal on logout.

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

Remaining product gaps include a freeform report/PDF designer, monthly/adjusted billing, SMS/push, direct accounting synchronisation, approved federation API adapters, and mixed-tee match/team rules. The existing provider adapters still require your own credentials and live verification. Team ties currently remain shared; individual countback does not apply to the shared-team leaderboard. Increasing event capacity alone does not automatically promote waiting-list players: use their entry status deliberately, or release a registered entry before play.

Before production launch, configure and verify real provider services, backups/restoration, monitoring, accessibility/security review and load testing. This version has not undergone independent production certification or a full Golf Genius feature-parity audit.

## Version 0.5 reports, refunds and account verification

- **Reports → Build report / Edit → Preview / print:** choose columns and filters, club name, subtitle, footer, page orientation and monetary totals. Use the browser print dialog to print or save a PDF. Live report data requires a signed-in organiser; private API responses are never cached by the service worker. This is a structured table layout, not a freeform drag-and-drop designer.
- **Finance → Refund:** issue full or partial refunds of verified Stripe payments. The reason, amount and outcome are audited. Unknown results reserve the amount; retry the existing refund instead of creating another. Provider IDs, currency and amounts are checked, duplicate/out-of-order callbacks cannot regress a final result, and retries stop before Stripe’s idempotency retention window could expire. Refunds created outside ApexLinks are not imported: review Stripe before issuing another refund. Older paid invoices without a saved payment-intent field may need operator review.
- **Finance → Export accounting ledger:** organiser-only, date-filtered CSV of cash receipts and confirmed refunds. Amounts are decimal GBP, refunds have negative net amounts, and dates are UTC recording/confirmation dates. This is a cash ledger for review/import, not a double-entry journal, VAT return, bank settlement report or direct accounting sync. Payment processing fees and refunds issued outside ApexLinks are not included. No golfer email addresses or unrelated club data are exported.
- **Settings → Verify email:** Resend delivers a single-use confirmation link valid for 24 hours. Opening the link does not change the account until Confirm is clicked. Tokens are stored as hashes, requests are limited to one per minute, and another signed-in account cannot redeem the link. Existing accounts continue to work while clubs configure delivery.

Enable the additional Stripe refund events described in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). These workflows were tested with simulated provider responses; live delivery/processing still requires your own secure provider configuration and verification. Run `npm run test:browser:finance` with the same optional Playwright environment used by the other browser suites.

## Version 0.6 consent-based email campaigns

**Settings → Email preferences** lets a golfer with a linked player profile and verified account email subscribe to club campaign messages. Consent defaults to off and is tied to the exact player email. Organisers cannot opt golfers in on their behalf.

Organisers use **Campaigns → Draft campaign → Preview / schedule** to target all subscribed golfers or registered entrants of a chosen event. They explicitly confirm sending, then queue immediately or schedule within 30 days. Audiences are deduplicated by email (maximum 1,000), with eligibility checked again before each provider request. Cancellation stops unsent work; a message already being accepted cannot be recalled.

A durable SQLite queue processes at most one message per second while the server is running. Restarts preserve queued work. Provider requests use stable per-message idempotency keys, bounded retries and a 23-hour cutoff after first attempt. Unknown results become **Review**, requiring operator investigation; they are not labelled delivered. **Accepted** means the email provider accepted the request, not that it reached an inbox. Bounces, spam complaints, delivery receipts, SMS and push are not synchronised in this release. Do not manually recreate campaigns to resolve an unknown attempt without checking provider logs.

Each message contains an unsubscribe link with explicit confirmation; opening a link alone does not alter consent. Private unsubscribe tokens, recipient email lists and provider credentials are not returned in campaign reports or cached app assets. The existing Resend environment configuration enables the queue. Hosting must stay running for on-time scheduled delivery; sleeping Render services delay work until they resume. Tests use mocked email only.

## Version 0.7 annual recurring membership billing

Configure Stripe and its additional webhook events as described in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md), then use **Memberships → Subscribe annually**. A linked golfer can subscribe their own profile; organisers can initiate checkout for a selected golfer. The customer confirms recurring payments in Stripe Checkout. This supports fixed-price annual GBP plans of at least £0.50; free plans remain manual.

- An annual plan/price is snapshotted when checkout starts. Durable attempts and idempotency prevent duplicate checkouts after network timeouts; provider-confirmed expiry is required before replacing a known session. Unknown attempts older than 23 hours require operator review.
- A verified `invoice.paid` event creates/settles the corresponding invoice and extends the membership’s paid period. Return-page navigation and checkout completion alone do not activate membership. Duplicate invoices and delayed failure events cannot duplicate payments or undo a paid invoice. Invoice-before-checkout delivery is resolved through an authenticated Stripe subscription lookup.
- Failed annual invoices appear as Stripe-managed outstanding invoices. Use the **Billing portal** to update the payment method or resolve payment; manual settlement, voiding and one-time checkout are blocked for these invoices to avoid duplicate collection.
- **Stop renewal** calls Stripe and preserves the membership period already paid for. Manual membership deletion cannot bypass this operation. The same customer-bound billing portal is available to the linked golfer and authorised organisers. Unrelated players/clubs cannot open it.
- Membership records retain the exact paid-until timestamp alongside display dates. A refund does not itself cancel renewal or shorten the paid period; handle the club’s membership/refund policy deliberately.

This release does not support monthly billing, tax additions, coupons, trials, quantity changes, proration, plan changes, subscription credit balances or partial annual invoices. Such invoice adjustments are rejected for operator review rather than granting an incorrect period. Configure the Stripe portal accordingly. Only supported annual invoices are mirrored. Live provider behaviour still needs testing with your own test-mode Stripe account before any production use.
