import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client';
import { emailSends } from '../../src/db/schema';
import { NotFoundError } from '../../src/domain/errors';
import { ClientRepository } from '../../src/repositories/client-repository';
import { CredentialRepository } from '../../src/repositories/credential-repository';
import { MailboxRepository } from '../../src/repositories/mailbox-repository';
import { type CreateSendInput, SendRepository } from '../../src/repositories/send-repository';
import { closeTestDatabase, getTestDatabase, resetTestDatabase } from '../helpers/db';

let db: Database;
let clients: ClientRepository;
let mailboxes: MailboxRepository;
let credentials: CredentialRepository;
let sends: SendRepository;
let mailboxId: string;

beforeAll(async () => {
  const connection = await getTestDatabase();
  db = connection.db;
  clients = new ClientRepository(db);
  mailboxes = new MailboxRepository(db);
  credentials = new CredentialRepository(db);
  sends = new SendRepository(db);
});

beforeEach(async () => {
  await resetTestDatabase();
  await clients.create({ id: 'client-01', name: 'Client 01' });
  await clients.create({ id: 'client-02', name: 'Client 02' });
  const mailbox = await mailboxes.upsert({
    provider: 'gmail',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  mailboxId = mailbox.id;
});

afterAll(async () => {
  await closeTestDatabase();
});

function sendInput(overrides: Partial<CreateSendInput> = {}): CreateSendInput {
  return {
    provider: 'gmail',
    mode: 'direct',
    mailboxId,
    clientId: 'client-01',
    fromEmail: 'owner@example.com',
    toEmails: ['borrower@example.com'],
    ccEmails: [],
    bccEmails: [],
    subject: 'Loan statement',
    bodyHtml: '<p>Statement</p>',
    bodyText: 'Statement',
    attachments: [],
    messageIdHeader: `<${randomUUID()}@example.com>`,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    ...overrides,
  };
}

describe('ClientRepository', () => {
  it('creates, lists, and finds clients', async () => {
    const created = await clients.create({ id: 'client-03', name: 'Client 03' });
    expect(created.id).toBe('client-03');

    const listed = await clients.list();
    expect(listed.map((client) => client.id)).toEqual(['client-01', 'client-02', 'client-03']);

    expect((await clients.findById('client-02'))?.name).toBe('Client 02');
    expect(await clients.findById('missing')).toBeUndefined();
  });

  it('ensures a client without duplicating it', async () => {
    const first = await clients.ensure({ id: 'client-04', name: 'Client 04' });
    const second = await clients.ensure({ id: 'client-04', name: 'Different name' });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Client 04');
  });
});

describe('MailboxRepository and CredentialRepository', () => {
  it('upserts a mailbox and its encrypted credential', async () => {
    const updatedMailbox = await mailboxes.upsert({
      provider: 'gmail',
      email: 'owner@example.com',
      displayName: 'Owner Updated',
    });
    expect(updatedMailbox.id).toBe(mailboxId);
    expect(updatedMailbox.displayName).toBe('Owner Updated');

    const credential = await credentials.upsert({
      mailboxId,
      refreshTokenEncrypted: 'v1.token-one',
      scopes: ['gmail.send', 'gmail.metadata'],
      tokenType: 'Bearer',
    });
    expect(credential.mailboxId).toBe(mailboxId);

    const updatedCredential = await credentials.upsert({
      mailboxId,
      refreshTokenEncrypted: 'v1.token-two',
      scopes: ['gmail.send', 'gmail.metadata'],
      tokenType: 'Bearer',
    });
    expect(updatedCredential.id).toBe(credential.id);
    expect((await credentials.findByMailboxId(mailboxId))?.refreshTokenEncrypted).toBe(
      'v1.token-two',
    );

    const latest = await credentials.findLatestWithMailbox();
    expect(latest?.mailbox.email).toBe('owner@example.com');
    expect(latest?.credential.refreshTokenEncrypted).toBe('v1.token-two');
  });

  it('cascades credential deletion and nulls the send mailbox', async () => {
    await credentials.upsert({
      mailboxId,
      refreshTokenEncrypted: 'v1.token',
      scopes: ['gmail.send'],
      tokenType: 'Bearer',
    });
    const send = await sends.create(sendInput());

    await mailboxes.delete(mailboxId);

    expect(await credentials.findByMailboxId(mailboxId)).toBeUndefined();
    expect((await sends.findById(send.id))?.mailboxId).toBeNull();
  });
});

describe('SendRepository', () => {
  it('creates a SENDING row and finds it by id and idempotency key', async () => {
    const input = sendInput();
    const send = await sends.create(input);

    expect(send.status).toBe('SENDING');
    expect(send.provider).toBe('gmail');
    expect(send.mode).toBe('direct');
    expect(send.sentAt).toBeNull();
    expect(send.verifiedAt).toBeNull();
    expect((await sends.findById(send.id))?.id).toBe(send.id);
    expect((await sends.findByIdempotencyKey(input.idempotencyKey))?.id).toBe(send.id);
  });

  it('enforces unique idempotency keys', async () => {
    const input = sendInput();
    await sends.create(input);

    await expect(
      sends.create({ ...input, messageIdHeader: `<${randomUUID()}@example.com>` }),
    ).rejects.toThrow();
  });

  it('updates Gmail metadata and records append-only events', async () => {
    const send = await sends.create(sendInput());
    const sentAt = new Date();
    const updated = await sends.updateStatus(send.id, {
      status: 'SENT',
      providerMessageId: 'gmail-message-1',
      providerThreadId: 'gmail-thread-1',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt,
      verifiedAt: null,
    });

    expect(updated.status).toBe('SENT');
    expect(updated.providerMessageId).toBe('gmail-message-1');
    expect(updated.providerThreadId).toBe('gmail-thread-1');
    expect(updated.providerLabels).toEqual(['SENT']);
    expect(updated.sentAt?.toISOString()).toBe(sentAt.toISOString());

    await sends.addEvent(send.id, 'provider_accepted', { providerMessageId: 'gmail-message-1' });
    await sends.addEvent(send.id, 'verified', { labels: ['SENT'] });

    const events = await sends.getEvents(send.id);
    expect(events.map((event) => event.eventType)).toEqual(['provider_accepted', 'verified']);
  });

  it('throws NotFoundError when updating a missing send', async () => {
    await expect(
      sends.updateStatus(randomUUID(), {
        status: 'FAILED',
        providerMessageId: null,
        providerThreadId: null,
        providerLabels: null,
        errorCode: 'X',
        errorMessage: 'x',
        sentAt: null,
        verifiedAt: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists sends with client, status, search, date, and pagination filters', async () => {
    const first = await sends.create(
      sendInput({ subject: 'Statement A', toEmails: ['a@example.com'] }),
    );
    const second = await sends.create(
      sendInput({ clientId: 'client-02', subject: 'Reminder B', toEmails: ['b@example.com'] }),
    );
    const third = await sends.create(
      sendInput({ subject: 'Statement C', toEmails: ['c@example.com'] }),
    );

    await sends.updateStatus(first.id, {
      status: 'SENT',
      providerMessageId: 'm1',
      providerThreadId: 't1',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: null,
    });
    await sends.updateStatus(second.id, {
      status: 'FAILED',
      providerMessageId: null,
      providerThreadId: null,
      providerLabels: null,
      errorCode: 'PROVIDER_ERROR',
      errorMessage: 'failed',
      sentAt: null,
      verifiedAt: null,
    });
    await sends.updateStatus(third.id, {
      status: 'VERIFIED',
      providerMessageId: 'm3',
      providerThreadId: 't3',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: new Date(),
    });

    const byClient = await sends.list({ clientId: 'client-01' });
    expect(byClient.total).toBe(2);
    expect(byClient.items.map((item) => item.id).sort()).toEqual([first.id, third.id].sort());

    const byStatus = await sends.list({ status: 'SENT' });
    expect(byStatus.total).toBe(1);
    expect(byStatus.items[0]?.id).toBe(first.id);

    const bySearch = await sends.list({ q: 'Statement' });
    expect(bySearch.total).toBe(2);

    const bySearchTo = await sends.list({ q: 'c@example.com' });
    expect(bySearchTo.total).toBe(1);

    const pageOne = await sends.list({ page: 1, pageSize: 1 });
    const pageTwo = await sends.list({ page: 2, pageSize: 1 });
    expect(pageOne.total).toBe(3);
    expect(pageOne.items).toHaveLength(1);
    expect(pageTwo.items).toHaveLength(1);
    expect(pageOne.items[0]?.id).not.toBe(pageTwo.items[0]?.id);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.update(emailSends).set({ createdAt: yesterday }).where(eq(emailSends.id, second.id));
    const fromToday = await sends.list({
      createdFrom: new Date(new Date().setUTCHours(0, 0, 0, 0)),
    });
    expect(fromToday.total).toBe(2);
  });

  it('summarizes status counts', async () => {
    const sending = await sends.create(sendInput());
    const sent = await sends.create(sendInput());
    const verified = await sends.create(sendInput());
    const failed = await sends.create(sendInput());

    await sends.updateStatus(sent.id, {
      status: 'SENT',
      providerMessageId: 'm1',
      providerThreadId: 't1',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: null,
    });
    await sends.updateStatus(verified.id, {
      status: 'VERIFIED',
      providerMessageId: 'm2',
      providerThreadId: 't2',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: new Date(),
    });
    await sends.updateStatus(failed.id, {
      status: 'FAILED',
      providerMessageId: null,
      providerThreadId: null,
      providerLabels: null,
      errorCode: 'PROVIDER_ERROR',
      errorMessage: 'failed',
      sentAt: null,
      verifiedAt: null,
    });

    const summary = await sends.summary({ clientId: 'client-01' });
    expect(summary).toEqual({
      total: 4,
      sent: 2,
      verified: 1,
      failed: 1,
      inFlight: 1,
      delivered: 0,
      bounced: 0,
      hardBounced: 0,
      softBounced: 0,
      deferred: 0,
      opened: 0,
      read: 0,
      acknowledged: 0,
      replied: 0,
    });
    expect(sending.status).toBe('SENDING');
  });

  it('groups daily counts in ascending date order', async () => {
    const today = await sends.create(sendInput());
    const yesterday = await sends.create(sendInput());
    const failedToday = await sends.create(sendInput());

    await sends.updateStatus(today.id, {
      status: 'SENT',
      providerMessageId: 'm1',
      providerThreadId: 't1',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: null,
    });
    await sends.updateStatus(yesterday.id, {
      status: 'SENT',
      providerMessageId: 'm2',
      providerThreadId: 't2',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      verifiedAt: null,
    });
    await sends.updateStatus(failedToday.id, {
      status: 'FAILED',
      providerMessageId: null,
      providerThreadId: null,
      providerLabels: null,
      errorCode: 'PROVIDER_ERROR',
      errorMessage: 'failed',
      sentAt: null,
      verifiedAt: null,
    });

    const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db
      .update(emailSends)
      .set({ createdAt: yesterdayDate })
      .where(eq(emailSends.id, yesterday.id));

    const daily = await sends.daily(7, 'client-01');
    expect(daily).toHaveLength(2);
    expect(daily[0]?.date).toBe(yesterdayDate.toISOString().slice(0, 10));
    expect(daily[0]?.sent).toBe(1);
    expect(daily[1]?.date).toBe(new Date().toISOString().slice(0, 10));
    expect(daily[1]?.sent).toBe(1);
    expect(daily[1]?.failed).toBe(1);
  });

  it('groups counts by client', async () => {
    const clientOne = await sends.create(sendInput());
    await sends.create(sendInput({ clientId: 'client-02' }));
    await sends.updateStatus(clientOne.id, {
      status: 'SENT',
      providerMessageId: 'm1',
      providerThreadId: 't1',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: null,
    });

    const byClient = await sends.byClient();
    expect(byClient).toEqual([
      { clientId: 'client-01', sent: 1, failed: 0, total: 1 },
      { clientId: 'client-02', sent: 0, failed: 0, total: 1 },
    ]);
  });

  it('counts cap-eligible sends created today', async () => {
    const sent = await sends.create(sendInput());
    const verified = await sends.create(sendInput());
    const sending = await sends.create(sendInput());
    const failed = await sends.create(sendInput());
    const yesterday = await sends.create(sendInput());

    for (const [id, status] of [
      [sent.id, 'SENT'],
      [verified.id, 'VERIFIED'],
      [failed.id, 'FAILED'],
    ] as const) {
      await sends.updateStatus(id, {
        status,
        providerMessageId: status === 'FAILED' ? null : `m-${id}`,
        providerThreadId: status === 'FAILED' ? null : `t-${id}`,
        providerLabels: status === 'FAILED' ? null : ['SENT'],
        errorCode: null,
        errorMessage: null,
        sentAt: status === 'FAILED' ? null : new Date(),
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
      });
    }
    await db
      .update(emailSends)
      .set({ createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
      .where(eq(emailSends.id, yesterday.id));

    expect(sending.status).toBe('SENDING');
    expect(await sends.countToday()).toBe(3);
  });

  it('finds recent sends that need reconciliation', async () => {
    const sent = await sends.create(sendInput());
    const sending = await sends.create(sendInput());
    const verified = await sends.create(sendInput());
    const failed = await sends.create(sendInput());

    await sends.updateStatus(sent.id, {
      status: 'SENT',
      providerMessageId: 'm1',
      providerThreadId: 't1',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: null,
    });
    await sends.updateStatus(verified.id, {
      status: 'VERIFIED',
      providerMessageId: 'm2',
      providerThreadId: 't2',
      providerLabels: ['SENT'],
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: new Date(),
    });
    await sends.updateStatus(failed.id, {
      status: 'FAILED',
      providerMessageId: null,
      providerThreadId: null,
      providerLabels: null,
      errorCode: 'PROVIDER_ERROR',
      errorMessage: 'failed',
      sentAt: null,
      verifiedAt: null,
    });

    const recent = await sends.recentForReconciliation(2, 100);
    expect(recent.map((row) => row.id).sort()).toEqual([sent.id, sending.id].sort());
  });

  it('exports filtered rows without pagination', async () => {
    await sends.create(sendInput());
    await sends.create(sendInput());
    await sends.create(sendInput({ clientId: 'client-02' }));

    const exported = await sends.exportRows({ clientId: 'client-01' }, 100);
    expect(exported).toHaveLength(2);
  });
});
