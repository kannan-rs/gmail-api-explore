# Google OAuth and Gmail API Setup

This guide connects a personal Gmail account to the local app. It uses OAuth 2.0 with
`access_type=offline` and stores only the refresh token, encrypted.

For an enterprise Google Workspace mailbox, hand the IT team
[GOOGLE_WORKSPACE_IT_ENABLEMENT.md](GOOGLE_WORKSPACE_IT_ENABLEMENT.md) instead. It covers the
company project, admin allowlisting, restricted scopes, `sendAs` aliases, and SPF/DKIM/DMARC.

## 1. Create a Google Cloud project

1. Open the Google Cloud console and create a project, for example
   `gmail-send-tracker-experiment`.
2. Select the project.
3. Open **APIs & Services → Library**, search for **Gmail API**, and enable it.
4. Open **Google Auth Platform** (older consoles call it **APIs & Services → OAuth
   consent screen**) and click **Get started** if needed.
   - **Branding:** app name `Gmail Send Tracker`, user support email and developer contact
     set to the Gmail account.
   - **Audience:** choose **External**, then add the Gmail address under **Test users**
     while the publishing status is **Testing**.
   - **Data Access:** add these scopes:
     - `openid`
     - `email`
     - `profile`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.metadata`
5. Open **Google Auth Platform → Clients → Create client** (older consoles:
   **APIs & Services → Credentials → Create credentials → OAuth client ID**).
   - Application type: **Web application**.
   - Name: `Gmail Send Tracker local`.
   - Authorized JavaScript origins: `http://localhost:5173`.
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`.
6. Copy the client ID and client secret. Do not use an API key; server-side OAuth needs the
   client ID and client secret.

## 2. Configure the app

Edit `.env`:

```dotenv
APP_BASE_URL=http://localhost:5173
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
# Optional; see "Automatic connection from a refresh token" below.
GOOGLE_REFRESH_TOKEN=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
LIVE_TEST_RECIPIENT=your-test-account@gmail.com
```

Use the same Gmail address for `LIVE_TEST_RECIPIENT` during the experiment so the live test
sends only to the connected mailbox.

Generate the local secrets if they are still empty:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the first value in `TOKEN_ENCRYPTION_KEY` and the second in `COOKIE_SECRET`. The token key
must decode to exactly 32 bytes. Changing `TOKEN_ENCRYPTION_KEY` makes existing stored refresh
tokens unreadable; disconnect and reconnect.

### Automatic connection from a refresh token

The client ID and client secret identify the OAuth app, but they do not authorize a mailbox by
themselves. Gmail requires one consent to issue a refresh token. Obtain it once, then let every
app instance connect automatically:

1. Stop the API if it is using port 3000.
2. Run `npm run auth:token`.
3. Open the printed Google URL, choose the mailbox, and approve the scopes.
4. Copy the printed `GOOGLE_REFRESH_TOKEN` value into `.env`.
5. Restart the app.

On startup the API validates the token with Google, stores it encrypted in Postgres, and
auto-connects the mailbox. If the credential is removed later, the next API request reconnects
from the environment token. The UI shows the mailbox as connected on every browser or laptop
that uses the same API and database, and hides the Disconnect button while
`GOOGLE_REFRESH_TOKEN` is set. If the token changes, update `.env` and restart; the app replaces
the stored credential. Remove `GOOGLE_REFRESH_TOKEN` to return to the one-time UI connection
flow.

For multiple laptops, either share one API/Postgres instance or put the same
`GOOGLE_REFRESH_TOKEN` in each local `.env`. Never commit `.env` or share the token; it grants
access to the mailbox's Gmail send and metadata scopes.

## 3. Start and connect

```bash
nvm use
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

If `GOOGLE_REFRESH_TOKEN` is set, the API connects at startup and the UI opens already
connected. Otherwise, open `http://localhost:5173`, click **Connect Gmail**, choose the test
account, and approve the scopes. If Google says the app is unverified, choose **Advanced → Go
to Gmail Send Tracker (unsafe)**; this is expected for a personal Testing-mode app, and the
account must be listed as a test user. A successful callback returns to the UI with
`?connected=<email>`; the app removes the query parameter after showing the notice.

Check the connection:

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/auth/me
```

`/api/auth/me` returns the mailbox address but never the refresh token.

## 4. Optional tracking configuration

The tracking layer uses the same `gmail.metadata` scope. No additional OAuth scope is
required for Gmail DSN/reply metadata sync. The metadata scope does not support the Gmail
search `q` parameter, so sync lists recent messages by label and filters locally.

Set a public URL if recipients must reach the pixel or acknowledgement link:

```dotenv
PUBLIC_BASE_URL=https://your-tunnel-or-production-url.example.com
TRACKING_ENABLED=true
TRACKING_PIXEL_ENABLED=true
TRACKING_ACK_ENABLED=true
READ_RECEIPT_REQUESTED=true
TRACKING_WEBHOOK_SECRET=replace-with-a-long-random-secret
TRACKING_SYNC_DAYS=7
```

For local testing, an HTTPS tunnel can forward to `http://127.0.0.1:3000`. Do not expose the
unauthenticated local app to the internet. See
[EMAIL_TRACKING_SETUP.md](EMAIL_TRACKING_SETUP.md) for the full tracking workflow and
limitations.

Read receipts require Google Workspace. In the Admin console, open
**Apps → Google Workspace → Gmail → User settings → Email read receipts**, enable it for the
mailbox's OU/group, and save. Personal Gmail does not support this setting. The Gmail API does
not expose read receipts; the app adds request headers as a best-effort signal.

## 5. Send and verify

1. Compose a message to the connected address.
2. Open Gmail → **Sent** and confirm the message is there.
3. In the app, open **Sends**, click **Verify**, and confirm the status becomes `VERIFIED`.
4. Click **Open in Gmail Sent** to check the deep link.

The Sent copy proves Gmail accepted and stored the message. It does not prove recipient
delivery.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `redirect_uri_mismatch` | Console URI does not exactly match `GOOGLE_REDIRECT_URI` | Add `http://localhost:3000/api/auth/google/callback`; no trailing slash |
| `access_blocked` | Account is not a test user | Add the Gmail address under OAuth consent screen test users |
| `invalid_grant` | Refresh token expired, revoked, or key changed | Disconnect, remove app access at Google, reconnect |
| No refresh token returned | Consent reused without offline prompt | The app requests `prompt=consent`; remove app access and reconnect |
| `Google OAuth is not configured` | Client ID/secret empty | Fill both values and restart the API |
| Auto-connect fails with `invalid_grant` | `GOOGLE_REFRESH_TOKEN` expired or revoked | Run `npm run auth:token` again and update `.env` |
| `GMAIL_API_DISABLED` / Gmail API 403 | Gmail API disabled in the OAuth client's project, or scope not granted | Enable Gmail API in that exact project, wait, then retry |
| `Unable to check Gmail for the previous attempt` | Retry/recovery search also hit the disabled Gmail API | Enable the API, then retry the same send |
| Send fails with auth error | Token lifetime or scope problem | Reconnect; inspect the event history for the safe error code |

## Token lifetime

While the OAuth app is in **Testing**, Google expires refresh tokens after 7 days. This applies
to both the UI connection and `GOOGLE_REFRESH_TOKEN`; rerun `npm run auth:token` and update
`.env` when Gmail returns `invalid_grant`. For longer-lived experiments, publish the app or use
a Workspace account and complete Google's verification requirements.

## Revoke access

Use the Google Account permissions page to remove the app, or call the app's disconnect
endpoint:

```bash
curl -X POST http://127.0.0.1:3000/api/auth/disconnect
```

Disconnecting deletes the stored credential. It does not delete the mailbox row or send
history.

## Workspace and production notes

- Workspace deployment may require domain-wide delegation or admin approval.
- The `gmail.metadata` scope is restricted/sensitive and may require Google verification.
- Gmail can only send as the authenticated user or a verified `sendAs` alias.
- Use an HTTPS redirect URI and a real application login before exposing the app beyond
  localhost.
- Confirm the auditor's evidence standard before relying on the Sent copy for a specific
  regulation.
