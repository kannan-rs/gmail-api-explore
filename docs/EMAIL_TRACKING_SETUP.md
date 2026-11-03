# Email Tracking Setup

This guide explains how to turn on the tracking layer, what Gmail can and cannot prove, and how
to feed delivery and engagement events into the ledger.

The short version: Gmail can prove **accepted/sent**, not **delivered**, **opened**, or **read**.
The app records those later states only when another source supplies evidence: a tracking pixel,
an acknowledgement link, Gmail metadata sync, a Workspace/BigQuery bridge, or an ESP webhook.

## 1. What can be recorded

| State | Source | Reliable? | Notes |
| --- | --- | --- | --- |
| Sent / accepted by Gmail | Gmail API + `SENT` label + `Message-ID` | Yes | This is the existing `SENT`/`VERIFIED` ledger status. |
| Delivered | Workspace Email Log Search/BigQuery or ESP webhook | Source-dependent | The Gmail API does not expose per-message delivery. |
| Bounce | DSN in the sender inbox, or ESP webhook | Metadata sync is best-effort | The app can detect a DSN by sender/subject/headers but cannot read the DSN body with `gmail.metadata`. |
| Deferred / soft bounce | DSN subject such as “Delayed Mail”, or webhook | Best-effort | Recorded as `DEFERRED`. |
| Open | 1x1 tracking pixel | No | Gmail image proxy/caching can pre-fetch or cache the pixel. Treat opens as a signal, not proof. |
| Read / read receipt | Workspace read-receipt setting, recipient MDN, or webhook | Workspace/recipient-dependent | The Gmail API does not expose read receipts. The app adds standard request headers, but Gmail may ignore them. |
| Acknowledged | “Confirm receipt” link click | Yes, for the click | Proves someone opened the link, not who or that they read the message. |
| Replied | Gmail thread metadata | Yes, if the reply stays in the thread | A new thread or a different mailbox is not matched. |
| Complaint | ESP webhook or domain-level Postmaster data | Source-dependent | Postmaster Tools is domain-level, not per-message. |

## 2. Choose a public base URL

Pixel and acknowledgement links must be reachable by the recipient. `localhost` works only for
local tests where the recipient is on the same machine.

For a local experiment, use an HTTPS tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
# or: ngrok http 3000
```

Set `PUBLIC_BASE_URL` to the tunnel URL. Keep the tunnel open while testing. Stop it afterwards.

For production, use a real HTTPS deployment:

```dotenv
PUBLIC_BASE_URL=https://gmail-tracker.example.com
```

Do not expose the local V1 app to the public internet without application authentication,
rate limiting, and a privacy review. The local app has no login.

## 3. Configure the application

Add these values to `.env`:

```dotenv
PUBLIC_BASE_URL=https://your-public-url.example.com
TRACKING_ENABLED=true
TRACKING_PIXEL_ENABLED=true
TRACKING_ACK_ENABLED=true
READ_RECEIPT_REQUESTED=true
TRACKING_WEBHOOK_SECRET=replace-with-a-long-random-secret
TRACKING_SYNC_DAYS=7
```

Generate a webhook secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Notes:

- `PUBLIC_BASE_URL` falls back to `APP_BASE_URL` when empty.
- `TRACKING_ENABLED=false` disables link/body decoration and hides tracking links.
- `TRACKING_PIXEL_ENABLED=false` disables the open pixel only.
- `TRACKING_ACK_ENABLED=false` disables the acknowledgement link only.
- `READ_RECEIPT_REQUESTED=true` adds request headers to outgoing MIME.
- `TRACKING_WEBHOOK_SECRET` empty disables `/api/tracking/webhook`.
- `TRACKING_SYNC_DAYS` is the default lookback for Gmail metadata sync, capped at 30 days.

## 4. Apply the database migration

```bash
npm run db:migrate
```

The migration adds `tracking_id`, denormalized tracking timestamps/counts, and the
`tracking_events` table. Existing rows are backfilled with a generated `trk_...` ID.

Start the app:

```bash
npm run dev
```

## 5. Send a test message

1. Open `http://localhost:5173`.
2. Compose a message to the connected mailbox or a test recipient.
3. Send it and open **Sends**.
4. Open the send detail. You should see:
   - a `Tracking ID` such as `trk_...`;
   - a tracking section with empty timestamps;
   - an acknowledgement link when acknowledgement tracking is enabled.
5. In Gmail, open the delivered message. The footer contains the tracking ID, a “Confirm
   receipt” link, and a hidden pixel.
6. Click the acknowledgement link. The ledger should set `acknowledgedAt` and add an
   `ACKNOWLEDGED` event.
7. If the message is opened with images loaded, the pixel may set `openedAt`, `lastOpenedAt`,
   and increment `openCount`.

You can also call the endpoints directly:

```bash
curl -i "https://your-public-url.example.com/t/open/trk_REPLACE_ME"
curl -i "https://your-public-url.example.com/t/ack/trk_REPLACE_ME"
```

The pixel always returns a GIF. The acknowledgement endpoint returns a small HTML page.

## 6. Enable read receipts in Google Workspace

Read receipts are a Google Workspace feature. They are not available for personal Gmail
accounts, and the Gmail API does not expose per-message read receipts.

For a company-owned Workspace domain:

1. Sign in to the Google Admin console as an administrator.
2. Open **Apps → Google Workspace → Gmail → User settings**.
3. Select the organizational unit (OU) or group that contains the sending mailbox.
4. Find **Email read receipts** and turn it on.
5. Save the setting.
6. In Gmail, the user may also need to allow read receipts in Gmail settings.
7. The recipient’s mail client must support and accept the read-receipt request. A recipient can
   decline.

The app adds these headers to outgoing MIME when `READ_RECEIPT_REQUESTED=true`:

- `Disposition-Notification-To`
- `Return-Receipt-To`
- `X-Confirm-Reading-To`

These headers are best-effort. Gmail and other clients may ignore them, and a read receipt is
not guaranteed. If you need contractual proof of reading, use an acknowledgement link or a
separate workflow.

If a read receipt arrives as a message in the sender inbox, the Gmail metadata sync can detect
it by subject/headers and record a `READ` event. It cannot read the MDN body with
`gmail.metadata`.

## 7. Sync Gmail bounces, receipts, and replies

Use **Sync Gmail** in the Sends panel or Dashboard, or call:

```bash
curl -X POST http://127.0.0.1:3000/api/tracking/sync \
  -H "Content-Type: application/json" \
  -d '{"days":7}'
```

The sync:

- Uses the existing `gmail.metadata` scope; it does not read message bodies.
- Searches the inbox for DSN/bounce-like messages and read-receipt-like messages.
- Matches them to ledger sends by `In-Reply-To`, `References`, `Message-ID`, or Gmail thread.
- Scans recent threads for replies when a send has a thread ID and no reply yet.
- Records `BOUNCED`, `DEFERRED`, `READ`, or `REPLIED` events.
- Deduplicates repeated Gmail message IDs.

Limitations:

- A DSN must still be in the mailbox and match a ledger send.
- The sync cannot read the DSN body, so SMTP status codes and diagnostic text are not captured.
  The event payload includes `failedRecipients` and a note to open the Gmail message for details.
- A reply in a new thread is not matched.
- A read receipt that does not reference the original message may not be matched.
- Gmail search and thread reads consume Gmail API quota.

## 8. Feed delivered and engagement events from Workspace or an ESP

The most reliable delivery source is Google Workspace Email Log Search or a BigQuery export,
or an ESP that already receives delivery/open/click webhooks.

### Workspace Email Log Search

1. Open the Google Admin console.
2. Go to **Reporting → Email Log Search** (menu names vary by Workspace edition).
3. Search by sender, recipient, subject, or Message-ID.
4. Use the delivery status and message details for investigation.
5. Export or reconcile the results into the ledger.

Email Log Search is not a real-time application API and is retained for a limited window
(typically 30 days). For longer retention or automation, use the Workspace BigQuery export and
build a bridge job.

### Workspace BigQuery bridge

A bridge job should:

1. Read Gmail log rows from the company’s BigQuery export.
2. Map each row to a ledger send using `Message-ID`, Gmail message ID, or tracking ID.
3. POST a normalized event to `/api/tracking/webhook`.
4. Store the original row or a hash in `providerEventId` so retries are idempotent.

Do not assume a fixed BigQuery schema. Confirm the current export schema with IT before writing
the query.

### Webhook contract

Endpoint:

```text
POST /api/tracking/webhook
x-tracking-secret: <TRACKING_WEBHOOK_SECRET>
Content-Type: application/json
```

Body:

```json
{
  "trackingId": "trk_...",
  "eventType": "DELIVERED",
  "occurredAt": "2026-11-03T12:00:00.000Z",
  "providerEventId": "workspace-log-123",
  "payload": {
    "source": "workspace-bigquery",
    "recipient": "borrower@example.com"
  }
}
```

You can identify the send with any one of:

- `trackingId`
- `messageIdHeader` (the RFC 5322 `Message-ID`)
- `providerMessageId` (the Gmail message ID)

Allowed `eventType` values:

```text
DELIVERED, DEFERRED, BOUNCED, OPENED, READ, ACKNOWLEDGED, REPLIED, COMPLAINED
```

Examples:

```bash
curl -X POST http://127.0.0.1:3000/api/tracking/webhook \
  -H "Content-Type: application/json" \
  -H "x-tracking-secret: $TRACKING_WEBHOOK_SECRET" \
  -d '{
    "messageIdHeader": "<abc@example.com>",
    "eventType": "DELIVERED",
    "providerEventId": "esp-delivery-001",
    "payload": {"source": "esp"}
  }'
```

```bash
curl -X POST http://127.0.0.1:3000/api/tracking/webhook \
  -H "Content-Type: application/json" \
  -H "x-tracking-secret: $TRACKING_WEBHOOK_SECRET" \
  -d '{
    "trackingId": "trk_REPLACE_ME",
    "eventType": "BOUNCED",
    "providerEventId": "esp-bounce-001",
    "payload": {"bounceType": "hard", "smtpStatus": "550"}
  }'
```

Responses:

- `202` with `{ "recorded": true, "sendId": "..." }` when a new event is stored.
- `202` with `{ "recorded": false, "reason": "duplicate" }` for a repeated
  `(sendId, eventType, source, providerEventId)`.
- `202` with `{ "recorded": false, "reason": "send_not_found" }` when no send matches.
- `401` for a missing or wrong secret.
- `503` when `TRACKING_WEBHOOK_SECRET` is empty.

## 9. Bounce handling and deliverability

- A bounce is usually a DSN in the sender inbox, not a Gmail API error.
- Hard bounces should remove or suppress the recipient after review.
- Soft bounces may be temporary; do not treat every `DEFERRED` event as a permanent failure.
- The app records `bounceType` from the webhook payload. Gmail metadata sync uses `soft` for a
  delayed-mail subject and `unknown` otherwise because it cannot read the DSN body.
- Publish SPF, DKIM, and DMARC for the sending domain.
- Use Google Postmaster Tools for domain reputation, authentication, and spam-rate signals.
- Warm up new domains/mailboxes and keep complaint rates low.

## 10. Acceptance checklist

- [ ] `PUBLIC_BASE_URL` is reachable from a different network.
- [ ] Migration applied; new sends have a `tracking_id`.
- [ ] A sent message contains the tracking footer and hidden pixel.
- [ ] Clicking the acknowledgement link records `ACKNOWLEDGED`.
- [ ] The open endpoint returns a GIF and records `OPENED` when requested.
- [ ] Gmail metadata sync runs without a scope error.
- [ ] A test DSN is detected as `BOUNCED` or `DEFERRED`.
- [ ] A reply in the same thread is detected as `REPLIED`.
- [ ] A webhook with the correct secret records `DELIVERED`.
- [ ] A repeated webhook with the same `providerEventId` is a duplicate, not a second event.
- [ ] CSV export includes tracking columns.
- [ ] Read-receipt behavior is tested with the actual recipient client and Workspace policy.

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Pixel/ack URL is `localhost` in a remote message | `PUBLIC_BASE_URL` not set or not reachable | Set an HTTPS tunnel/production URL and resend |
| No open recorded | Images blocked, Gmail proxy cached the pixel, or tracking disabled | Treat opens as best-effort; check `TRACKING_PIXEL_ENABLED` |
| No read receipt | Personal Gmail, Workspace setting off, recipient declined, or client ignored headers | Enable the Workspace setting; use an acknowledgement link for proof |
| Sync returns `GMAIL_AUTH` or 403 | Missing `gmail.metadata` consent or admin block | Reconnect and allow the scope; check Admin console app access |
| Sync records no bounces | DSN not in inbox, outside lookback, or no matching reference | Increase `days` (max 30), keep DSNs in the inbox, open the message manually |
| Bounce type is `unknown` | Metadata sync cannot read the DSN body | Use an ESP/Workspace bridge with `bounceType` in the payload |
| Webhook returns 503 | `TRACKING_WEBHOOK_SECRET` is empty | Set the secret and restart |
| Webhook returns 401 | Header missing or wrong | Send `x-tracking-secret` exactly |
| Webhook returns `send_not_found` | Wrong tracking ID/Message-ID/provider ID | Check the send detail and resend with the correct identifier |
| Duplicate event | Same provider event ID was already stored | Expected; use a stable unique ID |
| Tracking links missing from detail | Tracking disabled | Set `TRACKING_ENABLED=true` and restart |

## 12. Privacy and retention

- Opens and acknowledgement clicks are personal data. Define a lawful basis, retention period,
  and access policy before production.
- The pixel records a user agent by default. It does not store the recipient IP address.
- The acknowledgement page does not identify the clicker.
- Tracking endpoints are public by design. Add rate limiting and abuse monitoring before a
  public deployment.
- The webhook secret protects ingestion, not the pixel/ack endpoints.
- Do not put sensitive data in `payload`; it is stored as JSONB in the ledger.
- Use HTTPS for `PUBLIC_BASE_URL`; never send tracking links over plain HTTP in production.

## 13. Known limits

- Gmail API cannot report delivery, bounce, open, read, or complaint events per message.
- Read receipts are Workspace-only and are not exposed through the Gmail API.
- Gmail’s image proxy can make opens unreliable.
- Gmail metadata sync cannot read DSN or MDN bodies.
- There is no background scheduler yet; sync is manual via the UI or API.
- A recipient can forward the message or click the acknowledgement link from a shared inbox;
  the event proves the link was opened, not who opened it.
