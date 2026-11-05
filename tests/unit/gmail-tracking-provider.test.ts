import { describe, expect, it } from 'vitest';
import type {
  GmailApi,
  GmailMessageMetadata,
  GmailMessageRef,
} from '../../src/providers/gmail/gmail-api';
import { GmailTrackingProvider } from '../../src/providers/gmail/gmail-tracking-provider';
import type { TrackingSendRef } from '../../src/providers/tracking-provider';

class FakeGmailApi implements GmailApi {
  messages = new Map<string, GmailMessageMetadata>();
  listed: GmailMessageRef[] = [];
  threads = new Map<string, GmailMessageMetadata[]>();

  async sendRaw(): Promise<{ id: string; threadId: string; labelIds: string[] }> {
    throw new Error('not used');
  }

  async getMessageMetadata(messageId: string): Promise<GmailMessageMetadata> {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`missing message ${messageId}`);
    }
    return message;
  }

  async listMessagesByLabel(): Promise<{
    messages: GmailMessageRef[];
    nextPageToken: string | null;
  }> {
    return { messages: this.listed, nextPageToken: null };
  }

  async getThreadMetadata(threadId: string): Promise<GmailMessageMetadata[]> {
    return this.threads.get(threadId) ?? [];
  }
}

function sendRef(overrides: Partial<TrackingSendRef> = {}): TrackingSendRef {
  return {
    id: 'send-1',
    trackingId: 'trk_abc',
    messageIdHeader: '<original@example.com>',
    providerMessageId: 'gmail-original',
    providerThreadId: 'thread-1',
    fromEmail: 'owner@example.com',
    toEmails: ['borrower@example.com'],
    ccEmails: [],
    bccEmails: [],
    subject: 'Loan statement',
    sentAt: new Date('2026-11-01T10:00:00.000Z'),
    repliedAt: null,
    ...overrides,
  };
}

function metadata(
  id: string,
  headers: Record<string, string>,
  threadId = 'thread-1',
): GmailMessageMetadata {
  return { id, threadId, labelIds: ['INBOX'], headers };
}

describe('GmailTrackingProvider', () => {
  it('records a bounce matched by In-Reply-To and failed recipient', async () => {
    const api = new FakeGmailApi();
    api.listed = [{ id: 'dsn-1', threadId: 'thread-1' }];
    api.messages.set(
      'dsn-1',
      metadata('dsn-1', {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        subject: 'Delivery Status Notification (Failure)',
        date: 'Mon, 02 Nov 2026 10:00:00 +0000',
        'in-reply-to': '<original@example.com>',
        'x-failed-recipients': 'borrower@example.com',
      }),
    );

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef()],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sendId: 'send-1',
      trackingId: 'trk_abc',
      eventType: 'BOUNCED',
      source: 'gmail_dsn',
      providerEventId: 'dsn-1',
    });
    expect(events[0]?.payload.failedRecipients).toEqual(['borrower@example.com']);
    expect(events[0]?.payload.bounceType).toBe('hard');
  });

  it('falls back to X-Failed-Recipients when the DSN has no reference header', async () => {
    const api = new FakeGmailApi();
    api.listed = [{ id: 'dsn-2', threadId: null }];
    api.messages.set(
      'dsn-2',
      metadata('dsn-2', {
        from: 'postmaster@example.com',
        subject: 'Undelivered Mail Returned to Sender',
        date: 'Mon, 02 Nov 2026 10:00:00 +0000',
        'x-failed-recipients': 'borrower@example.com',
      }),
    );

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef()],
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('BOUNCED');
    expect(events[0]?.payload.bounceType).toBe('hard');
  });

  it('treats an unclassified DSN with a failed recipient as a hard bounce', async () => {
    const api = new FakeGmailApi();
    api.listed = [{ id: 'dsn-5', threadId: null }];
    api.messages.set(
      'dsn-5',
      metadata('dsn-5', {
        from: 'mailer-daemon@googlemail.com',
        subject: 'Delivery Status Notification',
        date: 'Mon, 02 Nov 2026 10:00:00 +0000',
        'x-failed-recipients': 'borrower@example.com',
      }),
    );

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef()],
    });

    expect(events[0]?.eventType).toBe('BOUNCED');
    expect(events[0]?.payload.bounceType).toBe('hard');
  });

  it('records delayed mail as a soft deferred event', async () => {
    const api = new FakeGmailApi();
    api.listed = [{ id: 'dsn-3', threadId: 'thread-1' }];
    api.messages.set(
      'dsn-3',
      metadata('dsn-3', {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        subject: 'Delayed Mail (still being retried)',
        date: 'Mon, 02 Nov 2026 10:00:00 +0000',
        'in-reply-to': '<original@example.com>',
      }),
    );

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef()],
    });

    expect(events[0]).toMatchObject({
      eventType: 'DEFERRED',
      payload: { bounceType: 'soft' },
    });
  });

  it('records a read receipt matched by subject and sender', async () => {
    const api = new FakeGmailApi();
    api.listed = [{ id: 'mdn-1', threadId: null }];
    api.messages.set(
      'mdn-1',
      metadata('mdn-1', {
        from: 'borrower@example.com',
        subject: 'Read: Loan statement',
        date: 'Mon, 02 Nov 2026 10:00:00 +0000',
      }),
    );

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef()],
    });

    expect(events[0]).toMatchObject({
      eventType: 'READ',
      source: 'gmail_mdn',
    });
  });

  it('matches a read-receipt subject prefix', async () => {
    const api = new FakeGmailApi();
    api.listed = [{ id: 'mdn-2', threadId: null }];
    api.messages.set(
      'mdn-2',
      metadata('mdn-2', {
        from: 'borrower@example.com',
        subject: 'Read receipt: Loan statement',
        date: 'Mon, 02 Nov 2026 10:00:00 +0000',
      }),
    );

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef()],
    });

    expect(events[0]).toMatchObject({
      eventType: 'READ',
      source: 'gmail_mdn',
      providerEventId: 'mdn-2',
    });
  });

  it('records a thread reply and ignores the original message', async () => {
    const api = new FakeGmailApi();
    api.threads.set('thread-1', [
      metadata('gmail-original', {
        from: 'owner@example.com',
        to: 'borrower@example.com',
        subject: 'Loan statement',
        date: 'Sun, 01 Nov 2026 10:00:00 +0000',
      }),
      metadata('gmail-reply', {
        from: 'borrower@example.com',
        to: 'owner@example.com',
        subject: 'Re: Loan statement',
        date: 'Mon, 02 Nov 2026 10:00:00 +0000',
        'message-id': '<reply@example.com>',
      }),
    ]);

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef()],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'REPLIED',
      source: 'gmail_thread',
      providerEventId: 'gmail-reply',
    });
  });

  it('does not create a reply event when the send already has a reply', async () => {
    const api = new FakeGmailApi();
    api.threads.set('thread-1', [
      metadata('gmail-reply', {
        from: 'borrower@example.com',
        subject: 'Re: Loan statement',
        date: 'Mon, 02 Nov 2026 10:00:00 +0000',
      }),
    ]);

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef({ repliedAt: new Date() })],
    });

    expect(events).toEqual([]);
  });

  it('ignores messages that do not match a ledger send', async () => {
    const api = new FakeGmailApi();
    api.listed = [{ id: 'dsn-4', threadId: null }];
    api.messages.set(
      'dsn-4',
      metadata('dsn-4', {
        from: 'mailer-daemon@googlemail.com',
        subject: 'Delivery Status Notification (Failure)',
        'x-failed-recipients': 'someone-else@example.com',
      }),
    );

    const provider = new GmailTrackingProvider(api);
    const events = await provider.collectEvents({
      mailboxEmail: 'owner@example.com',
      days: 7,
      sends: [sendRef()],
    });

    expect(events).toEqual([]);
  });
});
