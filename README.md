# ApexLinks

An original, responsive golf tournament management prototype for a broader platform serving clubs, societies, and multi-club operators. Uses Node.js 22+ and native browser modules; no package installation or credentials are required.

## Run

From `/workspace/ApexLinks`, run `npm start` (port 3000) or `npm run dev` for server file watching. Set `PORT` to override the port. Refresh the browser after frontend edits. Run `npm test` for scoring tests.

## Available now

- Responsive club dashboard and tournament calendar with status filters and search.
- Create upcoming tournaments with course, date, and format.
- Search and add players with playing handicaps.
- Enter and edit all 18 gross scores for the seeded Autumn Invitational.
- Gross stroke leaderboard, simplified handicap-adjusted Stableford points, and CSV download.
- Browser-local persistence across reloads. Clear the `apexlinks.demo.v1` localStorage key to reset sample data.

All users, clubs, events, and scores are demonstration data. This is a single-device prototype. The leaderboard updates when a scorecard is saved in the same browser. It does not broadcast over a network. Upcoming events can be created, but their fields, rounds, and scoring are not implemented. Registration counts on seeded event cards are sample event data, separate from the six demo players. No backend database, user authentication, or external golf provider is connected.

Handicaps are integer playing handicaps (0–54). Stableford allocates extra strokes by hole order, rather than official course stroke indexes. These calculations are illustrative and must not be used for official competitions. Gross stroke ordering can compare partially completed rounds; ties and completion-aware official results remain to be implemented.

## Full platform roadmap

1. **Foundation:** PostgreSQL storage, organisation tenancy, administrator/club/society/player roles, authentication, invitations, audit history, backups, and server-side validation.
2. **Competitions:** event-specific registration, multiple rounds/courses/tees, stroke indexes, tee sheets, shotgun starts, pairings, divisions, teams, match play, fourball, foursomes, scrambles, countbacks, and official results.
3. **Live play:** authenticated mobile score entry, marker attestation, offline queue and conflict handling, real-time leaderboards, TV displays, score corrections, and notification delivery.
4. **Club operations:** tee bookings, memberships, subscriptions, event fees, provider-backed payments, refunds, invoices, attendance, and waiting lists.
5. **Insights:** participation, scoring trends, pace-of-play tracking, club revenue reporting, player history, and cross-club reporting.
6. **Integrations and launch:** authorised WHS/handicap and course-data integrations, email/SMS, payment provider, accessibility audit, automated end-to-end tests, security review, deployment and monitoring.

Production integrations need provider accounts and permissions. Credentials belong in environment settings, never in source control or chat. This implementation does not copy Golf Genius source code, branding, or proprietary assets.

## Embedding

The prototype permits embedding so it can run inside a development preview. Before adding authentication or production data, configure a `frame-ancestors` policy with the explicitly approved application and preview origins. Other script, stylesheet, and connection restrictions remain in place.
