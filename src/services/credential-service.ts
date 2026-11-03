import type { OAuth2Client } from 'google-auth-library';
import type { MailboxRow, OAuthCredentialRow } from '../db/schema';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import {
  GMAIL_OAUTH_SCOPES,
  type GmailOAuthService,
  type GoogleProfile,
} from '../providers/gmail/oauth';
import type { CredentialRepository } from '../repositories/credential-repository';
import type { MailboxRepository } from '../repositories/mailbox-repository';
import type { TokenCipher } from './crypto';

export interface MailboxConnection {
  mailbox: MailboxRow;
  credential: OAuthCredentialRow;
  auth: OAuth2Client;
}

export interface SaveConnectionInput {
  profile: GoogleProfile;
  refreshToken: string;
  scopes: string[];
  tokenType: string;
}

export class CredentialService {
  constructor(
    private readonly mailboxes: MailboxRepository,
    private readonly credentials: CredentialRepository,
    private readonly cipher: TokenCipher,
    private readonly oauth: GmailOAuthService,
  ) {}

  getAuthorizationUrl(state: string): string {
    return this.oauth.getAuthorizationUrl(state);
  }

  async saveConnection(input: SaveConnectionInput): Promise<MailboxConnection> {
    if (!input.refreshToken) {
      throw new UnauthorizedError(
        'Google did not return a refresh token. Remove the app from your Google account and reconnect.',
      );
    }

    const mailbox = await this.mailboxes.upsert({
      provider: 'gmail',
      email: input.profile.email,
      displayName: input.profile.name,
    });
    const credential = await this.credentials.upsert({
      mailboxId: mailbox.id,
      refreshTokenEncrypted: this.cipher.encrypt(input.refreshToken),
      scopes: input.scopes.length > 0 ? input.scopes : [...GMAIL_OAUTH_SCOPES],
      tokenType: input.tokenType || 'Bearer',
    });

    return {
      mailbox,
      credential,
      auth: this.oauth.createClientWithRefreshToken(input.refreshToken),
    };
  }

  async connect(code: string): Promise<MailboxConnection> {
    const { tokens, profile } = await this.oauth.exchangeCode(code);
    return this.saveConnection({
      profile,
      refreshToken: tokens.refresh_token ?? '',
      scopes: tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [],
      tokenType: tokens.token_type ?? 'Bearer',
    });
  }

  async getActiveConnection(): Promise<MailboxConnection> {
    const latest = await this.credentials.findLatestWithMailbox();
    if (!latest) {
      throw new UnauthorizedError('Connect a Gmail account before sending');
    }
    return this.buildConnection(latest.mailbox, latest.credential);
  }

  async getActiveMailbox(): Promise<{
    mailbox: MailboxRow;
    credential: OAuthCredentialRow;
  } | null> {
    return (await this.credentials.findLatestWithMailbox()) ?? null;
  }

  async getConnectionForMailbox(mailboxId: string): Promise<MailboxConnection> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox) {
      throw new NotFoundError('Mailbox not found');
    }
    const credential = await this.credentials.findByMailboxId(mailboxId);
    if (!credential) {
      throw new UnauthorizedError('This mailbox is not connected. Reconnect Gmail.');
    }
    return this.buildConnection(mailbox, credential);
  }

  async disconnect(): Promise<void> {
    const latest = await this.credentials.findLatestWithMailbox();
    if (!latest) {
      return;
    }
    await this.credentials.deleteByMailboxId(latest.mailbox.id);
  }

  private buildConnection(mailbox: MailboxRow, credential: OAuthCredentialRow): MailboxConnection {
    let refreshToken: string;
    try {
      refreshToken = this.cipher.decrypt(credential.refreshTokenEncrypted);
    } catch {
      throw new UnauthorizedError(
        'Stored Gmail authorization could not be read. Reconnect the Gmail account.',
      );
    }

    return {
      mailbox,
      credential,
      auth: this.oauth.createClientWithRefreshToken(refreshToken),
    };
  }
}
