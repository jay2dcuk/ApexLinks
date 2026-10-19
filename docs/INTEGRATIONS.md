# Integration setup

## England Golf / MyEG

MyEG is a golfer-facing service; an app login must not be treated as a software integration credential. No proprietary API URL, authentication method, or score-posting endpoint has been assumed in this repository.

Contact England Golf through its official website, https://www.englandgolf.org/, and ask the club-services/WHS team whether your organisation and software can be authorised to integrate. Request:

- The relevant partnership/data agreement and API documentation.
- Permitted CDH/member lookup and handicap-index operations.
- Golfer consent, permitted retention, audit and deletion requirements.
- Whether course/tee ratings and scores may be retrieved or posted.
- Sandbox credentials, production approval, quotas, and required conformance tests.

Access may be restricted or unavailable for your particular use case. Do not scrape MyEG, automate a golfer's login, or supply a golfer's password as an API key. For another home nation, contact that country's authorised handicapping body.

## USGA / GHIN

Start at https://www.usga.org/handicapping/ghin.html and contact USGA/GHIN or the club's Allied Golf Association. Ask whether your software is eligible for authorised integration, and obtain the partner contract, current endpoint/authentication documentation, sandbox, golfer-consent requirements, and score-posting permissions.

A GHIN number identifies a golfer; it does not itself authorise API access. No live USGA/GHIN connection exists yet. Once approved documentation and secure credentials are available, the provider-specific adapter can be implemented and tested against the official sandbox. Never paste credentials into chat or commit them to Git.

## What works before federation access

The Handicaps screen lets organisers record or bulk-import supplied handicap records with provider label, member number, index, and as-of date. Records are explicitly **unverified organiser-provided data**. Imports are atomic; if a record is invalid no records are saved. Supported JSON input:

```json
[
  {
    "playerEmail": "player@example.com",
    "provider": "USGA / GHIN",
    "membershipId": "1234567",
    "index": 12.4,
    "asOf": "2026-10-19"
  }
]
```

Provider labels: `England Golf / MyEG`, `USGA / GHIN`, `Other federation`, or `Manual`. Match players by their existing email, or use `playerId`. Dates must be ISO calendar dates. Optional `courseId` and integer `allowance` (1–100 percent) calculate a playing handicap from the course's rating, slope and par. Existing tournament entry handicaps stay fixed; organisers must deliberately change them before scoring.

The calculation uses `index × slope / 113 + course rating − par`, applies the selected allowance and rounds. Check jurisdiction and competition rules before using a supplied value. This is not federation verification or automatic synchronisation.

The screen can export organiser-attested individual rounds for a future authorised provider mapping. The export includes the event format, scores and holes played; not every attested card is eligible for handicap posting (for example partial match-play cards). It does not calculate/post an official score differential or certify score acceptability. Course rating/slope in this export come from the current course record, so validate the effective ratings before posting historical scores.

## Stripe Checkout

A card checkout adapter is implemented but is inactive without secure configuration. In **Render → Environment**, add:

- `APP_URL`: your public HTTPS site, e.g. `https://apexlinks-qh6p.onrender.com`.
- `STRIPE_SECRET_KEY`: your Stripe **test-mode** secret initially.
- `STRIPE_WEBHOOK_SECRET`: the signing secret for your configured endpoint.

Create a Stripe webhook endpoint at `https://apexlinks-qh6p.onrender.com/api/payments/webhook`, subscribing to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Use test mode and Stripe's own test cards before any live payment. Keep the key and webhook endpoint in the same mode.

A member may pay only their own invoice; organisers may open checkout for club invoices. Checkout requests use an idempotency key. Paid status comes from a signature-verified webhook with matching invoice, amount, currency, session and payment attempt. Return-page navigation does not mark an invoice paid. The callback rejects stale signatures and processes duplicate events once.

Do not record an external payment or void an invoice while an online checkout may still collect money. **Check payment status** verifies expiry with Stripe before releasing that lock; a local clock reaching the expiry time alone is insufficient. If a network timeout left the session unknown, retry checkout to recover the same attempt first. A paid response waiting for its webhook does not immediately alter the invoice. Investigate failed webhook delivery in Stripe. Recurring billing and automated refunds are not implemented.

Allow outbound HTTPS to `api.stripe.com` in restricted networks. Browser users navigate to `checkout.stripe.com`. Never put the secret key in browser code.

## Recovery email (Resend)

In Render, add:

- `APP_URL`: your public HTTPS site.
- `RESEND_API_KEY`: a key from your own Resend account.
- `EMAIL_FROM`: a sender address on a domain you have verified with Resend.

Allow outbound HTTPS to `api.resend.com` if networking is restricted. The Forgot password flow sends a single-use link valid for 30 minutes. Only token hashes are stored. Successful reset invalidates every existing session and outstanding reset token for that account. Without configured email delivery, the UI tells users recovery is unavailable; it does not pretend to send mail.

Invitations still use codes that administrators share themselves. SMS, general event-email campaigns, push notifications, email verification and accounting synchronisation are not implemented. Real provider delivery and card processing have not been validated without credentials; tests use simulated provider responses and signed test webhooks.
