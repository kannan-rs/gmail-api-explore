import { createServer } from 'node:http';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { loadConfig } from '../src/config';
import { GMAIL_OAUTH_SCOPES } from '../src/providers/gmail/oauth';

const config = loadConfig();

if (!config.googleConfigured) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const redirect = new URL(config.googleRedirectUri);
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!loopbackHosts.has(redirect.hostname)) {
  console.error('GOOGLE_REDIRECT_URI must point to localhost for this helper.');
  console.error('Set it to http://localhost:3000/api/auth/google/callback, then retry.');
  process.exit(1);
}

const port = Number(redirect.port || (redirect.protocol === 'https:' ? 443 : 80));
const callbackPath = redirect.pathname;
const client = new OAuth2Client(
  config.googleClientId,
  config.googleClientSecret,
  config.googleRedirectUri,
);
const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: true,
  scope: [...GMAIL_OAUTH_SCOPES],
});

let finished = false;

function finish(exitCode: number): void {
  if (finished) {
    return;
  }
  finished = true;
  server.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 1_000).unref();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== callbackPath) {
    response.writeHead(404).end('Not found');
    return;
  }

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (error) {
    response.writeHead(400).end(`Authorization failed: ${error}`);
    finish(1);
    return;
  }
  if (!code) {
    response.writeHead(400).end('Missing authorization code');
    return;
  }

  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Remove the app from your Google account and retry.',
      );
    }

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    response
      .writeHead(200, { 'content-type': 'text/plain' })
      .end('Authorization complete. You can close this window and return to the terminal.');

    console.log('');
    console.log(`Mailbox: ${data.email ?? 'unknown'}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('');
    console.log('Add this value to .env, then restart the app.');
    finish(0);
  } catch (error) {
    response.writeHead(500).end('Token exchange failed. Check the terminal for details.');
    console.error(error instanceof Error ? error.message : error);
    finish(1);
  }
});

server.on('error', (error) => {
  console.error(`Could not start the callback server on port ${port}: ${error.message}`);
  console.error('Stop the API if it is using this port, then retry.');
  process.exit(1);
});

const listenHost = redirect.hostname === '::1' ? '::1' : '127.0.0.1';

server.listen(port, listenHost, () => {
  console.log(`1. Stop the API if it is using port ${port}.`);
  console.log('2. Open this URL and approve access:');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log(`Waiting for the callback at ${config.googleRedirectUri} ...`);
});
