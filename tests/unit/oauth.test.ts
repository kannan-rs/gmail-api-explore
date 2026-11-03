import type { OAuth2Client } from 'google-auth-library';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../src/domain/errors';
import { GmailOAuthService, mapOAuthError } from '../../src/providers/gmail/oauth';

const oauth = new GmailOAuthService({
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:3000/api/auth/google/callback',
});

describe('GmailOAuthService', () => {
  it('builds an offline consent URL with the required scopes and state', () => {
    const url = new URL(oauth.getAuthorizationUrl('state-123'));

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-123');

    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.metadata');
    expect(scope).toContain('email');
  });

  it('creates a client with a refresh token', () => {
    const client = oauth.createClientWithRefreshToken('refresh-token');
    expect(client.credentials.refresh_token).toBe('refresh-token');
  });

  it('returns an access token from the client', async () => {
    const fakeClient = {
      getAccessToken: async () => ({ token: 'access-token' }),
    } as unknown as OAuth2Client;

    await expect(oauth.getAccessToken(fakeClient)).resolves.toBe('access-token');
  });

  it('maps invalid_grant to a reconnect error', () => {
    expect(
      mapOAuthError({ response: { status: 400, data: { error: 'invalid_grant' } } }),
    ).toBeInstanceOf(UnauthorizedError);
    expect(
      mapOAuthError({ response: { status: 400, data: { error: 'invalid_grant' } } }).message,
    ).toMatch(/reconnect/i);
  });
});
