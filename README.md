# Gmail Send Tracker

A local-first audit ledger for sending borrower communication through Gmail. Gmail does the
sending, the account's **Sent** folder becomes the evidence, and PostgreSQL records every
attempt, Gmail ID, label check, count, and export row.

The V1 send path is the Gmail API only. There is no Netcore, SMTP, or other provider code in
this repository. Gmail always stores a copy in **Sent**, and the API does not support
suppressing that copy; the Sent entry is the audit evidence.

## What it does

- Connects a Gmail account with OAuth 2.0 and stores the refresh token encrypted with
  AES-256-GCM.
- Sends To/Cc/Bcc messages with HTML or plain text and attachments through
  `users.messages.send`.
- Stores the RFC 5322 `Message-ID`, Gmail message/thread IDs, labels, status, and errors.
- Verifies the Gmail `SENT` label and matching `Message-ID` with a metadata read.
- Provides a UI to compose, send, filter, verify, inspect events, reconcile, and export CSV.
- Shows a deep link to the Gmail Sent item for each successful send.
- Adds a per-send tracking ID, open pixel, acknowledgement link, and a tracking event timeline.
- Syncs Gmail metadata for DSN bounces, read-receipt-like messages, and thread replies.
- Accepts authenticated webhooks for delivered/bounce/open/read/complaint events from Workspace
  or an ESP.
- Keeps the Gmail adapter isolated behind a small interface without adding other providers.

## Architecture

```text
React/Vite UI  --/api-->  Fastify API
                              |
                              +--> SendService ------> EmailProvider -> Gmail API -> Gmail SENT
                              |        |
                              |        +--------------> PostgreSQL ledger/events
                              |
                              +--> CredentialService -> Google OAuth 2.0
                              |
                              +--> VerificationService -> Gmail metadata read
                              |
                              +--> TrackingService ----> TrackingProvider -> Gmail metadata
                                       |                    (DSN/MDN/threads)
                                       +--------------> PostgreSQL tracking_events
                                       +--------------> Webhook/pixel/ack endpoints
```

## Prerequisites

- Node.js 24 (`.nvmrc` is included).
- PostgreSQL 16+ running locally.
- A Google Cloud project with the Gmail API enabled and an OAuth **Web application** client.
- A personal Gmail account for the experiment.

## Quick start

```bash
nvm use
npm install
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY, COOKIE_SECRET.
createdb gmail_send_tracker
createdb gmail_send_tracker_test
npm run db:migrate
npm run db:seed
npm run dev
```

The UI runs at `http://localhost:5173` and proxies `/api` to `http://127.0.0.1:3000`.

The Google OAuth client must use this authorized redirect URI:

```text
http://localhost:3000/api/auth/google/callback
```

Follow [docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md) for the full setup and
troubleshooting guide.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | No | `development`, `test`, or `production` |
| `HOST` | No | API bind host, default `127.0.0.1` |
| `PORT` | No | API port, default `3000` |
| `APP_BASE_URL` | No | UI URL used for OAuth redirects, default `http://localhost:5173` |
| `PUBLIC_BASE_URL` | Tracking | Public HTTPS URL used in pixel/ack links; falls back to `APP_BASE_URL` |
| `DATABASE_URL` | Yes | Application PostgreSQL URL |
| `TEST_DATABASE_URL` | Tests | Separate test database; never the dev database |
| `GOOGLE_CLIENT_ID` | Yes for live | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Yes for live | Google OAuth web client secret |
| `GOOGLE_REDIRECT_URI` | No | Must match the Google console redirect URI |
| `TOKEN_ENCRYPTION_KEY` | Yes | Base64-encoded 32-byte AES key |
| `COOKIE_SECRET` | Yes | Signs the OAuth state cookie |
| `DAILY_SEND_LIMIT` | No | Default 100; below consumer Gmail limits |
| `MAX_ATTACHMENT_BYTES` | No | Default 20 MB total |
| `MAX_ATTACHMENTS` | No | Default 10 |
| `GMAIL_API_TIMEOUT_MS` | No | Default 30 seconds |
| `LIVE_TEST_RECIPIENT` | No | Defaults to the connected mailbox address |
| `LOG_LEVEL` | No | Pino log level, default `info` |
| `TRACKING_ENABLED` | No | Enables tracking IDs/decoration, default `true` |
| `TRACKING_PIXEL_ENABLED` | No | Enables the open pixel, default `true` |
| `TRACKING_ACK_ENABLED` | No | Enables the acknowledgement link, default `true` |
| `READ_RECEIPT_REQUESTED` | No | Adds read-receipt request headers, default `true` |
| `TRACKING_WEBHOOK_SECRET` | Webhook | Shared secret for `POST /api/tracking/webhook`; empty disables it |
| `TRACKING_SYNC_DAYS` | No | Gmail metadata lookback in days, default `7`, max `30` |

Generate local secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Database

```bash
npm run db:generate   # generate a migration from src/db/schema.ts
npm run db:migrate    # apply migrations
npm run db:seed       # ensure client-01 exists
npm run db:reset      # drop, recreate, migrate, and seed (development only)
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Database, Gmail configuration, and mailbox health |
| `GET` | `/api/auth/google` | Start OAuth with a signed state cookie |
| `GET` | `/api/auth/google/callback` | Exchange the code and store the mailbox |
| `GET` | `/api/auth/me` | Connection status without credentials |
| `POST` | `/api/auth/disconnect` | Remove the stored credential |
| `POST` | `/api/sends` | Validate, send, record, and verify |
| `GET` | `/api/sends` | Filter by client, status, search, page |
| `GET` | `/api/sends/export` | CSV export with formula-injection protection |
| `GET` | `/api/sends/:id` | Send detail plus event and tracking history |
| `POST` | `/api/sends/:id/verify` | Re-check Gmail `SENT` and `Message-ID` |
| `POST` | `/api/sends/reconcile` | Check recent `SENT`/`SENDING` rows |
| `POST` | `/api/tracking/sync` | Sync Gmail DSN/MDN/reply metadata |
| `POST` | `/api/tracking/webhook` | Ingest delivered/bounce/open/read events |
| `GET` | `/t/open/:trackingId` | 1x1 open pixel |
| `GET` | `/t/ack/:trackingId` | Acknowledgement confirmation page |
| `GET` | `/api/stats/summary` | Total, sent, verified, failed, in-flight |
| `GET` | `/api/stats/daily` | Daily sent/failed counts |
| `GET` | `/api/stats/by-client` | Counts grouped by client |
| `GET` | `/api/clients` | List clients |
| `POST` | `/api/clients` | Create a client |

## Audit semantics

- Gmail automatically applies `SENT` to every message sent with `users.messages.send` or
  `drafts.send`. The `SENT` label cannot be removed or suppressed through the API. We accept
  the Sent copy because it is the evidence; deleting or trashing it would destroy the audit
  proof.
- **Sent** means the ledger status is `SENT` or `VERIFIED`.
- **Verified** means a metadata read confirmed the Gmail `SENT` label and the RFC 5322
  `Message-ID`.
- **Failed** means the provider failed; no false `SENT` state is written.
- **Tracking events** are separate from the send status. They record evidence such as a DSN
  bounce, a pixel open, a read receipt, an acknowledgement click, a reply, or a webhook event.
- The Gmail Sent copy proves Gmail accepted and stored the message. It is **not** proof of
  recipient delivery, inbox placement, opens, or clicks.
- Delivery is recorded only when Workspace Email Log Search/BigQuery or an ESP webhook supplies
  evidence. Gmail API metadata cannot prove delivery.
- Opens are best-effort because Gmail's image proxy may pre-fetch or cache the pixel.
- Read receipts are Workspace-only and are not exposed through the Gmail API. The app adds
  request headers, but Gmail or the recipient may ignore them.
- Reusing an idempotency key with different content is rejected. A retry after a failed
  attempt reuses the same `Message-ID` so Gmail search recovery can find the original.
- The UI and CSV link each row back to its Gmail message ID.

## Testing

```bash
npm test          # unit, integration, and UI tests
npm run test:live # gated live Gmail smoke test
npm run typecheck
npm run lint
npm run build
```

The standard suite uses the test PostgreSQL database and a fake Gmail provider. It covers
validation, MIME construction, encryption, idempotency, repositories, the Gmail adapter,
OAuth error mapping, send/recovery/verification behaviour, tracking IDs/decoration, tracking
repositories and services, tracking API routes, CSV escaping, and the React UI.

The live test is skipped unless `RUN_LIVE_GMAIL_TESTS=1`. It sends a real message to the
connected mailbox or `LIVE_TEST_RECIPIENT`, then verifies the Gmail Sent copy. It requires a
connected mailbox in the configured database.

## Project layout

```text
src/domain/       validation, MIME, idempotency, Gmail URL, errors
src/services/     send, verification, tracking, credentials, token encryption
src/providers/    provider contracts and Gmail implementation
src/repositories/ Drizzle repositories
src/db/           schema, client, migrations runner, seed, reset
src/http/         Fastify app, routes, schemas, CSV, error mapping
web/              React/Vite UI
tests/            unit, integration, UI, live
docs/             plan, OAuth guide, AWS blueprint, skills
```

## Security notes

- `.env` is gitignored. Never commit Google secrets or token encryption keys.
- Refresh tokens are encrypted at rest; logs redact authorization and cookie headers.
- The local V1 binds to `127.0.0.1` and has no application login. Do not expose it to the
  internet. Tracking links need a reachable URL: use a short-lived tunnel with test data, or a
  production deployment with authentication and rate limiting.
- Message bodies and recipient addresses are PII. Define retention and access controls before
  production.
- The Gmail `gmail.metadata` scope may require Google verification or Workspace admin
  approval in production.
- Attachments are sent as base64 JSON in V1. For scale, move to object storage and multipart
  uploads.

## Known limitations

- Personal Gmail in OAuth Testing mode issues refresh tokens that expire after 7 days.
- Consumer Gmail sending limits are much lower than Workspace limits.
- Delivery, bounce, open, read, acknowledgement, reply, and complaint tracking depends on
  external evidence; see [docs/EMAIL_TRACKING_SETUP.md](docs/EMAIL_TRACKING_SETUP.md).
- Gmail metadata sync cannot read DSN/MDN bodies and there is no background scheduler yet.
- One connected mailbox in local V1; the schema already supports multiple mailboxes.
- Gmail API always keeps a Sent copy; there is no supported no-Sent send mode.
- No Netcore, SMTP, or other provider integration.
- AWS deployment is documented but not provisioned.

## Documentation

- [docs/PLAN.md](docs/PLAN.md) — scope, decisions, testing criteria, TDD sequence, risks.
- [docs/EMAIL_TRACKING_SETUP.md](docs/EMAIL_TRACKING_SETUP.md) — tracking sources, Workspace
  read receipts, webhooks, and limitations.
- [docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md) — local Google Cloud and Gmail setup.
- [docs/GOOGLE_WORKSPACE_IT_ENABLEMENT.md](docs/GOOGLE_WORKSPACE_IT_ENABLEMENT.md) — IT
  handoff for an enterprise Google Workspace mailbox.
- [docs/AWS_BLUEPRINT.md](docs/AWS_BLUEPRINT.md) — target AWS architecture.
- [docs/SKILLS.md](docs/SKILLS.md) — technical skills, roles, and onboarding.
- [.opencode/skills/gmail-send-tracker/SKILL.md](.opencode/skills/gmail-send-tracker/SKILL.md) —
  reusable opencode workflow.
