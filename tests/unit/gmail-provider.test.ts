import { describe, expect, it } from 'vitest';
import type { OutgoingEmail } from '../../src/providers/email-provider';
import type {
  GmailApi,
  GmailMessageMetadata,
  GmailMessageRef,
} from '../../src/providers/gmail/gmail-api';
import { GmailProvider } from '../../src/providers/gmail/gmail-provider';

const fixedMessageId = '<33333333-3333-4333-8333-333333333333@example.com>';
const fixedDate = new Date('2026-11-01T10:00:00.000Z');

class FakeGmailApi implements GmailApi {
  sentRaw: string[] = [];
  sendResult = { id: 'gmail-1', threadId: 'thread-1', labelIds: ['SENT'] };
  metadata: GmailMessageMetadata = {
    id: 'gmail-1',
    threadId: 'thread-1',
    labelIds: ['SENT'],
    headers: {
      'message-id': fixedMessageId,
      from: 'support-client-01@example.com',
      to: 'borrower@example.com',
      subject: 'Loan statement',
    },
  };
  listed: GmailMessageRef[] = [];
  lastLabelIds: string[] | null = null;

  async sendRaw(rawBase64Url: string) {
    this.sentRaw.push(rawBase64Url);
    return this.sendResult;
  }

  async getMessageMetadata() {
    return this.metadata;
  }

  async listMessagesByLabel(labelIds: string[]) {
    this.lastLabelIds = labelIds;
    return { messages: this.listed, nextPageToken: null };
  }
}

function outgoingEmail(overrides: Partial<OutgoingEmail> = {}): OutgoingEmail {
  return {
    from: 'support-client-01@example.com',
    to: ['borrower@example.com'],
    cc: ['ops@example.com'],
    bcc: ['audit@example.com'],
    subject: 'Loan statement',
    html: '<p>Hello</p>',
    text: null,
    attachments: [],
    messageId: fixedMessageId,
    date: fixedDate,
    ...overrides,
  };
}

describe('GmailProvider', () => {
  it('builds raw MIME and sends it through the Gmail API', async () => {
    const api = new FakeGmailApi();
    const provider = new GmailProvider(api);

    const result = await provider.send(outgoingEmail());

    expect(result).toEqual({
      provider: 'gmail',
      providerMessageId: 'gmail-1',
      providerThreadId: 'thread-1',
      labels: ['SENT'],
    });

    const raw = Buffer.from(api.sentRaw[0] ?? '', 'base64url').toString('utf8');
    expect(raw).toContain('From: support-client-01@example.com');
    expect(raw).toContain('To: borrower@example.com');
    expect(raw).toContain('Cc: ops@example.com');
    expect(raw).toContain('Bcc: audit@example.com');
    expect(raw).toContain('Subject: Loan statement');
    expect(raw).toContain(`Message-ID: ${fixedMessageId}`);
  });

  it('verifies the SENT label, Message-ID, and From header', async () => {
    const api = new FakeGmailApi();
    const provider = new GmailProvider(api);

    const result = await provider.verifySent(
      'gmail-1',
      fixedMessageId,
      'support-client-01@example.com',
    );

    expect(result.verified).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.labels).toEqual(['SENT']);
  });

  it('fails verification when the SENT label is missing', async () => {
    const api = new FakeGmailApi();
    api.metadata = { ...api.metadata, labelIds: ['INBOX'] };
    const provider = new GmailProvider(api);

    const result = await provider.verifySent(
      'gmail-1',
      fixedMessageId,
      'support-client-01@example.com',
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('SENT label missing');
  });

  it('fails verification when the Message-ID or From header differs', async () => {
    const api = new FakeGmailApi();
    api.metadata = {
      ...api.metadata,
      headers: {
        ...api.metadata.headers,
        'message-id': '<other@example.com>',
        from: 'other@x.com',
      },
    };
    const provider = new GmailProvider(api);

    const result = await provider.verifySent(
      'gmail-1',
      fixedMessageId,
      'support-client-01@example.com',
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('Message-ID mismatch');
    expect(result.reason).toContain('From header mismatch');
  });

  it('looks up a message by RFC 5322 Message-ID and returns its labels', async () => {
    const api = new FakeGmailApi();
    api.listed = [{ id: 'gmail-1', threadId: 'thread-1' }];
    const provider = new GmailProvider(api);

    const result = await provider.findByMessageId(fixedMessageId);

    expect(api.lastLabelIds).toEqual(['SENT']);
    expect(result).toEqual({
      found: true,
      providerMessageId: 'gmail-1',
      providerThreadId: 'thread-1',
      labels: ['SENT'],
    });
  });

  it('returns not found when Gmail search has no match', async () => {
    const api = new FakeGmailApi();
    const provider = new GmailProvider(api);

    const result = await provider.findByMessageId(fixedMessageId);

    expect(result).toEqual({
      found: false,
      providerMessageId: null,
      providerThreadId: null,
      labels: [],
    });
  });
});
