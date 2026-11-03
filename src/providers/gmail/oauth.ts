import { type Credentials, OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { UnauthorizedError } from '../../domain/errors';

export const GMAIL_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.metadata',
] as const;

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleProfile {
  email: string;
  name: string | null;
}

export function mapOAuthError(error: unknown): UnauthorizedError {
  if (error instanceof UnauthorizedError) {
    return error;
  }

  const response = (error as { response?: { status?: number; data?: { error?: unknown } } })
    .response;
  const apiCode = response?.data?.error;
  const isInvalidGrant = apiCode === 'invalid_grant' || response?.status === 400;

  if (isInvalidGrant) {
    return new UnauthorizedError(
      'Google authorization expired or was revoked. Reconnect the Gmail account.',
    );
  }

  return new UnauthorizedError('Google authorization failed. Reconnect the Gmail account.');
}

export class GmailOAuthService {
  constructor(private readonly config: GmailOAuthConfig) {}

  createClient(): OAuth2Client {
    return new OAuth2Client(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri,
    );
  }

  getAuthorizationUrl(state: string): string {
    return this.createClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: [...GMAIL_OAUTH_SCOPES],
      state,
    });
  }

  async exchangeCode(code: string): Promise<{ tokens: Credentials; profile: GoogleProfile }> {
    const client = this.createClient();
    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      if (!tokens.access_token) {
        throw new UnauthorizedError('Google did not return an access token. Reconnect Gmail.');
      }

      const oauth2 = google.oauth2({ version: 'v2', auth: client });
      const { data } = await oauth2.userinfo.get();
      if (!data.email) {
        throw new UnauthorizedError('Google did not return an email address. Reconnect Gmail.');
      }

      return {
        tokens,
        profile: {
          email: data.email.toLowerCase(),
          name: data.name ?? null,
        },
      };
    } catch (error) {
      throw mapOAuthError(error);
    }
  }

  createClientWithRefreshToken(refreshToken: string): OAuth2Client {
    const client = this.createClient();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  async getAccessToken(client: OAuth2Client): Promise<string> {
    try {
      const { token } = await client.getAccessToken();
      if (!token) {
        throw new UnauthorizedError('Google did not return an access token. Reconnect Gmail.');
      }
      return token;
    } catch (error) {
      throw mapOAuthError(error);
    }
  }
}
