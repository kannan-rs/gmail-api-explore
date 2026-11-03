import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { Database } from '../../src/db/client';
import { clients } from '../../src/db/schema';
import {
  ConflictError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  UnauthorizedError,
} from '../../src/domain/errors';
import { hashSendRequest } from '../../src/domain/idempotency';
import { validateSendRequest } from '../../src/domain/validation';
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
import { SendService, type SendServiceConfig } from '../../src/services/send-service';
import { closeTestDatabase, getTestDatabase, resetTestDatabase } from '../helpers/db';

const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';

class FakeProvider implements EmailProvider {
  readonly name = 'gmail' as const;
  sendCalls: OutgoingEmail[] = [];
  sendImpl: (email: OutgoingEmail) => Promise<ProviderSendResult> = async () => ({
    provider: 'gmail',
    providerMessageId: 'gmail-1',
    providerThreadId: 'thread-1',
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
    headers: {
      'message-id': expectedMessageId,
      from: expectedFrom,
    },
    reason: null,
  });
  lookupImpl: (messageId: string) => Promise<ProviderMessageLookup> = async () => ({
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

  async findByMessageId(messageId: string): Promise<ProviderMessageLookup> {
    return this.lookupImpl(messageId);
  }
}

let db: Database;
let sends: SendRepository;
let credentialService: CredentialService;
let provider: FakeProvider;
let service: SendService;
let mailboxId: string;
let baseConfig: SendServiceConfig;

const request = (overrides: Record<string, unknown> = {}) => ({
  clientId: 'client-01',
  to: 'borrower@example.com',
  cc: ['ops@example.com'],
  subject: 'Loan statement',
  html: '<p>Hello borrower</p>',
  idempotencyKey: IDEMPOTENCY_KEY,
  ...overrides,
});

beforeAll(async () => {
  const connection = await getTestDatabase();
  db = connection.db;
  sends = new SendRepository(db);
  const clientsRepo = new ClientRepository(db);
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
  provider = new FakeProvider();
  const config = loadConfig();
  baseConfig = {
    dailySendLimit: config.dailySendLimit,
    maxAttachmentBytes: config.maxAttachmentBytes,
    maxAttachments: config.maxAttachments,
    publicBaseUrl: config.publicBaseUrl,
    trackingEnabled: config.trackingEnabled,
    trackingPixelEnabled: config.trackingPixelEnabled,
    trackingAcknowledgementEnabled: config.trackingAcknowledgementEnabled,
    readReceiptRequested: config.readReceiptRequested,
  };
  service = new SendService({
    sends,
    clients: clientsRepo,
    credentials: credentialService,
    resolveProvider: () => provider,
    config: baseConfig,
  });
});

beforeEach(async () => {
  await resetTestDatabase();
  const clientsRepo = new ClientRepository(db);
  await clientsRepo.create({ id: 'client-01', name: 'Client 01' });
  const connection = await credentialService.saveConnection({
    profile: { email: 'owner@example.com', name: 'Owner' },
    refreshToken: 'refresh-token',
    scopes: ['gmail.send', 'gmail.metadata'],
    tokenType: 'Bearer',
  });
  mailboxId = connection.mailbox.id;
  provider = new FakeProvider();
  service = new SendService({
    sends,
    clients: clientsRepo,
    credentials: credentialService,
    resolveProvider: () => provider,
    config: baseConfig,
  });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('SendService', () => {
  it('sends through the provider, records SENT/VERIFIED, and returns a Gmail link', async () => {
    const result = await service.send(request());

    expect(result.duplicate).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.send.status).toBe('VERIFIED');
    expect(result.send.providerMessageId).toBe('gmail-1');
    expect(result.send.providerThreadId).toBe('thread-1');
    expect(result.send.providerLabels).toEqual(['SENT']);
    expect(result.send.sentAt).not.toBeNull();
    expect(result.send.verifiedAt).not.toBeNull();
    expect(result.send.trackingId).toMatch(/^trk_/);
    expect(result.gmailUrl).toContain('#sent/gmail-1');
    expect(provider.sendCalls).toHaveLength(1);
    expect(provider.sendCalls[0]?.trackingId).toBe(result.send.trackingId);
    expect(provider.sendCalls[0]?.html).toContain(result.send.trackingId);
    expect(provider.sendCalls[0]?.readReceiptRequested).toBe(true);
    expect(provider.sendCalls[0]?.from).toBe('owner@example.com');
    expect(provider.sendCalls[0]?.to).toEqual(['borrower@example.com']);
    expect(provider.sendCalls[0]?.cc).toEqual(['ops@example.com']);

    const events = await sends.getEvents(result.send.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'send_started',
      'provider_accepted',
      'verified',
    ]);
  });

  it('returns the existing send for a duplicate idempotency key without calling the provider', async () => {
    const first = await service.send(request());
    provider.sendCalls = [];

    const second = await service.send(request());

    expect(second.duplicate).toBe(true);
    expect(second.send.id).toBe(first.send.id);
    expect(second.verified).toBe(true);
    expect(provider.sendCalls).toHaveLength(0);
  });

  it('rejects a reused idempotency key with different content', async () => {
    await service.send(request());

    await expect(service.send(request({ subject: 'Different subject' }))).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(provider.sendCalls).toHaveLength(1);
  });

  it('marks the send FAILED and records a safe error when the provider fails', async () => {
    provider.sendImpl = async () => {
      throw new ProviderError('Gmail is temporarily unavailable', {
        code: 'GMAIL_UNAVAILABLE',
        retryable: true,
      });
    };

    await expect(service.send(request())).rejects.toMatchObject({
      code: 'GMAIL_UNAVAILABLE',
      details: { status: 'FAILED' },
    });

    const listed = await sends.list();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.status).toBe('FAILED');
    expect(listed.items[0]?.errorCode).toBe('GMAIL_UNAVAILABLE');
    expect(listed.items[0]?.errorMessage).toBe('Gmail is temporarily unavailable');

    const events = await sends.getEvents(listed.items[0]?.id ?? '');
    expect(events.map((event) => event.eventType)).toContain('send_failed');
  });

  it('recovers a send that Gmail accepted but whose response was lost', async () => {
    provider.sendImpl = async () => {
      throw new ProviderError('Gmail send timed out', {
        code: 'GMAIL_TIMEOUT',
        retryable: true,
      });
    };
    provider.lookupImpl = async () => ({
      found: true,
      providerMessageId: 'gmail-recovered',
      providerThreadId: 'thread-recovered',
      labels: ['SENT'],
    });

    const result = await service.send(request());

    expect(result.send.status).toBe('VERIFIED');
    expect(result.send.providerMessageId).toBe('gmail-recovered');
    expect(result.verified).toBe(true);
    const events = await sends.getEvents(result.send.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'send_started',
      'recovered_after_send_error',
      'verified',
    ]);
  });

  it('retries a FAILED send with the same Message-ID and without creating a duplicate row', async () => {
    provider.sendImpl = async () => {
      throw new ProviderError('Gmail is temporarily unavailable', {
        code: 'GMAIL_UNAVAILABLE',
        retryable: true,
      });
    };
    await expect(service.send(request())).rejects.toBeInstanceOf(ProviderError);

    provider.sendImpl = async () => ({
      provider: 'gmail',
      providerMessageId: 'gmail-retry',
      providerThreadId: 'thread-retry',
      labels: ['SENT'],
    });

    const retried = await service.send(request());

    expect(retried.send.status).toBe('VERIFIED');
    expect(retried.send.providerMessageId).toBe('gmail-retry');
    expect(provider.sendCalls).toHaveLength(2);
    expect(provider.sendCalls[0]?.messageId).toBe(provider.sendCalls[1]?.messageId);

    const listed = await sends.list();
    expect(listed.total).toBe(1);
    const events = await sends.getEvents(retried.send.id);
    expect(events.map((event) => event.eventType)).toContain('retry_started');
  });

  it('enforces the daily send cap for the connected mailbox', async () => {
    service = new SendService({
      sends,
      clients: new ClientRepository(db),
      credentials: credentialService,
      resolveProvider: () => provider,
      config: { ...baseConfig, dailySendLimit: 1 },
    });

    await service.send(request());

    await expect(
      service.send(request({ idempotencyKey: '55555555-5555-4555-8555-555555555555' })),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(provider.sendCalls).toHaveLength(1);
  });

  it('requires a connected Gmail account', async () => {
    await credentialService.disconnect();

    await expect(service.send(request())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('requires the client to exist', async () => {
    await db.delete(clients).where(eq(clients.id, 'client-01'));

    await expect(service.send(request())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stores attachment metadata but never the attachment content', async () => {
    const content = Buffer.from('secret attachment content');
    const result = await service.send(
      request({
        attachments: [
          {
            filename: 'statement.pdf',
            mimeType: 'application/pdf',
            contentBase64: content.toString('base64'),
          },
        ],
      }),
    );

    const attachment = result.send.attachments[0];
    expect(attachment).toMatchObject({
      filename: 'statement.pdf',
      mimeType: 'application/pdf',
      size: content.length,
    });
    expect(JSON.stringify(result.send.attachments)).not.toContain(content.toString('base64'));
    expect(provider.sendCalls[0]?.attachments[0]?.content.equals(content)).toBe(true);
  });

  it('recovers an existing SENDING row instead of creating a duplicate', async () => {
    const validated = validateSendRequest(request());
    const send = await sends.create({
      provider: 'gmail',
      mode: 'direct',
      mailboxId,
      clientId: 'client-01',
      fromEmail: 'owner@example.com',
      toEmails: validated.to,
      ccEmails: validated.cc,
      bccEmails: validated.bcc,
      subject: validated.subject,
      bodyHtml: validated.html,
      bodyText: validated.text,
      attachments: [],
      messageIdHeader: '<66666666-6666-4666-8666-666666666666@example.com>',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: hashSendRequest(validated),
    });

    provider.lookupImpl = async () => ({
      found: true,
      providerMessageId: 'gmail-recovered-sending',
      providerThreadId: 'thread-recovered-sending',
      labels: ['SENT'],
    });

    const result = await service.send(request());

    expect(result.duplicate).toBe(true);
    expect(result.send.id).toBe(send.id);
    expect(result.send.status).toBe('VERIFIED');
    expect(provider.sendCalls).toHaveLength(0);
  });

  it('rejects an in-progress send whose Gmail message cannot be found', async () => {
    const validated = validateSendRequest(request());
    await sends.create({
      provider: 'gmail',
      mode: 'direct',
      mailboxId,
      clientId: 'client-01',
      fromEmail: 'owner@example.com',
      toEmails: validated.to,
      ccEmails: validated.cc,
      bccEmails: validated.bcc,
      subject: validated.subject,
      bodyHtml: validated.html,
      bodyText: validated.text,
      attachments: [],
      messageIdHeader: '<77777777-7777-4777-8777-777777777777@example.com>',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: hashSendRequest(validated),
    });

    await expect(service.send(request())).rejects.toBeInstanceOf(ConflictError);
  });
});
