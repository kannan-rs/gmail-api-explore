import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/domain/errors';
import {
  assertIdempotencyMatch,
  createIdempotencyKey,
  createMessageId,
  hashSendRequest,
} from '../../src/domain/idempotency';
import { validateSendRequest } from '../../src/domain/validation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const base = {
  clientId: 'client-01',
  to: ['borrower@example.com'],
  cc: ['ops@example.com'],
  subject: 'Loan statement',
  html: '<p>Hello</p>',
  text: 'Hello',
};

describe('createIdempotencyKey', () => {
  it('returns a UUID', () => {
    expect(createIdempotencyKey()).toMatch(UUID_PATTERN);
  });
});

describe('createMessageId', () => {
  it('builds an RFC 5322 Message-ID using the sender domain', () => {
    const messageId = createMessageId(
      'support-client-01@example.com',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(messageId).toBe('<11111111-1111-4111-8111-111111111111@example.com>');
  });

  it('generates a unique Message-ID when no id is supplied', () => {
    const first = createMessageId('sender@example.com');
    const second = createMessageId('sender@example.com');
    expect(first).not.toBe(second);
    expect(first.startsWith('<') && first.endsWith('@example.com>')).toBe(true);
  });

  it('rejects a sender without a domain', () => {
    expect(() => createMessageId('not-an-email')).toThrow();
  });
});

describe('hashSendRequest', () => {
  it('is stable when recipient order changes', () => {
    const first = validateSendRequest({
      ...base,
      to: ['a@example.com', 'b@example.com'],
      cc: ['c@example.com', 'd@example.com'],
    });
    const second = validateSendRequest({
      ...base,
      to: ['b@example.com', 'a@example.com'],
      cc: ['d@example.com', 'c@example.com'],
    });

    expect(hashSendRequest(first)).toBe(hashSendRequest(second));
  });

  it('changes when the subject, body, or recipients change', () => {
    const original = validateSendRequest(base);
    const subjectChanged = validateSendRequest({ ...base, subject: 'Other subject' });
    const bodyChanged = validateSendRequest({ ...base, html: '<p>Other</p>' });
    const recipientChanged = validateSendRequest({ ...base, to: ['other@example.com'] });

    expect(hashSendRequest(original)).not.toBe(hashSendRequest(subjectChanged));
    expect(hashSendRequest(original)).not.toBe(hashSendRequest(bodyChanged));
    expect(hashSendRequest(original)).not.toBe(hashSendRequest(recipientChanged));
  });

  it('changes when an attachment changes', () => {
    const withoutAttachment = validateSendRequest(base);
    const withAttachment = validateSendRequest({
      ...base,
      attachments: [
        {
          filename: 'statement.pdf',
          mimeType: 'application/pdf',
          contentBase64: Buffer.from('content').toString('base64'),
        },
      ],
    });

    expect(hashSendRequest(withoutAttachment)).not.toBe(hashSendRequest(withAttachment));
  });
});

describe('assertIdempotencyMatch', () => {
  it('accepts a matching request hash', () => {
    expect(() => assertIdempotencyMatch('abc', 'abc')).not.toThrow();
  });

  it('rejects a reused key with different content', () => {
    expect(() => assertIdempotencyMatch('abc', 'def')).toThrow(ConflictError);
  });
});
