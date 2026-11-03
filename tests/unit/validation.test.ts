import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { validateSendRequest } from '../../src/domain/validation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const base = {
  clientId: 'client-01',
  to: ['borrower@example.com'],
  subject: 'Loan statement',
  html: '<p>Hello borrower</p>',
};

describe('validateSendRequest', () => {
  it('accepts a minimal request and applies defaults', () => {
    const result = validateSendRequest(base);

    expect(result.clientId).toBe('client-01');
    expect(result.to).toEqual(['borrower@example.com']);
    expect(result.cc).toEqual([]);
    expect(result.bcc).toEqual([]);
    expect(result.subject).toBe('Loan statement');
    expect(result.html).toBe('<p>Hello borrower</p>');
    expect(result.text).toBeNull();
    expect(result.attachments).toEqual([]);
    expect(result.idempotencyKey).toMatch(UUID_PATTERN);
  });

  it('splits comma and semicolon strings, trims, and dedupes case-insensitively', () => {
    const result = validateSendRequest({
      ...base,
      to: ' A@example.com, b@example.com; a@EXAMPLE.com ',
      cc: ['c@example.com', ' C@example.com '],
    });

    expect(result.to).toEqual(['A@example.com', 'b@example.com']);
    expect(result.cc).toEqual(['c@example.com']);
  });

  it('rejects a request with no recipients', () => {
    expect(() => validateSendRequest({ ...base, to: [] })).toThrow(ValidationError);
  });

  it('rejects an invalid email address', () => {
    expect(() => validateSendRequest({ ...base, to: ['not-an-email'] })).toThrow(ValidationError);
  });

  it('rejects CRLF header injection in the subject', () => {
    expect(() =>
      validateSendRequest({ ...base, subject: 'Hello\r\nBcc: attacker@example.com' }),
    ).toThrow(ValidationError);
  });

  it('rejects CRLF header injection in a recipient', () => {
    expect(() =>
      validateSendRequest({ ...base, to: ['a@example.com\r\nBcc: attacker@example.com'] }),
    ).toThrow(ValidationError);
  });

  it('rejects a request with no body', () => {
    expect(() => validateSendRequest({ ...base, html: '', text: '' })).toThrow(ValidationError);
  });

  it('accepts a text-only request', () => {
    const result = validateSendRequest({ ...base, html: undefined, text: 'Plain body' });
    expect(result.html).toBeNull();
    expect(result.text).toBe('Plain body');
  });

  it('accepts attachments and records size and sha256 without storing raw content elsewhere', () => {
    const content = Buffer.from('hello attachment');
    const result = validateSendRequest({
      ...base,
      attachments: [
        {
          filename: 'statement.pdf',
          mimeType: 'application/pdf',
          contentBase64: content.toString('base64'),
        },
      ],
    });

    const attachment = result.attachments[0];
    expect(attachment).toBeDefined();
    expect(attachment?.filename).toBe('statement.pdf');
    expect(attachment?.mimeType).toBe('application/pdf');
    expect(attachment?.size).toBe(content.length);
    expect(attachment?.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    expect(attachment?.content.equals(content)).toBe(true);
  });

  it('rejects a filename containing a path separator', () => {
    expect(() =>
      validateSendRequest({
        ...base,
        attachments: [
          {
            filename: '../secret.pdf',
            mimeType: 'application/pdf',
            contentBase64: Buffer.from('x').toString('base64'),
          },
        ],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid base64 attachment content', () => {
    expect(() =>
      validateSendRequest({
        ...base,
        attachments: [
          {
            filename: 'statement.pdf',
            mimeType: 'application/pdf',
            contentBase64: 'not base64!!',
          },
        ],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects attachments that exceed the configured total size', () => {
    expect(() =>
      validateSendRequest(
        {
          ...base,
          attachments: [
            {
              filename: 'big.bin',
              mimeType: 'application/octet-stream',
              contentBase64: Buffer.alloc(64, 1).toString('base64'),
            },
          ],
        },
        { maxAttachmentBytes: 32 },
      ),
    ).toThrow(ValidationError);
  });

  it('rejects too many recipients', () => {
    const to = Array.from({ length: 6 }, (_, index) => `person${index}@example.com`);
    expect(() => validateSendRequest({ ...base, to }, { maxRecipients: 5 })).toThrow(
      ValidationError,
    );
  });

  it('preserves a valid idempotency key', () => {
    const key = '11111111-1111-4111-8111-111111111111';
    const result = validateSendRequest({ ...base, idempotencyKey: key });
    expect(result.idempotencyKey).toBe(key);
  });

  it('rejects an invalid idempotency key', () => {
    expect(() => validateSendRequest({ ...base, idempotencyKey: 'not-a-uuid' })).toThrow(
      ValidationError,
    );
  });

  it('exposes validation details', () => {
    try {
      validateSendRequest({ ...base, clientId: '' });
      expect.fail('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect((validationError.details as unknown[]).length).toBeGreaterThan(0);
    }
  });
});
