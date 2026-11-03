---
name: gmail-send-tracker
description: Set up, run, test, and troubleshoot the Gmail Send Tracker; send a message through the Gmail API, verify the Gmail SENT copy, reconcile the ledger, and export audit evidence.
license: MIT
compatibility: opencode
metadata:
  domain: email-audit
  stack: typescript-fastify-react-postgres
---

## What I do

- Verify Google OAuth and Gmail API prerequisites before a live run.
- Start the local API/UI, connect a mailbox, and send a test message.
- Check that the ledger status is `SENT`/`VERIFIED`, that Gmail's `SENT` label exists, and
  that the stored `Message-ID` matches.
- Run reconciliation and export audit CSV.
- Troubleshoot OAuth, scope, token-expiry, and safe send errors without exposing secrets.

## When to use me

Use this skill when working in the Gmail Send Tracker repository, connecting a Gmail account,
running the live smoke test, diagnosing a failed or unverified send, or preparing audit
evidence. Do not use it for unrelated React or Fastify projects.

## Preconditions

- Node 24 is active (`nvm use`).
- PostgreSQL is running and `DATABASE_URL`/`TEST_DATABASE_URL` are set.
- `.env` has a 32-byte base64 `TOKEN_ENCRYPTION_KEY`, a non-empty `COOKIE_SECRET`, and
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` for live work.
- The Google OAuth web client has redirect URI
  `http://localhost:3000/api/auth/google/callback`.
- The Gmail API is enabled and the account is an OAuth test user.

## Workflow

1. Inspect configuration without printing secrets:
   - Confirm `.env` keys exist; never cat the file into logs.
   - Run `npm run typecheck` and `npm test` before changing code.
2. Prepare the database:
   - `npm run db:migrate`
   - `npm run db:seed`
3. Start the app:
   - `npm run dev`
   - UI: `http://localhost:5173`; health: `http://127.0.0.1:3000/api/health`.
4. Connect Gmail:
   - Open the UI and click **Connect Gmail**.
   - Complete consent; confirm `/api/auth/me` shows the mailbox and no token.
5. Send a live test:
   - Use the UI or `POST /api/sends` with a UUID idempotency key.
   - Send to the connected address or `LIVE_TEST_RECIPIENT`.
   - Confirm the response has a provider message ID and a Gmail Sent URL.
6. Verify:
   - `POST /api/sends/:id/verify`.
   - Confirm `verified: true` and status `VERIFIED`.
   - Open the Gmail Sent link and compare From/To/Subject.
7. Reconcile and export:
   - `POST /api/sends/reconcile` with `{"days":2}`.
   - `GET /api/sends/export?clientId=...` and inspect the CSV.
8. Exercise tracking when configured:
   - Confirm `PUBLIC_BASE_URL` is reachable and the migration added `tracking_id`.
   - Open the send detail and copy the acknowledgement link.
   - `POST /api/tracking/sync` with `{"days":7}` and inspect tracking events.
   - Post a test webhook with `x-tracking-secret` and a stable `providerEventId`.
   - Confirm the pixel returns a GIF and increments `openCount`.
9. Run the gated live smoke test when a mailbox is connected:
   - `npm run test:live`
   - It sends a real message, so use a test account and recipient.

## Guardrails

- A Gmail Sent copy proves Gmail accepted and stored the message; it is not delivery proof.
- Delivery/bounce/open/read evidence comes from pixels, links, Gmail metadata, Workspace
  logs/BigQuery, or an ESP webhook. Gmail API cannot prove delivery or read.
- Read receipts require Workspace and recipient cooperation; request headers are best-effort.
- Opens are unreliable because Gmail may proxy/cache the pixel.
- Never mark `SENT` without a provider message ID and the Gmail `SENT` label.
- Never log or commit tokens, cookies, client secrets, bodies, or recipient data.
- Keep the daily cap below the account's sending limit.
- Testing-mode refresh tokens expire after 7 days; reconnect on `invalid_grant`.
- One connected mailbox in local V1. Do not expose the local app to the internet. For pixel/ack
  tests, use a short-lived HTTPS tunnel with test data; production needs app authentication.

## Useful commands

```bash
nvm use
npm test
npm run typecheck
npm run lint
npm run build
npm run db:migrate
npm run db:seed
npm run dev
npm run test:live
```

## Key files

- `src/services/send-service.ts` — send orchestration, idempotency, recovery, cap.
- `src/services/verification-service.ts` — metadata verification and reconciliation.
- `src/providers/gmail/gmail-provider.ts` — Gmail send/verify/search adapter.
- `src/providers/gmail/gmail-api.ts` — API calls, timeout, error mapping.
- `src/services/tracking-service.ts` — pixel/ack/webhook/sync orchestration.
- `src/providers/gmail/gmail-tracking-provider.ts` — DSN/MDN/reply metadata sync.
- `src/http/routes/tracking.ts` — public pixel/ack and tracking API.
- `docs/EMAIL_TRACKING_SETUP.md` — tracking sources, Workspace read receipts, webhooks.
- `src/domain/validation.ts` — recipients, bodies, attachments, header injection.
- `src/domain/idempotency.ts` — Message-ID and request hash.
- `src/http/app.ts` — API composition and route registration.
- `web/src/App.tsx` — UI shell, connection state, tabs.
- `docs/GOOGLE_OAUTH_SETUP.md` — Google Cloud and troubleshooting guide.
- `docs/AWS_BLUEPRINT.md` — production target design.

## Troubleshooting

| Symptom | Check | Action |
| --- | --- | --- |
| `GOOGLE_NOT_CONFIGURED` | Client ID/secret in `.env` | Fill both and restart API |
| `redirect_uri_mismatch` | Google console redirect URI | Use the exact localhost callback URL |
| `invalid_grant` | Token lifetime/revocation | Disconnect, remove app access, reconnect |
| `GMAIL_AUTH` | Gmail API enabled and scopes granted | Re-consent; check admin access |
| `GMAIL_RATE_LIMIT` | Daily cap and Gmail limits | Wait or raise Workspace limits |
| `GMAIL_TIMEOUT` | Network/API latency | Retry same key; reconciliation searches `rfc822msgid` |
| Unverified after send | Gmail metadata headers/labels | Open event history; verify again or reconcile |
| Local API fails to start | Port 3000, DB, env | Check `npm run db:migrate` and `.env` without printing secrets |

## Acceptance checklist

- [ ] Typecheck, lint, and tests pass.
- [ ] OAuth connect stores a mailbox and no token is visible.
- [ ] A live send returns a Gmail message ID and Sent URL.
- [ ] `SENT`/`VERIFIED` status is backed by the Gmail `SENT` label.
- [ ] Retry with the same key does not create a duplicate.
- [ ] Reconciliation reports checked/verified/error counts.
- [ ] CSV export contains Gmail IDs, tracking IDs, and no secrets.
- [ ] Pixel/ack links use a reachable public URL and record events.
- [ ] Tracking sync runs without a Gmail scope error.
- [ ] The record survives an API restart.
