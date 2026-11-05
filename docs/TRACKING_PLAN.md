# Email Tracking Delivery Plan

Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked

Working plan for open, read-receipt, bounce, and soft/hard-bounce tracking. Update this file
when a task changes state so the next session can resume without rediscovering context.

## 1. Goal and constraints

Record and expose these states per send:

- **Open**: first/last open time and open count from the 1x1 pixel.
- **Read**: read-receipt evidence from Workspace/MDN metadata or an ESP/Workspace webhook.
- **Bounce**: DSN detection in the sender inbox plus webhook ingestion.
- **Soft bounce / deferred**: transient delivery failures, with first/last/count.
- **Hard bounce**: permanent failure classification, never downgraded by later soft evidence.

Constraints:

- `gmail.metadata` cannot read DSN/MDN bodies or use Gmail `q` search. Classification uses
  headers and subject text only; SMTP codes are accepted from webhooks.
- Gmail API cannot prove delivery, open, or read. Every event keeps its `source` so the
  evidence strength is explicit.
- Gmail sync runs automatically every 30 minutes by default
  (`TRACKING_SYNC_INTERVAL_MINUTES`), plus manual UI/API sync. Delivery events still require a
  Workspace/BigQuery bridge or ESP webhook.

## 2. Current architecture

| Layer | File | Responsibility |
| --- | --- | --- |
| Event names | `src/domain/tracking.ts` | Event/source unions, tracking IDs, link decoration |
| Persistence | `src/db/schema.ts`, `migrations/` | `tracking_events`, denormalized send columns |
| Event store | `src/repositories/tracking-repository.ts` | Dedupe, `applyToSend` projection |
| Orchestration | `src/services/tracking-service.ts` | Pixel/ack/webhook/sync |
| Gmail evidence | `src/providers/gmail/gmail-tracking-provider.ts` | DSN/MDN/reply metadata matching |
| Public API | `src/http/routes/tracking.ts` | `/t/open`, `/t/ack`, `/api/tracking/*` |
| UI | `web/src/components/*` | Badges, detail timestamps, dashboard counts |
| Docs | `docs/EMAIL_TRACKING_SETUP.md` | Operator setup, limits, webhook contract |

## 3. Tasks

### A. Foundations

- [x] A1. Add `tracking_id` plus `tracking_events` table and migration.
- [x] A2. Add event types: `DELIVERED`, `DEFERRED`, `BOUNCED`, `OPENED`, `READ`,
  `ACKNOWLEDGED`, `REPLIED`, `COMPLAINED`.
- [x] A3. Idempotent event recording via `(sendId, eventType, source, providerEventId)`.
- [x] A4. Authenticated webhook with timing-safe secret comparison.
- [x] A5. Tracking ID and link decoration for HTML/text bodies.

### B. Open tracking

- [x] B1. 1x1 GIF pixel endpoint at `/t/open/:trackingId`.
- [x] B2. Record `OPENED` events with user agent; keep first/last/count.
- [x] B3. Show open badges and timestamps in the UI.
- [x] B4. Export `opened_at`, `last_opened_at`, `open_count` in CSV.
- [x] B5. Document Gmail image-proxy limits.

### C. Read-receipt tracking

- [x] C1. Add `Disposition-Notification-To`, `Return-Receipt-To`, `X-Confirm-Reading-To`.
- [x] C2. Detect MDN-like messages from Gmail inbox metadata and record `READ`.
- [x] C3. Accept `READ` from the webhook and project `read_at`.
- [x] C4. Document the Workspace read-receipt prerequisite.
- [x] C5. Show `readAt` in UI and CSV.
- [ ] C6. Exercise a live MDN against a real recipient client (manual, requires Workspace).

### D. Bounce tracking

- [x] D1. Detect and match DSNs by `In-Reply-To`/`References` or `X-Failed-Recipients`.
- [x] D2. Record `BOUNCED` with failed recipients and source `gmail_dsn`.
- [x] D3. Classify hard vs soft from DSN headers/subject (metadata-safe heuristics).
- [x] D4. Accept `bounceType` and SMTP status from webhook payloads.
- [x] D5. Never downgrade a hard bounce; upgrade soft/unknown when hard evidence arrives.
- [x] D6. Persist deferred/soft-bounce evidence: `deferred_at`, `last_deferred_at`,
  `deferred_count` (migration `0002_odd_clea.sql`).
- [x] D7. Show hard, soft, and deferred states in badges/detail/dashboard.
- [x] D8. Add bounce/deferred fields to summary API and CSV export.

### E. Tests and verification

- [x] E1. Unit tests for DSN/MDN/reply detection and pixel/ack/webhook flows.
- [x] E2. Unit tests for hard/soft classification and status precedence.
- [x] E3. Integration tests for deferred projection and hard-bounce precedence.
- [x] E4. UI tests for hard/soft/deferred badges.
- [x] E5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (167 passed,
  1 live test skipped).
- [ ] E6. Live smoke: send mail, open, ack, bounce to a known-bad address, run sync. Metadata
  sync against the connected mailbox was exercised without errors; the bounce/MDN part still
  needs a test recipient.

### F. Documentation and operations

- [x] F1. Setup guide, webhook contract, privacy, and troubleshooting.
- [x] F2. Update README, PLAN, and the opencode skill.
- [x] F3. Keep this plan's status current after every change.
- [x] F4. Background Gmail sync scheduler, default 30 minutes; configurable/disableable.
- [ ] F5. Future: delivery-event bridge for Workspace/BigQuery or ESP webhooks.

## 4. Hard/soft classification rules

Metadata-only DSN classification (first match wins):

1. Explicit `bounceType` in a webhook payload: `hard` or `soft`, case-insensitive.
2. SMTP status in payload: `5xx` = hard, `4xx` = soft.
3. Subject/header text:
   - Hard: `failure`, `failed`, `undeliverable`, `returned to sender`, `permanent`,
     `rejected`, `blocked`, `address not found`, `does not exist`, `5.1.1`, `550`.
   - Soft: `delay`, `delayed`, `temporary`, `deferred`, `retrying`, `will retry`, `4.x`, `450`.
4. Otherwise `unknown`.
5. `applyToSend` keeps `bounceType = hard` once set; later soft/unknown evidence cannot
   downgrade it.

## 5. Acceptance checklist

- [x] A hard bounce sets `bouncedAt` and `bounceType = hard`.
- [x] A delayed DSN sets `DEFERRED`, `deferredAt`, `lastDeferredAt`, and increments
  `deferredCount` without setting `bouncedAt`.
- [x] A later hard bounce upgrades an earlier soft/unknown bounce.
- [x] Dashboard summary reports total, hard, soft, and deferred counts.
- [x] UI badges distinguish hard bounce, soft bounce, and deferred.
- [x] CSV export includes deferred fields and bounce type.
- [x] Automatic Gmail sync runs every 30 minutes by default and can be disabled with
  `TRACKING_SYNC_INTERVAL_MINUTES=0`.
- [x] Status/test matrix documents every send and tracking state and how to exercise it.
- [x] Typecheck, lint, tests, and build pass.
- [x] Live MDN and DSN checks are documented as manual/live-only.

## 6. Session log

- 2026-11-05: Audited the existing tracking layer. Added metadata-safe DSN hard/soft
  classification, deferred projection and migration, hard-bounce precedence, summary/CSV
  fields, UI badge/detail/dashboard updates, and tests. Read-receipt matching also accepts
  `Read receipt:`-prefixed subjects. Metadata sync against the live mailbox returned
  `checked: 1, events: 0, errors: 0`. Remaining: live bounce/MDN exercise with a test recipient.

## 7. Resume instructions

1. Read section 3; start at the first `[~]` or `[ ]` task.
2. Keep the metadata-scope constraint: no Gmail `q` search and no body reads.
3. Run `npm run db:generate` after schema edits, then `npm run db:migrate`.
4. Update this file and `docs/PLAN.md` when a task moves to done.
5. Report what changed, what passed, and what remains.
