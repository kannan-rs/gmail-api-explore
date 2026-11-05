import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client';
import { NotFoundError, ProviderError } from '../../src/domain/errors';
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
import { VerificationService } from '../../src/services/verification-service';
import { closeTestDatabase, getTestDatabase, resetTestDatabase } from '../helpers/db';

class FakeProvider implements EmailProvider {
  readonly name = 'gmail' as const;
  verifyImpl: () => Promise<ProviderVerification> = async () => ({
    verified: true,
    labels: ['SENT'],
    headers: {},
    reason: null,
  });
  lookupImpl: () => Promise<ProviderMessageLookup> = async () => ({
    found: false,
    providerMessageId: null,
    providerThreadId: null,
    labels: [],
  });

  async send(_email: OutgoingEmail): Promise<ProviderSendResult> {
    throw new Error('not used');
  }

  async verifySent(): Promise<ProviderVerification> {
    return this.verifyImpl();
  }

  async findByMessageId(): Promise<ProviderMessageLookup> {
    return this.lookupImpl();
  }
}

let db: Database;
let sends: SendRepository;
let credentialService: CredentialService;
let provider: FakeProvider;
let service: VerificationService;
let mailboxId: string;

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
    new TokenCipher(Buffer.alloc(32, 9).toString('base64')),
    oauth,
  );
  provider = new FakeProvider();
  service = new VerificationService({
    sends,
    credentials: credentialService,
    resolveProvider: () => provider,
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
  service = new VerificationService({
    sends,
    credentials: credentialService,
    resolveProvider: () => provider,
  });
});

afterAll(async () => {
  await closeTestDatabase();
});

async function createSend(status: 'SENDING' | 'SENT' | 'VERIFIED' | 'FAILED') {
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
    messageIdHeader: `<${crypto.randomUUID()}@example.com>`,
    idempotencyKey: crypto.randomUUID(),
    requestHash: crypto.randomUUID(),
  });

  if (status !== 'SENDING') {
    await sends.updateStatus(send.id, {
      status,
      providerMessageId: 'gmail-1',
      providerThreadId: 'thread-1',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: status === 'VERIFIED' ? new Date() : null,
    });
  }

  return send;
}

describe('VerificationService', () => {
  it('verifies a SENT message and marks it VERIFIED', async () => {
    const send = await createSend('SENT');

    const result = await service.verify(send.id);

    expect(result.verified).toBe(true);
    expect(result.send.status).toBe('VERIFIED');
    expect(result.send.verifiedAt).not.toBeNull();
    const events = await sends.getEvents(send.id);
    expect(events.map((event) => event.eventType)).toContain('verified');
  });

  it('keeps the send SENT when verification fails and records the reason', async () => {
    const send = await createSend('SENT');
    provider.verifyImpl = async () => ({
      verified: false,
      labels: ['INBOX'],
      headers: {},
      reason: 'SENT label missing',
    });

    const result = await service.verify(send.id);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('SENT label missing');
    expect(result.send.status).toBe('SENT');
    const events = await sends.getEvents(send.id);
    expect(events.map((event) => event.eventType)).toContain('verification_failed');
  });

  it('adopts a Gmail-rewritten Message-ID and marks the send VERIFIED', async () => {
    const send = await createSend('SENT');
    const rewritten = '<gmail-rewritten@mail.gmail.com>';
    provider.verifyImpl = async () => ({
      verified: false,
      labels: ['SENT'],
      headers: { 'message-id': rewritten, from: 'owner@example.com' },
      reason: 'Message-ID mismatch',
    });

    const result = await service.verify(send.id);

    expect(result.verified).toBe(true);
    expect(result.send.status).toBe('VERIFIED');
    expect(result.send.messageIdHeader).toBe(rewritten);
    const events = await sends.getEvents(send.id);
    expect(events.map((event) => event.eventType)).toContain('message_id_adopted');
  });

  it('does not adopt a Message-ID when other verification checks fail', async () => {
    const send = await createSend('SENT');
    provider.verifyImpl = async () => ({
      verified: false,
      labels: ['SENT'],
      headers: { 'message-id': '<other@mail.gmail.com>', from: 'other@example.com' },
      reason: 'Message-ID mismatch; From header mismatch',
    });

    const result = await service.verify(send.id);

    expect(result.verified).toBe(false);
    expect(result.send.status).toBe('SENT');
    expect(result.send.messageIdHeader).toBe(send.messageIdHeader);
  });

  it('recovers a SENDING message found by Message-ID and verifies it', async () => {
    const send = await createSend('SENDING');
    provider.lookupImpl = async () => ({
      found: true,
      providerMessageId: 'gmail-recovered',
      providerThreadId: 'thread-recovered',
      labels: ['SENT'],
    });

    const result = await service.verify(send.id);

    expect(result.verified).toBe(true);
    expect(result.send.status).toBe('VERIFIED');
    expect(result.send.providerMessageId).toBe('gmail-recovered');
    const events = await sends.getEvents(send.id);
    expect(events.map((event) => event.eventType)).toContain('recovered_from_gmail');
  });

  it('returns unverified when a SENDING message is not found', async () => {
    const send = await createSend('SENDING');

    const result = await service.verify(send.id);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('Message not found in Gmail');
    expect(result.send.status).toBe('SENDING');
  });

  it('throws NotFoundError for a missing send', async () => {
    await expect(service.verify('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('reconciles recent sends and reports counts', async () => {
    const verifiedSend = await createSend('SENT');
    const sendingSend = await createSend('SENDING');

    provider.verifyImpl = async () => ({
      verified: true,
      labels: ['SENT'],
      headers: {},
      reason: null,
    });

    const result = await service.reconcile(2);

    expect(result.checked).toBe(2);
    expect(result.verified).toBe(1);
    expect(result.stillUnverified).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.recovered).toBe(0);
    expect((await sends.findById(verifiedSend.id))?.status).toBe('VERIFIED');
    expect((await sends.findById(sendingSend.id))?.status).toBe('SENDING');
  });

  it('continues reconciliation when one verification errors', async () => {
    const send = await createSend('SENT');
    provider.verifyImpl = async () => {
      throw new ProviderError('Gmail is unavailable', {
        code: 'GMAIL_UNAVAILABLE',
        retryable: true,
      });
    };

    const result = await service.reconcile(2);

    expect(result.checked).toBe(1);
    expect(result.errors).toBe(1);
    const events = await sends.getEvents(send.id);
    expect(events.map((event) => event.eventType)).toContain('reconcile_error');
  });
});
