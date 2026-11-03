# Google Workspace / Enterprise Enablement Guide

This is the handoff document for an IT/Google Workspace administrator who needs to enable the
Gmail Send Tracker for an enterprise mailbox. It is based on the local Gmail experiment and is
written for a company-owned Google Cloud project.

## What the application needs

The app uses **per-user OAuth 2.0**. It does not use an API key, a service account, or
domain-wide delegation.

- The app connects one Gmail mailbox at a time.
- The mailbox user approves access.
- The app stores an encrypted refresh token.
- Sends go through `users.messages.send` as the authenticated mailbox user.
- Gmail automatically saves the message in **Sent**; the app verifies the `SENT` label and
  `Message-ID` as evidence.
- The app does not read message bodies. It reads labels and selected headers through
  `gmail.metadata`.

## Information IT needs to provide

| Item | Example / requirement |
| --- | --- |
| Company Google Cloud project | A project owned by the company, not a personal account |
| Enterprise mailbox | The Workspace user that will authorize and send |
| `From` address | Must be the connected mailbox or a verified Gmail `sendAs` alias |
| Production app URL | HTTPS URL, for example `https://gmail-tracker.example.com` |
| OAuth redirect URI | `https://gmail-tracker.example.com/api/auth/google/callback` |
| Support contact | Group or user for OAuth consent and operations |
| Cloud region | Region for the eventual AWS/GCP deployment or secret storage |
| DNS owner | Team that can publish SPF, DKIM, and DMARC records |

## 1. Create or select the company project

1. Sign in to the Google Cloud console with a **Workspace administrator** account.
2. Create a project such as `gmail-send-tracker-prod`, or use an approved existing project.
3. Record the **project ID** and **project number**.
4. Enable billing only if company policy requires it for Cloud projects. Gmail API usage in
   this experiment is within the free quota, but quotas and billing rules are controlled by
   the organization.
5. Do not reuse a personal Google Cloud project for enterprise mail.

## 2. Enable the Gmail API

This is a required step. OAuth consent can succeed even when the Gmail API is disabled, but
every Gmail call then fails with HTTP 403 `accessNotConfigured`.

1. Open:

   `https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=<PROJECT_ID>`

2. Confirm the project selector at the top is the company project.
3. Click **Enable**.
4. Confirm **Gmail API** appears under **APIs & Services → Enabled APIs & services**.
5. If it says **Manage**, it is already enabled.
6. Wait 2–5 minutes after first enabling it before testing.

Do not enable it in a different project than the one that owns the OAuth client. The local
experiment failed until the API was enabled in the exact project tied to the OAuth client.

## 3. Configure Google Auth Platform

Open **Google Auth Platform** in the same project. Older consoles call this **APIs & Services
→ OAuth consent screen**.

### Branding

- App name: `Gmail Send Tracker` (or the approved internal name).
- User support email: an IT or operations group.
- Developer contact: an owned group, not a personal address if possible.
- App logo, homepage, privacy policy: follow company policy. Local testing can leave optional
  fields blank.

### Audience

Choose the option that matches the rollout:

| Option | Use when | Notes |
| --- | --- | --- |
| **Internal** | Only company Workspace users will connect | Recommended for a single enterprise mailbox; no external test-user list |
| **External / Testing** | A small pilot with named test users | Add every tester under **Test users**; refresh tokens expire after 7 days |
| **External / Production** | Users outside the company must connect | Google verification may be required for sensitive/restricted scopes |

For an enterprise-only deployment, **Internal** is the simplest and safest choice.

### Data Access scopes

Add exactly these scopes:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.metadata`

Scope meaning:

- `openid`, `email`, `profile`: identify the connected mailbox.
- `gmail.send`: send mail as the authenticated user.
- `gmail.metadata`: verify the `SENT` label, headers, and `Message-ID` without reading body
  content; also used for timeout recovery and reconciliation.

`gmail.send` is classified as sensitive and `gmail.metadata` as restricted. Company policy may
require an exception, admin approval, or Google verification. Do not replace them with broader
scopes without reviewing the code.

## 4. Create the OAuth client

1. Open **Google Auth Platform → Clients → Create client**.
2. Application type: **Web application**.
3. Name: `Gmail Send Tracker` (include the environment, for example `prod`).
4. Authorized JavaScript origins:
   - Production: `https://gmail-tracker.example.com`
   - Local development: `http://localhost:5173`
5. Authorized redirect URIs:
   - Production: `https://gmail-tracker.example.com/api/auth/google/callback`
   - Local development: `http://localhost:3000/api/auth/google/callback`
6. Create the client and copy the **client ID** and **client secret**.

Rules:

- Use a **Web application** client. A Desktop client will not match the server callback.
- The redirect URI must match exactly, including scheme, host, port, and path. No wildcard and
  no trailing slash.
- Production must use HTTPS. Localhost HTTP is only for local development.
- The client secret is a secret. Store it in the company secret manager; never commit it or
  paste it into tickets or chat.

## 5. Allow the app in the Workspace Admin console

The Google Cloud configuration alone may not be enough. A Workspace administrator may need to
allow the OAuth client and its scopes.

1. Open the Google Admin console.
2. Go to **Security → Access and data control → API controls → App access control**.
3. Click **Configure new app** and choose **OAuth App ID**.
4. Enter the OAuth client ID from step 4.
5. Mark the app as **Trusted** (or the approved equivalent) and allow the required scopes.
6. If the organization blocks third-party app access, configure an exception for this client.
7. Confirm the Gmail service is available for the mailbox and that Gmail API access is not
   disabled by an organizational policy.

Exact menu names vary by Workspace edition and console version. Search the Admin console for
**App access control** and **OAuth client ID** if the paths differ.

## 6. Google verification and restricted scopes

- **Internal** apps are limited to the company's Workspace users and are the preferred route
  for this application.
- **External Testing** is only for named test users. The app remains unverified and the test
  users see a warning.
- **External Production** may require OAuth verification because the app requests sensitive
  (`gmail.send`) and restricted (`gmail.metadata`) scopes.
- Verification can take days or weeks and may require a privacy policy and security review.
- Start with a pilot mailbox and plan the verification lead time before a production rollout.

## 7. Prepare the sending mailbox

The connected account must be a real Workspace user that can authorize OAuth. A shared mailbox
or group address that cannot sign in cannot be used directly.

If the required `From` address differs from the mailbox address:

1. In Gmail settings, add the address under **Accounts and Import → Send mail as**.
2. Complete Google's verification for the alias.
3. Confirm the alias is a verified `sendAs` address.
4. The current application sends from the connected mailbox address. Sending from an alias
   requires an application change to select and validate the `sendAs` address; do not assume
   the alias works without that change.

## 8. Configure the application

Set these values in the application environment or secret manager:

```dotenv
NODE_ENV=production
APP_BASE_URL=https://gmail-tracker.example.com
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
GOOGLE_REDIRECT_URI=https://gmail-tracker.example.com/api/auth/google/callback
TOKEN_ENCRYPTION_KEY=<32-byte-base64-key>
COOKIE_SECRET=<random-secret>
DATABASE_URL=<managed-postgres-url>
DAILY_SEND_LIMIT=100
MAX_ATTACHMENT_BYTES=20971520
MAX_ATTACHMENTS=10
GMAIL_API_TIMEOUT_MS=30000
LOG_LEVEL=info
PUBLIC_BASE_URL=https://gmail-tracker.example.com
TRACKING_ENABLED=true
TRACKING_PIXEL_ENABLED=true
TRACKING_ACK_ENABLED=true
READ_RECEIPT_REQUESTED=true
TRACKING_WEBHOOK_SECRET=<long-random-secret>
TRACKING_SYNC_DAYS=7
```

Production requirements:

- Use HTTPS for `APP_BASE_URL` and `GOOGLE_REDIRECT_URI`.
- Store the client secret and encryption key in AWS Secrets Manager, GCP Secret Manager, or
  the approved vault. Do not bake them into the container image.
- Use a managed PostgreSQL database with encryption at rest and backups.
- Add application authentication before exposing the tracker outside the local machine.
- Do not change `TOKEN_ENCRYPTION_KEY` without a migration plan; existing refresh tokens
  become unreadable.

## 9. Tracking, read receipts, and delivery evidence

The app uses the existing `gmail.metadata` scope for tracking. No extra OAuth scope is
required for Gmail DSN, read-receipt-like message, or thread-reply sync.

### Read receipts

Read receipts are a Workspace feature, not a Gmail API feature. The Gmail API does not expose
per-message read receipts.

1. Sign in to the Google Admin console as an administrator.
2. Open **Apps → Google Workspace → Gmail → User settings**.
3. Select the OU or group that contains the sending mailbox.
4. Enable **Email read receipts** and save.
5. Confirm the mailbox user can request read receipts in Gmail settings.
6. Test with the actual recipient mail client; the recipient can decline.

The application adds `Disposition-Notification-To`, `Return-Receipt-To`, and
`X-Confirm-Reading-To` headers when `READ_RECEIPT_REQUESTED=true`. These are best-effort. Gmail
or the recipient client may ignore them. Use the acknowledgement link when you need a recorded
click rather than a read receipt.

### Delivery and bounce evidence

The Gmail API does not expose per-message delivery or bounce events. Choose one or more sources:

- **Email Log Search:** Admin console → **Reporting → Email Log Search**. Use it for
  investigation and export. Retention is limited (typically 30 days).
- **BigQuery export:** enable the Workspace Gmail log export for long-term retention and build
  a bridge job that posts normalized events to `/api/tracking/webhook`.
- **ESP webhook:** if another sending platform sees delivery/bounce/open events, map them to the
  ledger with `trackingId`, `messageIdHeader`, or `providerMessageId`.
- **Gmail metadata sync:** the app can detect DSN-like and read-receipt-like messages in the
  sender inbox and thread replies. It cannot read DSN or MDN bodies with `gmail.metadata`.

### Public tracking URL

Pixel and acknowledgement links must use a publicly reachable HTTPS URL:

```dotenv
PUBLIC_BASE_URL=https://gmail-tracker.example.com
```

Do not use `localhost` for external recipients. Do not expose an unauthenticated local app
directly to the internet.

### Webhook authentication

Set `TRACKING_WEBHOOK_SECRET` to a long random value and send it in the
`x-tracking-secret` header. An empty secret disables the webhook endpoint.

See [EMAIL_TRACKING_SETUP.md](EMAIL_TRACKING_SETUP.md) for the event contract, examples, and
privacy notes.

## 10. Acceptance test

After IT enables the API and client:

1. Start the application and open the production URL.
2. Click **Connect Gmail** and sign in as the enterprise mailbox.
3. Approve the five scopes.
4. Confirm `/api/auth/me` shows the mailbox and no token.
5. Send a test message to the same mailbox.
6. Confirm the UI reaches `SENT` or `VERIFIED`.
7. Open Gmail → **Sent** and confirm the message is present.
8. Click the Gmail Sent link from the UI.
9. Restart the application and confirm the send record persists.
10. Run the live smoke test only after the first manual send succeeds.
11. Send a tracking test and click the acknowledgement link.
12. Run **Sync Gmail** and confirm no scope error.
13. If a webhook bridge is in scope, post a test `DELIVERED` event with the secret.

The Sent copy proves Gmail accepted and stored the message. It does not prove recipient
delivery, inbox placement, opens, or clicks. Delivery evidence must come from Workspace logs,
BigQuery, or an ESP.

## 11. Email security, headers, and DNS certificates

Gmail handles transport security and adds the authentication results after it accepts the
message. The application must not forge these headers.

### Headers set by the application

The MIME builder currently sets the normal message headers:

- `From`, `To`, `Cc`, `Bcc`
- `Subject`
- `Date`
- `Message-ID`
- `MIME-Version`
- `Content-Type`
- `Content-Transfer-Encoding`
- `X-Tracking-ID` when tracking is enabled
- `Disposition-Notification-To`, `Return-Receipt-To`, and `X-Confirm-Reading-To` when read
  receipts are requested

Gmail adds or rewrites transport/authentication headers such as `Received`, `Return-Path`,
`SPF`, `DKIM-Signature`, `DMARC`, and `Authentication-Results`. Do not set these manually.

Optional application headers such as `Reply-To`, `List-Unsubscribe`, or additional custom
`X-` headers require a code change and should be agreed before implementation. Do not forge
SPF, DKIM, DMARC, `Received`, `Return-Path`, or `Authentication-Results` headers.

### SPF

The domain's DNS must authorize Google Workspace. If Google is the only sender, a typical
record is:

```text
v=spf1 include:_spf.google.com ~all
```

If other systems already send for the domain, merge their includes into one SPF record. Never
publish multiple SPF TXT records.

### DKIM

1. Google Admin console → **Apps → Google Workspace → Gmail → Authenticate email**.
2. Select the domain.
3. Generate a 2048-bit DKIM key.
4. Publish the generated TXT record at `google._domainkey.<domain>`.
5. Turn on DKIM authentication.
6. Verify the record with a DNS lookup and send a test message.

### DMARC

Start in monitoring mode with a reporting address:

```text
v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com; pct=100
```

After reviewing reports, move to `p=quarantine` and then `p=reject` according to company
policy. DMARC requires aligned SPF or DKIM.

### TLS certificates

- The web application and OAuth redirect must use a valid HTTPS certificate.
- In AWS, use ACM with an ALB; do not terminate TLS with a self-signed certificate.
- Gmail encrypts transport with TLS where the recipient supports it. This is separate from the
  web application certificate.
- Consider HSTS, MTA-STS, and TLS-RPT only after the basic SPF/DKIM/DMARC setup is stable.
- S/MIME message signing/encryption is a separate capability and is not currently implemented
  by the application.

## 12. Troubleshooting reference

| Error | Meaning | Action |
| --- | --- | --- |
| `Error 403: access_denied` | Account is not an approved tester, or the app is Internal and the account is outside the organization | Add the user as a test user or use the correct Workspace account |
| `redirect_uri_mismatch` | Redirect URI differs from the console | Match scheme, host, port, path, and trailing slash exactly |
| `Google OAuth state is missing or invalid` | OAuth state cookie was not returned; host changed, cookies were cleared, or the server restarted with a different `COOKIE_SECRET` | Use one host consistently, keep the app running, retry |
| `GMAIL_API_DISABLED` / `accessNotConfigured` | Gmail API is not enabled in the OAuth client's project | Enable it in the correct project and wait for propagation |
| `Unable to check Gmail for the previous attempt` | Retry/recovery search also hit the disabled Gmail API | Enable the API, then retry the same key |
| `invalid_grant` | Refresh token expired, revoked, or encryption key changed | Reconnect the mailbox |
| `insufficientPermissions` / Gmail 403 | Scope not granted or blocked by admin policy | Re-consent and allow the client/scopes in Admin console |
| `GMAIL_RATE_LIMIT` | Sending quota exceeded | Wait or review Workspace limits |
| Message absent from Sent | Gmail did not accept the send | Check the ledger error code and Gmail API status |

## 13. Security checklist

- [ ] Company-owned Cloud project, not a personal project.
- [ ] Gmail API enabled in that exact project.
- [ ] Internal audience or approved External rollout.
- [ ] OAuth client is a Web application with exact HTTPS redirect URI.
- [ ] Client secret stored in a secret manager, never in git.
- [ ] `TOKEN_ENCRYPTION_KEY` is 32 random bytes and backed up securely.
- [ ] `COOKIE_SECRET` is random and not shared.
- [ ] Workspace admin has allowed the OAuth client and scopes.
- [ ] Sending mailbox is a real Workspace user; alias is a verified `sendAs` address.
- [ ] SPF, DKIM, and DMARC are configured and monitored.
- [ ] HTTPS certificate is valid; production URL is not HTTP.
- [ ] Application login, rate limiting, and audit retention are defined.
- [ ] Message bodies and recipient data have a retention and access policy.
- [ ] Verification/restricted-scope requirements are understood before production.
- [ ] No API key or service account was created for this per-user flow.

## 14. What IT should return to the application team

Provide only these non-secret or secret-manager references:

- Google Cloud project ID and project number.
- OAuth client ID.
- Secret-manager path/ARN for the client secret.
- Approved production redirect URI and app URL.
- Connected mailbox address and whether a `sendAs` alias is required.
- Confirmation that Gmail API is enabled and the client/scopes are allowed.
- Public tracking URL for pixel/ack links, and the secret-manager path for the webhook secret.
- Whether Email read receipts are enabled for the mailbox OU.
- Email Log Search/BigQuery access and retention for delivery evidence.
- SPF/DKIM/DMARC status and any deliverability constraints.
- Any Workspace policy that blocks third-party apps or Gmail API access.

Never send the client secret or refresh token in chat, email, or a ticket.
