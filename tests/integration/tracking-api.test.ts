import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppConfig, loadConfig } from '../../src/config';
import type { Database } from '../../src/db/client';
import { buildApp } from '../../src/http/app';
import { GmailOAuthService } from '../../src/providers/gmail/oauth';
import type {
  ProviderTrackingEvent,
  TrackingCollectInput,
  TrackingProvider,
} from '../../src/providers/tracking-provider';
import { ClientRepository } from '../../src/repositories/client-repository';
import { CredentialRepository } from '../../src/repositories/credential-repository';
import { MailboxRepository } from '../../src/repositories/mailbox-repository';
import { SendRepository } from '../../src/repositories/send-repository';
import { CredentialService } from '../../src/services/credential-service';
import { TokenCipher } from '../../src/services/crypto';
import { closeTestDatabase, getTestDatabase, resetTestDatabase } from '../helpers/db';

class FakeTrackingProvider implements TrackingProvider {
  events: ProviderTrackingEvent[] = [];

  async collectEvents(input: TrackingCollectInput): Promise<ProviderTrackingEvent[]> {
    const send = input.sends[0];
    if (!send) {
      return [];
    }
    return this.events.map((event) => ({
      ...event,
      sendId: send.id,
      trackingId: send.trackingId,
    }));
  }
}

let db: Database;
let sends: SendRepository;
let credentialService: CredentialService;
let app: FastifyInstance;
let baseConfig: AppConfig;
let trackingProvider: FakeTrackingProvider;
let send: {
  id: string;
  trackingId: string;
  messageIdHeader: string;
  providerMessageId: string;
};

async function makeApp(): Promise<FastifyInstance> {
  return buildApp({
    config: baseConfig,
    db,
    resolveTrackingProvider: () => trackingProvider,
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
    new TokenCipher(Buffer.alloc(32, 7).toString('base64')),
    oauth,
  );
  baseConfig = {
    ...loadConfig(),
    googleClientId: '',
    googleClientSecret: '',
    googleConfigured: false,
    publicBaseUrl: 'https://track.example.test',
    trackingEnabled: true,
    trackingPixelEnabled: true,
    trackingAcknowledgementEnabled: true,
    readReceiptRequested: true,
    trackingWebhookSecret: 'test-webhook-secret',
    trackingSyncDays: 7,
  };
  trackingProvider = new FakeTrackingProvider();
});

beforeEach(async () => {
  await resetTestDatabase();
  const clients = new ClientRepository(db);
  await clients.create({ id: 'client-01', name: 'Client 01' });
  const connection = await credentialService.saveConnection({
    profile: { email: 'owner@example.com', name: 'Owner' },
    refreshToken: 'refresh-token',
    scopes: ['gmail.send', 'gmail.metadata'],
    tokenType: 'Bearer',
  });
  const messageIdHeader = `<${randomUUID()}@example.com>`;
  const created = await sends.create({
    provider: 'gmail',
    mode: 'direct',
    mailboxId: connection.mailbox.id,
    clientId: 'client-01',
    fromEmail: 'owner@example.com',
    toEmails: ['borrower@example.com'],
    ccEmails: [],
    bccEmails: [],
    subject: 'Loan statement',
    bodyHtml: '<p>Body</p>',
    bodyText: 'Body',
    attachments: [],
    messageIdHeader,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
  });
  await sends.updateStatus(created.id, {
    status: 'VERIFIED',
    providerMessageId: 'gmail-1',
    providerThreadId: 'thread-1',
    providerLabels: ['SENT'],
    errorCode: null,
    errorMessage: null,
    sentAt: new Date(),
    verifiedAt: new Date(),
  });
  send = {
    id: created.id,
    trackingId: created.trackingId,
    messageIdHeader,
    providerMessageId: 'gmail-1',
  };
  trackingProvider = new FakeTrackingProvider();
  app = await makeApp();
});

afterAll(async () => {
  await app?.close();
  await closeTestDatabase();
});

describe('tracking API', () => {
  it('returns a GIF and records an open', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/t/open/${send.trackingId}`,
      headers: { 'user-agent': 'test-agent' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/gif');
    expect(response.rawPayload.length).toBeGreaterThan(0);
    const updated = await sends.findById(send.id);
    expect(updated?.openCount).toBe(1);
    expect(updated?.openedAt).not.toBeNull();
  });

  it('records an acknowledgement and returns HTML', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/t/ack/${send.trackingId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('acknowledgement');
    expect((await sends.findById(send.id))?.acknowledgedAt).not.toBeNull();
  });

  it('returns 404 for an unknown acknowledgement token', async () => {
    const response = await app.inject({ method: 'GET', url: '/t/ack/trk_missing' });
    expect(response.statusCode).toBe(404);
  });

  it('rejects a webhook without the configured secret', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tracking/webhook',
      payload: { trackingId: send.trackingId, eventType: 'DELIVERED' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts an authenticated webhook and records delivery', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tracking/webhook',
      headers: { 'x-tracking-secret': 'test-webhook-secret' },
      payload: {
        trackingId: send.trackingId,
        eventType: 'DELIVERED',
        providerEventId: 'webhook-1',
        payload: { source: 'workspace' },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ recorded: true, sendId: send.id });
    expect((await sends.findById(send.id))?.deliveredAt).not.toBeNull();
  });

  it('syncs tracking events through the configured provider', async () => {
    trackingProvider.events = [
      {
        sendId: '',
        trackingId: '',
        eventType: 'READ',
        source: 'webhook',
        providerEventId: 'sync-read',
        occurredAt: new Date(),
        payload: {},
      },
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/api/tracking/sync',
      payload: { days: 7 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      checked: 1,
      events: 1,
      recorded: 1,
      duplicates: 0,
      errors: 0,
    });
    expect((await sends.findById(send.id))?.readAt).not.toBeNull();
  });

  it('returns tracking events and public links on send detail', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tracking/webhook',
      headers: { 'x-tracking-secret': 'test-webhook-secret' },
      payload: { trackingId: send.trackingId, eventType: 'DELIVERED', providerEventId: 'detail-1' },
    });

    const response = await app.inject({ method: 'GET', url: `/api/sends/${send.id}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.trackingEvents).toHaveLength(1);
    expect(body.trackingLinks.acknowledgeUrl).toBe(
      `https://track.example.test/t/ack/${send.trackingId}`,
    );
  });

  it('returns no tracking data in the ledger when tracking is disabled', async () => {
    const disabledApp = await buildApp({
      config: { ...baseConfig, trackingEnabled: false },
      db,
      resolveTrackingProvider: () => trackingProvider,
    });

    const response = await disabledApp.inject({ method: 'GET', url: `/api/sends/${send.id}` });
    expect(response.json().trackingLinks).toBeNull();
    await disabledApp.close();
  });
});
