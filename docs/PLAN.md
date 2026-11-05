# Gmail Send Tracker — Plan, Scope, and TDD Contract

## 1. Problem statement

Netcore is currently used to send borrower communication from addresses such as
`support-client-01@mycompanyname.com`. There is no reliable count of what was sent, and
auditors expect to find the communication in the corporate mailbox as proof. The long-term
requirement is to support multiple SMTP providers or a different email provider without
rewriting the audit and counting layer.

**V1 decision:** Gmail API is the only sending path. Netcore and SMTP are out of scope and
have no implementation in this repository. Gmail always saves a copy in `SENT` when a message
is sent with `users.messages.send` or `drafts.send`; there is no API option to suppress it.
That Sent copy is the audit evidence, so V1 accepts it rather than deleting it.

## 2. Discovery decisions

| Area | Decision |
| --- | --- |
| Audit proof | A copy in Gmail `SENT` with the same From/To/CC/subject/body/attachments. |
| Send path | Gmail API only; Netcore/SMTP are out of scope. |
| Trigger | The UI/API calls Gmail directly. |
| Google auth | Personal Gmail OAuth 2.0 for the experiment; Workspace auth later. |
| Stack | TypeScript/Node, local first, AWS-ready. |
| Ledger | PostgreSQL plus API and dashboard. |
| Skills | Document the technical/team skills and create a reusable opencode skill. |
| Netcore | Not part of this codebase or V1 scope. |

### V1 assumptions

- Attachments are in scope (PDF/images/documents attached to audit communications).
- The first live tests send to the authenticated Gmail address; a second CC address can be
  added later.
- One connected mailbox at a time in local V1. The schema already allows multiple mailboxes.
- No application login in local V1; bind to `127.0.0.1`. AWS requires real app auth.
- HTML and plain-text bodies are supported. The original V1 had no tracking; an optional
  tracking layer was added later. See [EMAIL_TRACKING_SETUP.md](EMAIL_TRACKING_SETUP.md) and
  the maintained delivery checklist in [TRACKING_PLAN.md](TRACKING_PLAN.md).
- Default daily cap: 100 messages, configurable. This is deliberately below consumer Gmail
  limits to avoid account suspension during experimentation.

## 3. Goals and non-goals

### Goals

1. Connect a Gmail account with OAuth 2.0 and store the refresh token encrypted.
2. Compose and send a message through the Gmail API with To, CC, BCC, subject, HTML, text,
   and attachments.
3. Capture the Gmail message ID, thread ID, labels, and RFC 5322 Message-ID immediately.
4. Verify the message is in Gmail `SENT` through a metadata read.
5. Persist every attempt in PostgreSQL and count sends by client, date, provider, status, and
   mailbox.
6. Provide a UI to send, view, verify, filter, and export audit records, with a direct link
   to the Gmail Sent item.
7. Make retries safe: idempotency key, unique Message-ID, and timeout recovery.
8. Keep the Gmail adapter isolated so it does not couple the ledger to Gmail internals.
9. Deliver tests first, then implementation, plus setup docs and an AWS blueprint.

### Non-goals for V1

- Netcore, SMTP, SES, or other provider integration and webhook processing.
- A no-Sent send mode. Gmail API always applies `SENT` and does not allow it to be removed.
- Original V1 non-goal: delivery, bounce, complaint, open, or click tracking. The current repo
  now has an optional tracking layer that depends on external evidence. The Sent copy is still
  proof of sending, not proof of recipient delivery.
- Corporate Workspace domain-wide delegation or multi-user app authentication.
- Campaign scheduling, template management, inbox synchronization, or CRM integration.
- Legal certification that a Gmail copy satisfies a specific regulator. The auditor must
  confirm the evidence standard.

## 4. Architecture

```text
Browser (React/Vite)
        |
        | /api (same origin; Vite proxy in dev)
        v
Fastify API
        |
        +--> SendService ---------> EmailProvider (GmailProvider) ---> Gmail API ---> Gmail SENT
        |         |                        |
        |         +--> LedgerRepository ---+--> PostgreSQL
        |
        +--> OAuthService ---> Google OAuth 2.0
        |
        +--> VerificationService ---> Gmail messages.get(format=metadata)

V1 has no other provider implementation. The `EmailProvider` interface keeps the Gmail
adapter isolated for testing, not as a promise of multi-provider support.
```

### Layers

- `src/domain`: types, validation, MIME construction, Message-ID/idempotency rules, errors.
- `src/services`: send orchestration, OAuth, verification, token encryption, counting.
- `src/providers`: provider contract and Gmail implementation.
- `src/repositories`: PostgreSQL access through Drizzle.
- `src/http`: Fastify routes, request/response schemas, error mapping.
- `web`: React UI served by Vite in development and Fastify in production.

### Gmail scopes

- `https://www.googleapis.com/auth/gmail.send` — send messages.
- `https://www.googleapis.com/auth/gmail.metadata` — verify labels and headers without
  reading message bodies; also used for timeout recovery and reconciliation.
- `openid`, `email`, `profile` — identify the connected mailbox.

Testing-mode OAuth refresh tokens expire after 7 days. Reconnect when prompted. Production
Workspace use will require admin approval and possibly Google OAuth verification for
restricted/sensitive scopes.

## 5. Data model

### `clients`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | e.g. `client-01` |
| `name` | text | display name |
| `created_at` | timestamptz | |

### `mailboxes`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `provider` | text | `gmail` in V1 |
| `email` | text | connected address |
| `display_name` | text nullable | from Google profile |
| `created_at`, `updated_at` | timestamptz | |

Unique: `(provider, email)`.

### `oauth_credentials`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `mailbox_id` | uuid FK | cascade delete |
| `refresh_token_encrypted` | text | AES-256-GCM |
| `scopes` | text[] | granted scopes |
| `token_type` | text | usually `Bearer` |
| `created_at`, `updated_at` | timestamptz | |

Unique: `mailbox_id`.

### `email_sends`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `provider` | text | `gmail` only |
| `mode` | text | `direct` only; retained for schema stability |
| `mailbox_id` | uuid FK | nullable for historical records |
| `client_id` | text FK | |
| `from_email` | text | authenticated mailbox or verified alias |
| `to_emails`, `cc_emails`, `bcc_emails` | text[] | |
| `subject` | text | |
| `body_html`, `body_text` | text nullable | stored for audit; can be redacted later |
| `attachments` | jsonb | filename, mime type, size, SHA-256; no content |
| `message_id_header` | text | our RFC 5322 Message-ID |
| `provider_message_id` | text nullable | Gmail message ID |
| `provider_thread_id` | text nullable | Gmail thread ID |
| `provider_labels` | text[] | must include `SENT` for success |
| `status` | text | `SENDING`, `SENT`, `VERIFIED`, `FAILED` |
| `error_code`, `error_message` | text nullable | safe, no secrets |
| `idempotency_key` | text unique | prevents double sends |
| `request_hash` | text | detects key reuse with different content |
| `sent_at` | timestamptz nullable | |
| `verified_at` | timestamptz nullable | |
| `created_at`, `updated_at` | timestamptz | |

### `email_send_events`

Append-only event log: `id`, `send_id`, `event_type`, `payload` jsonb, `created_at`.
Used for status changes, Gmail responses, verification results, and future provider
webhooks.

### Counting definitions

- **Sent:** status `SENT` or `VERIFIED` (Gmail accepted and labelled the message `SENT`).
- **Verified:** status `VERIFIED` (metadata re-read confirms the Gmail `SENT` label and
  Message-ID).
- **Failed:** status `FAILED`.
- **In flight:** status `SENDING`.
- Counts are derived from `email_sends`; no separate counter table to drift.

## 6. Audit and verification flow

1. Build an RFC 5322 MIME message with a generated Message-ID
   `<uuid@from-domain>`.
2. Call Gmail `users.messages.send` with the base64url-encoded raw message.
3. Require the response to contain a message ID and the `SENT` label; store both Gmail IDs,
   labels, and `sent_at`.
4. Optionally verify with `users.messages.get(format=metadata)`:
   - `SENT` is present in `labelIds`.
   - The `Message-ID` header equals the stored value.
   - The `From` header matches the connected mailbox.
   - Update status to `VERIFIED` and store `verified_at`.
5. The UI shows a Gmail deep link:
   `https://mail.google.com/mail/?authuser=<mailbox>#sent/<messageId>`.
6. Reconciliation reads recent `SENT`/`SENDING` records and checks Gmail. A send that
   actually succeeded but lost its HTTP response is recovered by scanning recent `SENT`
   metadata for the stored `Message-ID` (the `gmail.metadata` scope does not support `q`).

**What this proves:** Gmail accepted the message for delivery and placed it in the account's
Sent folder. The recipient's copy is the evidence for Gmail relay/authentication headers.

**What this does not prove:** recipient delivery or inbox placement.

**Gmail Sent behavior:** `users.messages.send` and `drafts.send` automatically apply the
system `SENT` label. Gmail does not expose an option to send without creating the Sent copy,
and the `SENT` label cannot be removed through `messages.modify`. Deleting or trashing the
message would remove the evidence and is not done. The Sent copy is therefore an accepted
part of the Gmail-only design.

## 7. Skills

### Technical skills

- TypeScript/Node, Fastify, React, Vite, PostgreSQL, SQL, Drizzle ORM.
- OAuth 2.0, Google Identity, Gmail API, MIME/RFC 5322, base64url encoding.
- Security: AES-256-GCM token encryption, secret management, log redaction, input validation.
- Testing: Vitest, Fastify `inject`, dependency injection, live smoke tests, Postgres test DB.
- Operations: Docker/Node runtime, AWS ECS Fargate, RDS, Secrets Manager, CloudWatch.
- Audit domain: Sent-folder evidence, Message-ID traceability, reconciliation, retention.

### Team roles

- **Engineer:** application, tests, integration, deployment.
- **Google Workspace admin:** OAuth app, scopes, mailbox aliases, send-as, production access.
- **Auditor/operations:** evidence standard, retention, export review, reconciliation sign-off.

The detailed competency matrix, roles, and onboarding path are in `docs/SKILLS.md`.

### Reusable opencode skill

`.opencode/skills/gmail-send-tracker/SKILL.md` captures the repeatable workflow:
verify OAuth setup, run migrations, start the app, send a test, verify `SENT`, reconcile, and
export audit evidence. This keeps future Gmail work consistent.

## 8. Scope of work and phases

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | Node 24, project scaffold, Postgres DB, OAuth setup guide | Done |
| 1 | Domain tests and implementation: validation, MIME, idempotency | Done |
| 2 | Schema, migrations, repositories, seed | Done |
| 3 | Gmail adapter, OAuth token store, send/verify/reconcile services | Done |
| 4 | Fastify API and error mapping | Done |
| 5 | React UI: connect, compose, sends, dashboard, export | Done |
| 6 | Unit/integration/UI tests, typecheck, lint | Done |
| 7 | Live Gmail send + Sent verification | Done; live smoke test passed against the connected mailbox |
| 8 | README, OAuth guide, opencode skill, AWS blueprint | Done |
| Post-V1 | Tracking ID, pixel/ack, Gmail metadata sync, webhook ingestion | Done; hard/soft bounce plan in `TRACKING_PLAN.md` |
| Future | Workspace DWD, multi-mailbox, app auth, AWS deployment, delivery-event bridge | Out of V1 |

## 9. Testing criteria

### Functional acceptance

1. **OAuth connect**
   - Given valid Google OAuth credentials, when the user connects, then the mailbox and
     encrypted refresh token are stored, no token appears in logs, and the UI shows the
     connected address.
2. **Successful send**
   - Given a connected mailbox and valid message, when Send is clicked, then Gmail returns a
     message ID, thread ID, and `SENT` label; the ledger stores status `SENT`; the UI shows
     the Gmail Sent link; the count increments.
3. **Sent verification**
   - Given a `SENT` record, when Verify runs, then metadata read confirms `SENT` and the
     Message-ID matches; status becomes `VERIFIED`.
4. **Idempotency**
   - Given the same idempotency key, when Send is retried, then the existing record is
     returned and Gmail is not called twice.
5. **Timeout recovery**
   - Given Gmail sent the message but the client lost the response, when the same key is
     retried, then the service scans recent `SENT` metadata for the stored `Message-ID`,
     marks it `SENT`, and does not create a duplicate.
6. **Failure handling**
   - Given Gmail returns 401/403/429/5xx, then the record is `FAILED` with a safe error code
     and message; the UI shows the failure; no false `SENT` state is written.
7. **Validation**
   - Invalid email, missing subject/recipient, CRLF header injection, too many recipients,
     attachment over the cap, or no connected mailbox returns 4xx with a clear message.
8. **Token expiry**
   - Given an invalid/expired refresh token, then the UI prompts reconnect and the API does
     not leak token details.
9. **Counts**
   - Sent counts include `SENT` + `VERIFIED`, exclude `FAILED`, and group correctly by
     client, day, provider, and status.
10. **Audit export**
    - CSV has correct escaping, filters, and no secrets; rows tie back to Gmail IDs.
11. **UI**
    - Compose validates, send is disabled while in flight, success shows the Sent link,
      errors are visible, and dashboard filters update counts.
12. **Non-functional**
    - Data survives restart; the daily cap is enforced; health check reports DB and Gmail
      connectivity; logs redact secrets and bodies by default.

### Live acceptance (needs user OAuth)

- Connect personal Gmail, send to the same address with CC and one attachment.
- Confirm `SENT` via metadata API and visually in Gmail.
- Confirm the UI row, count, and Gmail deep link.
- Restart the app and confirm the record persists.

### Test pyramid

- **Unit:** domain, MIME, encryption, provider contract, repositories.
- **Integration:** Fastify routes with a real test Postgres and a fake Gmail provider.
- **Live:** gated by `RUN_LIVE_GMAIL_TESTS=1` and a connected credential.
- **UI:** React Testing Library; live browser smoke is manual in V1.

## 10. TDD sequence

Each step is red → green → refactor. Do not implement a layer before its tests fail.

1. `tests/unit/validation.test.ts` → `src/domain/validation.ts`
2. `tests/unit/mime.test.ts` → `src/domain/mime.ts`
3. `tests/unit/crypto.test.ts` → `src/services/crypto.ts`
4. `tests/unit/idempotency.test.ts` → `src/domain/idempotency.ts`
5. `tests/integration/repositories.test.ts` → `src/repositories/*`
6. `tests/unit/gmail-provider.test.ts` → `src/providers/gmail/*`
7. `tests/integration/send-service.test.ts` → `src/services/send-service.ts`
8. `tests/integration/verification-service.test.ts` → `src/services/verification-service.ts`
9. `tests/integration/api.test.ts` → `src/http/routes/*`
10. `tests/ui/*.test.tsx` → `web/src/*`
11. `tests/live/gmail-live.test.ts` → live smoke, gated.

Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:live`.

## 11. Definition of done

- `npm install`, database migration/seed, and `npm run dev` work from a clean checkout.
- OAuth guide is complete and the user can connect a personal Gmail account.
- A live send appears in Gmail `SENT`, is verified by metadata, and is visible in the UI with
  counts and a deep link.
- Unit/integration/UI tests pass; typecheck and lint pass.
- No secrets in git; `.env.example` documents every variable.
- `docs/PLAN.md`, `README.md`, the OAuth guide, and the opencode skill are present.
- AWS deployment blueprint is documented but not provisioned.

## 12. Risks and limitations

- Personal Gmail OAuth in Testing mode issues refresh tokens that expire after 7 days.
- Gmail sending limits apply (consumer accounts are much lower than Workspace). The default
  100/day cap is intentional; confirm limits before production.
- Gmail may normalize headers. The stored Message-ID is verified; if it differs, the Gmail
  message ID remains the source of truth and the discrepancy is logged.
- Sent copy is not delivery proof. Tracking events depend on pixels, links, Gmail metadata
  sync, Workspace logs/BigQuery, or ESP webhooks; see docs/EMAIL_TRACKING_SETUP.md.
- Gmail cannot send as an arbitrary From address. The address must be the authenticated user
  or a verified `sendAs` alias. Corporate alias setup is a Workspace-phase task.
- Restricted/sensitive OAuth scopes may require Google verification and Workspace admin
  approval for production use.
- Borrower emails, subjects, and bodies are PII. V1 stores them in Postgres for audit; encrypt
  at rest, restrict access, and define retention before production.
- Attachments are sent as base64 JSON in V1. For scale, move to S3/multipart uploads.
- AWS deployment is a blueprint only until app auth, TLS, secrets, backups, and monitoring
  are implemented.

## 13. AWS deployment blueprint (phase 8)

- **Runtime:** ECS Fargate service running the built Node container behind an ALB with ACM
  TLS. One task minimum for the experiment; autoscale later.
- **Database:** RDS PostgreSQL in private subnets, automated backups, encryption at rest.
- **Secrets:** AWS Secrets Manager for Google client ID/secret, token encryption key, cookie
  secret, and database credentials. Inject at task startup; never bake into the image.
- **OAuth:** HTTPS redirect URI registered in Google Cloud; production OAuth branding and
  verification; Workspace admin approval and alias/send-as configuration.
- **Access:** Cognito or ALB authentication in front of the UI/API. Local V1 has no app login.
- **Observability:** CloudWatch logs/metrics/alarms; redact secrets and message bodies; track
  send failures, verification lag, and daily-cap hits.
- **Storage:** S3 for CSV exports and future attachment uploads; lifecycle policy.
- **Scheduling:** ECS scheduled task or EventBridge for reconciliation (e.g., every 6 hours).
- **Guardrails:** WAF (optional), rate limiting, daily cap in the database, least-privilege
  IAM task role, no public DB access.
- **CI/CD:** GitHub Actions: install, test, typecheck, lint, build image, push to ECR, deploy
  ECS service with migrations as a one-off task.

## 14. Open items for the user

1. Create a Google Cloud project and OAuth web client; put the client ID/secret in `.env`.
2. Confirm the live test recipient (default: the connected Gmail address).
3. Confirm attachment cap and allowed types (default: 20 MB total, common document types).
4. Confirm audit retention period and whether message bodies may be stored in Postgres.
5. For the Workspace phase: confirm the mailbox alias/send-as and admin access.
6. For AWS: confirm account, region, domain, and whether Cognito or ALB auth is required.
