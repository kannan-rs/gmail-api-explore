import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client';
import { GmailOAuthService } from '../../src/providers/gmail/oauth';
import type { ProviderTrackingEvent } from '../../src/providers/tracking-provider';
import { ClientRepository } from '../../src/repositories/client-repository';
import { CredentialRepository } from '../../src/repositories/credential-repository';
import { MailboxRepository } from '../../src/repositories/mailbox-repository';
import { SendRepository } from '../../src/repositories/send-repository';
import { TrackingRepository } from '../../src/repositories/tracking-repository';
import { CredentialService } from '../../src/services/credential-service';
import { TokenCipher } from '../../src/services/crypto';
import { TrackingService } from '../../src/services/tracking-service';
import { closeTestDatabase, getTestDatabase, resetTestDatabase } from '../helpers/db';

class FakeTrackingProvider {
  events: ProviderTrackingEvent[] = [];

  async collectEvents(): Promise<ProviderTrackingEvent[]> {
    return this.events;
  }
}

let db: Database;
let sends: SendRepository;
let tracking: TrackingRepository;
let credentialService: CredentialService;
let provider: FakeTrackingProvider;
let service: TrackingService;
let mailboxId: string;

async function createSend(): Promise<{
  id: string;
  trackingId: string;
  messageIdHeader: string;
  providerMessageId: string;
}> {
  const messageIdHeader = `<${randomUUID()}@example.com>`;
  const send = await sends.create({
    provider: 'gmail',
    mode: 'direct',
    mailboxId,
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
  await sends.updateStatus(send.id, {
    status: 'VERIFIED',
    providerMessageId: 'gmail-1',
    providerThreadId: 'thread-1',
    providerLabels: ['SENT'],
    errorCode: null,
    errorMessage: null,
    sentAt: new Date(),
    verifiedAt: new Date(),
  });
  return {
    id: send.id,
    trackingId: send.trackingId,
    messageIdHeader,
    providerMessageId: 'gmail-1',
  };
}

beforeAll(async () => {
  const connection = await getTestDatabase();
  db = connection.db;
  sends = new SendRepository(db);
  tracking = new TrackingRepository(db);
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
    new TokenCipher(Buffer.alloc(32, 9).toString('base64')),
    oauth,
  );
  provider = new FakeTrackingProvider();
  service = new TrackingService({
    tracking,
    credentials: credentialService,
    resolveTrackingProvider: () => provider,
  });
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
  mailboxId = connection.mailbox.id;
  provider = new FakeTrackingProvider();
  service = new TrackingService({
    tracking,
    credentials: credentialService,
    resolveTrackingProvider: () => provider,
  });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('TrackingService', () => {
  it('records opens and keeps first-open plus last-open timestamps', async () => {
    const send = await createSend();

    expect(await service.recordOpen(send.trackingId, { userAgent: 'test' })).toBe(true);
    const first = await sends.findById(send.id);
    expect(first?.openedAt).not.toBeNull();
    expect(first?.lastOpenedAt).not.toBeNull();
    expect(first?.openCount).toBe(1);

    expect(await service.recordOpen(send.trackingId, { userAgent: 'test' })).toBe(true);
    const second = await sends.findById(send.id);
    expect(second?.openedAt?.getTime()).toBe(first?.openedAt?.getTime());
    expect(second?.openCount).toBe(2);

    const events = await tracking.getEvents(send.id);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.eventType === 'OPENED')).toBe(true);
    expect(events.every((event) => event.source === 'pixel')).toBe(true);
  });

  it('records an acknowledgement from the public link', async () => {
    const send = await createSend();

    expect(await service.recordAcknowledgement(send.trackingId)).toBe(true);

    const updated = await sends.findById(send.id);
    expect(updated?.acknowledgedAt).not.toBeNull();
    const events = await tracking.getEvents(send.id);
    expect(events[0]?.eventType).toBe('ACKNOWLEDGED');
    expect(events[0]?.source).toBe('ack_link');
  });

  it('returns false for unknown tracking ids', async () => {
    expect(await service.recordOpen('trk_unknown')).toBe(false);
    expect(await service.recordAcknowledgement('trk_unknown')).toBe(false);
  });

  it('records a webhook event and deduplicates by provider event id', async () => {
    const send = await createSend();

    const first = await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'DELIVERED',
      providerEventId: 'evt-1',
      payload: { source: 'workspace-bigquery' },
    });
    expect(first.recorded).toBe(true);
    expect((await sends.findById(send.id))?.deliveredAt).not.toBeNull();

    const second = await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'DELIVERED',
      providerEventId: 'evt-1',
    });
    expect(second.recorded).toBe(false);
    expect(second.reason).toBe('duplicate');
    expect(await tracking.getEvents(send.id)).toHaveLength(1);
  });

  it('matches webhook events by message id and provider message id', async () => {
    const send = await createSend();

    const byMessageId = await service.recordWebhook({
      messageIdHeader: send.messageIdHeader,
      eventType: 'READ',
      providerEventId: 'evt-read',
    });
    expect(byMessageId.recorded).toBe(true);

    const byProviderId = await service.recordWebhook({
      providerMessageId: send.providerMessageId,
      eventType: 'BOUNCED',
      providerEventId: 'evt-bounce',
      payload: { bounceType: 'hard' },
    });
    expect(byProviderId.recorded).toBe(true);

    const updated = await sends.findById(send.id);
    expect(updated?.readAt).not.toBeNull();
    expect(updated?.bouncedAt).not.toBeNull();
    expect(updated?.bounceType).toBe('hard');
  });

  it('projects deferred events without marking the send bounced', async () => {
    const send = await createSend();
    const first = await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'DEFERRED',
      providerEventId: 'evt-deferred-1',
      payload: { bounceType: 'soft' },
    });
    const second = await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'DEFERRED',
      providerEventId: 'evt-deferred-2',
      payload: { bounceType: 'soft' },
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(true);
    const updated = await sends.findById(send.id);
    expect(updated?.deferredAt).not.toBeNull();
    expect(updated?.lastDeferredAt).not.toBeNull();
    expect(updated?.deferredCount).toBe(2);
    expect(updated?.bouncedAt).toBeNull();
    expect(await sends.summary()).toMatchObject({ deferred: 1, bounced: 0 });
  });

  it('keeps a hard bounce when later soft or unknown evidence arrives', async () => {
    const send = await createSend();
    await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'BOUNCED',
      providerEventId: 'evt-soft',
      payload: { bounceType: 'soft' },
    });
    await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'BOUNCED',
      providerEventId: 'evt-hard',
      payload: { bounceType: 'hard' },
    });
    await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'BOUNCED',
      providerEventId: 'evt-unknown',
      payload: { smtpStatus: '450' },
    });

    expect((await sends.findById(send.id))?.bounceType).toBe('hard');
    expect(await sends.summary()).toMatchObject({
      bounced: 1,
      hardBounced: 1,
      softBounced: 0,
    });
  });

  it('upgrades a soft bounce when hard evidence arrives', async () => {
    const send = await createSend();
    await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'BOUNCED',
      providerEventId: 'evt-soft-first',
      payload: { bounceType: 'soft' },
    });
    await service.recordWebhook({
      trackingId: send.trackingId,
      eventType: 'BOUNCED',
      providerEventId: 'evt-hard-next',
      payload: { smtpStatus: '550' },
    });

    expect((await sends.findById(send.id))?.bounceType).toBe('hard');
  });

  it('returns send_not_found for an unmatched webhook', async () => {
    const result = await service.recordWebhook({
      trackingId: 'trk_missing',
      eventType: 'DELIVERED',
    });
    expect(result).toMatchObject({ recorded: false, reason: 'send_not_found' });
  });

  it('syncs provider events and ignores duplicates on a second run', async () => {
    const send = await createSend();
    provider.events = [
      {
        sendId: send.id,
        trackingId: send.trackingId,
        eventType: 'DELIVERED',
        source: 'webhook',
        providerEventId: 'sync-delivered',
        occurredAt: new Date(),
        payload: {},
      },
      {
        sendId: send.id,
        trackingId: send.trackingId,
        eventType: 'OPENED',
        source: 'pixel',
        providerEventId: 'sync-opened',
        occurredAt: new Date(),
        payload: {},
      },
    ];

    const first = await service.sync(7);
    expect(first).toMatchObject({ checked: 1, events: 2, recorded: 2, duplicates: 0, errors: 0 });
    const updated = await sends.findById(send.id);
    expect(updated?.deliveredAt).not.toBeNull();
    expect(updated?.openCount).toBe(1);

    const second = await service.sync(7);
    expect(second).toMatchObject({ checked: 1, events: 2, recorded: 0, duplicates: 2, errors: 0 });
  });
});
