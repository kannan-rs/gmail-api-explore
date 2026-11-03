import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppConfig, loadConfig } from '../../src/config';
import type { Database } from '../../src/db/client';
import { ProviderError } from '../../src/domain/errors';
import { buildApp } from '../../src/http/app';
import type {
  EmailProvider,
  OutgoingEmail,
  ProviderMessageLookup,
  ProviderSendResult,
  ProviderVerification,
} from '../../src/providers/email-provider';
import { GmailOAuthService } from '../../src/providers/gmail/oauth';
import { ClientRepository } from '../../src/repositories/client-repository';
import { CredentialRepository } from '../../src/repositories/credential-repository';
import { MailboxRepository } from '../../src/repositories/mailbox-repository';
import { SendRepository } from '../../src/repositories/send-repository';
import { CredentialService } from '../../src/services/credential-service';
import { TokenCipher } from '../../src/services/crypto';
import { closeTestDatabase, getTestDatabase, resetTestDatabase } from '../helpers/db';

const IDEMPOTENCY_KEY = '99999999-9999-4999-8999-999999999999';
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

class FakeProvider implements EmailProvider {
  readonly name = 'gmail' as const;
  sendCalls: OutgoingEmail[] = [];
  sendImpl: (email: OutgoingEmail) => Promise<ProviderSendResult> = async () => ({
    provider: 'gmail',
    providerMessageId: 'gmail-api-1',
    providerThreadId: 'thread-api-1',
    labels: ['SENT'],
  });
  verifyImpl: (
    providerMessageId: string,
    expectedMessageId: string,
    expectedFrom: string,
  ) => Promise<ProviderVerification> = async (
    _providerMessageId,
    expectedMessageId,
    expectedFrom,
  ) => ({
    verified: true,
    labels: ['SENT'],
    headers: { 'message-id': expectedMessageId, from: expectedFrom },
    reason: null,
  });
  lookupImpl: () => Promise<ProviderMessageLookup> = async () => ({
    found: false,
    providerMessageId: null,
    providerThreadId: null,
    labels: [],
  });

  async send(email: OutgoingEmail): Promise<ProviderSendResult> {
    this.sendCalls.push(email);
    return this.sendImpl(email);
  }

  async verifySent(
    providerMessageId: string,
    expectedMessageId: string,
    expectedFrom: string,
  ): Promise<ProviderVerification> {
    return this.verifyImpl(providerMessageId, expectedMessageId, expectedFrom);
  }

  async findByMessageId(): Promise<ProviderMessageLookup> {
    return this.lookupImpl();
  }
}

let db: Database;
let sends: SendRepository;
let credentialService: CredentialService;
let baseConfig: AppConfig;
let provider: FakeProvider;
let app: FastifyInstance;

const sendBody = (overrides: Record<string, unknown> = {}) => ({
  clientId: 'client-01',
  to: 'borrower@example.com',
  cc: ['ops@example.com'],
  subject: 'Loan statement',
  html: '<p>Hello borrower</p>',
  idempotencyKey: IDEMPOTENCY_KEY,
  ...overrides,
});

async function connectMailbox(): Promise<void> {
  await credentialService.saveConnection({
    profile: { email: 'owner@example.com', name: 'Owner' },
    refreshToken: 'refresh-token',
    scopes: ['gmail.send', 'gmail.metadata'],
    tokenType: 'Bearer',
  });
}

async function makeApp(config: AppConfig = baseConfig): Promise<FastifyInstance> {
  return buildApp({
    config,
    db,
    resolveProvider: () => provider,
  });
}

beforeAll(async () => {
  const connection = await getTestDatabase();
  db = connection.db;
  sends = new SendRepository(db);
  const mailboxes = new MailboxRepository(db);
  const credentials = new CredentialRepository(db);
  const oauth = new GmailOAuthService({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/api/auth/google/callback',
  });
  credentialService = new CredentialService(
    mailboxes,
    credentials,
    new TokenCipher(TEST_KEY),
    oauth,
  );
  baseConfig = { ...loadConfig(), dailySendLimit: 1000 };
  provider = new FakeProvider();
});

beforeEach(async () => {
  await resetTestDatabase();
  const clients = new ClientRepository(db);
  await clients.create({ id: 'client-01', name: 'Client 01' });
  await connectMailbox();
  provider = new FakeProvider();
  app = await makeApp();
});

afterAll(async () => {
  await app?.close();
  await closeTestDatabase();
});

describe('health and auth API', () => {
  it('reports database and Gmail configuration status', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      database: 'ok',
      gmail: 'not_configured',
      mailbox: 'owner@example.com',
    });
  });

  it('reports the connected mailbox without returning credentials', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: false,
      connected: true,
      mailbox: { email: 'owner@example.com', provider: 'gmail' },
    });
    expect(response.body).not.toContain('refresh-token');
  });

  it('reports disconnected after disconnect', async () => {
    const disconnect = await app.inject({ method: 'POST', url: '/api/auth/disconnect' });
    expect(disconnect.statusCode).toBe(200);

    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.json()).toMatchObject({ connected: false, mailbox: null });
  });

  it('returns 503 when Google OAuth is not configured', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/google' });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('GOOGLE_NOT_CONFIGURED');
  });

  it('redirects to Google with a signed state cookie when configured', async () => {
    const configuredApp = await makeApp({
      ...baseConfig,
      googleClientId: 'test-client-id',
      googleClientSecret: 'test-client-secret',
      googleConfigured: true,
    });

    const response = await configuredApp.inject({ method: 'GET', url: '/api/auth/google' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
    expect(response.headers['set-cookie']).toContain('gmail_oauth_state=');

    const callback = await configuredApp.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=fake&state=wrong',
      cookies: {
        gmail_oauth_state: String(response.cookies[0]?.value ?? ''),
      },
    });
    expect(callback.statusCode).toBe(401);

    await configuredApp.close();
  });
});

describe('send API', () => {
  it('sends, returns a Gmail link, and exposes list/detail/verify', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sends',
      payload: sendBody(),
    });

    expect(response.statusCode).toBe(201);
    const result = response.json();
    expect(result).toMatchObject({
      duplicate: false,
      verified: true,
      send: { status: 'VERIFIED', providerMessageId: 'gmail-api-1' },
    });
    expect(result.gmailUrl).toContain('#sent/gmail-api-1');
    expect(provider.sendCalls).toHaveLength(1);

    const list = await app.inject({ method: 'GET', url: '/api/sends' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ total: 1, page: 1, pageSize: 20 });

    const detail = await app.inject({ method: 'GET', url: `/api/sends/${result.send.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().events.map((event: { eventType: string }) => event.eventType)).toEqual([
      'send_started',
      'provider_accepted',
      'verified',
    ]);

    const verify = await app.inject({
      method: 'POST',
      url: `/api/sends/${result.send.id}/verify`,
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ verified: true, send: { status: 'VERIFIED' } });
  });

  it('returns the existing send for a duplicate key without resending', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/sends', payload: sendBody() });
    const second = await app.inject({ method: 'POST', url: '/api/sends', payload: sendBody() });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().send.id).toBe(first.json().send.id);
    expect(provider.sendCalls).toHaveLength(1);
  });

  it('returns 400 for invalid input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sends',
      payload: sendBody({ to: 'not-an-email' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when no Gmail account is connected', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/disconnect' });

    const response = await app.inject({ method: 'POST', url: '/api/sends', payload: sendBody() });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 404 when the client does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sends',
      payload: sendBody({ clientId: 'missing-client' }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('returns 502 with a safe code when the provider fails', async () => {
    provider.sendImpl = async () => {
      throw new ProviderError('Gmail is temporarily unavailable', {
        code: 'GMAIL_UNAVAILABLE',
        retryable: true,
      });
    };

    const response = await app.inject({ method: 'POST', url: '/api/sends', payload: sendBody() });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('GMAIL_UNAVAILABLE');
    expect(response.body).not.toContain('refresh-token');
  });

  it('returns 429 when the daily cap is reached', async () => {
    const cappedApp = await makeApp({ ...baseConfig, dailySendLimit: 1 });

    const first = await cappedApp.inject({
      method: 'POST',
      url: '/api/sends',
      payload: sendBody(),
    });
    const second = await cappedApp.inject({
      method: 'POST',
      url: '/api/sends',
      payload: sendBody({ idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('RATE_LIMIT');

    await cappedApp.close();
  });
});

describe('stats, export, and clients API', () => {
  it('filters sends and reports summary, daily, and client counts', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/sends',
      payload: sendBody({ subject: 'Statement for borrower' }),
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/sends?status=VERIFIED&clientId=client-01&q=statement',
    });
    expect(list.json().total).toBe(1);

    const empty = await app.inject({
      method: 'GET',
      url: '/api/sends?clientId=client-01&q=not-found',
    });
    expect(empty.json().total).toBe(0);

    const summary = await app.inject({ method: 'GET', url: '/api/stats/summary' });
    expect(summary.json()).toMatchObject({
      total: 1,
      sent: 1,
      verified: 1,
      failed: 0,
      inFlight: 0,
    });

    const daily = await app.inject({ method: 'GET', url: '/api/stats/daily?days=7' });
    expect(daily.statusCode).toBe(200);
    expect(daily.json().items).toHaveLength(1);

    const byClient = await app.inject({ method: 'GET', url: '/api/stats/by-client' });
    expect(byClient.json().items).toEqual([
      { clientId: 'client-01', sent: 1, failed: 0, total: 1 },
    ]);
  });

  it('exports CSV with filters and audit fields', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/sends',
      payload: sendBody({ subject: 'Statement, "urgent"' }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/sends/export?clientId=client-01',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment; filename=');
    expect(response.body).toContain('message_id_header');
    expect(response.body).toContain('"Statement, ""urgent"""');
    expect(response.body).toContain('gmail-api-1');
    expect(response.body).not.toContain('refresh-token');
  });

  it('reconciles recent SENT rows through the provider', async () => {
    const sent = await app.inject({ method: 'POST', url: '/api/sends', payload: sendBody() });
    const send = sent.json().send;
    await sends.updateStatus(send.id, {
      status: 'SENT',
      providerMessageId: send.providerMessageId,
      providerThreadId: send.providerThreadId,
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: null,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sends/reconcile',
      payload: { days: 2 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ checked: 1, verified: 1, errors: 0 });
  });

  it('lists and creates clients', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/clients' });
    expect(list.json().items).toEqual([
      expect.objectContaining({ id: 'client-01', name: 'Client 01' }),
    ]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/clients',
      payload: { id: 'client-02', name: 'Client 02' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: 'client-02', name: 'Client 02' });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/clients',
      payload: { id: 'client-01', name: 'Duplicate' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('returns 400 for an invalid send id', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sends/not-a-uuid' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
