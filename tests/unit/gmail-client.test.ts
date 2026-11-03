import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../src/domain/errors';
import { mapGmailError } from '../../src/providers/gmail/gmail-api';

describe('mapGmailError', () => {
  it('maps 401 and invalid_grant to a non-retryable auth error', () => {
    const unauthorized = mapGmailError({ response: { status: 401 } });
    expect(unauthorized).toBeInstanceOf(ProviderError);
    expect(unauthorized.code).toBe('GMAIL_AUTH');
    expect(unauthorized.retryable).toBe(false);

    const invalidGrant = mapGmailError({
      response: { status: 400, data: { error: 'invalid_grant' } },
    });
    expect(invalidGrant.code).toBe('GMAIL_AUTH');
  });

  it('maps a disabled Gmail API to a clear non-retryable error', () => {
    const error = mapGmailError({
      response: {
        status: 403,
        data: {
          error: {
            code: 403,
            message: 'Gmail API has not been used in project 123 before or it is disabled.',
            errors: [{ reason: 'accessNotConfigured' }],
          },
        },
      },
    });
    expect(error.code).toBe('GMAIL_API_DISABLED');
    expect(error.message).toContain('Gmail API is disabled');
    expect(error.retryable).toBe(false);
  });

  it('maps 429 to a retryable rate limit error', () => {
    const error = mapGmailError({ response: { status: 429 } });
    expect(error.code).toBe('GMAIL_RATE_LIMIT');
    expect(error.retryable).toBe(true);
  });

  it('maps 5xx to a retryable unavailable error', () => {
    const error = mapGmailError({ response: { status: 503 } });
    expect(error.code).toBe('GMAIL_UNAVAILABLE');
    expect(error.retryable).toBe(true);
  });

  it('maps network failures to a retryable network error', () => {
    const error = mapGmailError({ code: 'ECONNRESET' });
    expect(error.code).toBe('GMAIL_NETWORK');
    expect(error.retryable).toBe(true);
  });

  it('maps 400 to a non-retryable bad request error', () => {
    const error = mapGmailError({ response: { status: 400 } });
    expect(error.code).toBe('GMAIL_BAD_REQUEST');
    expect(error.retryable).toBe(false);
  });

  it('does not include the original error message or tokens in details', () => {
    const error = mapGmailError({
      response: { status: 400 },
      message: 'raw-token-secret borrower@example.com',
    });
    expect(JSON.stringify(error.details)).not.toContain('raw-token-secret');
    expect(JSON.stringify(error.details)).not.toContain('borrower@example.com');
  });

  it('passes through an existing ProviderError', () => {
    const original = new ProviderError('timeout', { code: 'GMAIL_TIMEOUT', retryable: true });
    expect(mapGmailError(original)).toBe(original);
  });
});
