import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/client';
import { UnauthorizedError } from '../../src/domain/errors';
import { GmailOAuthService } from '../../src/providers/gmail/oauth';
import { CredentialRepository } from '../../src/repositories/credential-repository';
import { MailboxRepository } from '../../src/repositories/mailbox-repository';
import { CredentialService } from '../../src/services/credential-service';
import { TokenCipher } from '../../src/services/crypto';
import { closeTestDatabase, getTestDatabase, resetTestDatabase } from '../helpers/db';

let db: Database;
let service: CredentialService;
let credentials: CredentialRepository;

const oauth = new GmailOAuthService({
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:3000/api/auth/google/callback',
});

beforeAll(async () => {
  const connection = await getTestDatabase();
  db = connection.db;
  const mailboxes = new MailboxRepository(db);
  credentials = new CredentialRepository(db);
  service = new CredentialService(
    mailboxes,
    credentials,
    new TokenCipher(Buffer.alloc(32, 9).toString('base64')),
    oauth,
  );
});

beforeEach(async () => {
  await resetTestDatabase();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('CredentialService', () => {
  it('stores an encrypted refresh token and returns a usable connection', async () => {
    const saved = await service.saveConnection({
      profile: { email: 'Owner@Example.com', name: 'Owner' },
      refreshToken: 'refresh-token-secret',
      scopes: ['gmail.send', 'gmail.metadata'],
      tokenType: 'Bearer',
    });

    expect(saved.mailbox.email).toBe('owner@example.com');
    expect(saved.auth.credentials.refresh_token).toBe('refresh-token-secret');
    expect(saved.credential.refreshTokenEncrypted).not.toContain('refresh-token-secret');

    const active = await service.getActiveConnection();
    expect(active.mailbox.email).toBe('owner@example.com');
    expect(active.auth.credentials.refresh_token).toBe('refresh-token-secret');

    const byMailbox = await service.getConnectionForMailbox(saved.mailbox.id);
    expect(byMailbox.auth.credentials.refresh_token).toBe('refresh-token-secret');
  });

  it('disconnects the active mailbox', async () => {
    const saved = await service.saveConnection({
      profile: { email: 'owner@example.com', name: null },
      refreshToken: 'refresh-token',
      scopes: ['gmail.send'],
      tokenType: 'Bearer',
    });

    await service.disconnect();

    expect(await credentials.findByMailboxId(saved.mailbox.id)).toBeUndefined();
    await expect(service.getActiveConnection()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a connection without a refresh token', async () => {
    await expect(
      service.saveConnection({
        profile: { email: 'owner@example.com', name: null },
        refreshToken: '',
        scopes: ['gmail.send'],
        tokenType: 'Bearer',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a missing mailbox connection', async () => {
    await expect(
      service.getConnectionForMailbox('00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow(/mailbox not found/i);
  });

  it('bootstraps a connection from an environment refresh token', async () => {
    vi.spyOn(oauth, 'getProfileWithRefreshToken').mockResolvedValue({
      email: 'auto@example.com',
      name: 'Auto',
    });

    const saved = await service.ensureConnectionFromRefreshToken('env-refresh-token');

    expect(saved.mailbox.email).toBe('auto@example.com');
    expect(saved.auth.credentials.refresh_token).toBe('env-refresh-token');

    const active = await service.getActiveConnection();
    expect(active.mailbox.email).toBe('auto@example.com');
  });

  it('replaces an existing connection when the environment token belongs to another mailbox', async () => {
    await service.saveConnection({
      profile: { email: 'owner@example.com', name: null },
      refreshToken: 'old-token',
      scopes: ['gmail.send'],
      tokenType: 'Bearer',
    });
    vi.spyOn(oauth, 'getProfileWithRefreshToken').mockResolvedValue({
      email: 'auto@example.com',
      name: null,
    });

    const saved = await service.ensureConnectionFromRefreshToken('new-token');

    expect(saved.mailbox.email).toBe('auto@example.com');
    expect(saved.auth.credentials.refresh_token).toBe('new-token');
  });

  it('keeps the existing connection when the environment token is invalid', async () => {
    await service.saveConnection({
      profile: { email: 'owner@example.com', name: null },
      refreshToken: 'existing-token',
      scopes: ['gmail.send'],
      tokenType: 'Bearer',
    });
    vi.spyOn(oauth, 'getProfileWithRefreshToken').mockRejectedValue(
      new UnauthorizedError('invalid environment token'),
    );

    await expect(service.ensureConnectionFromRefreshToken('bad-token')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    const active = await service.getActiveConnection();
    expect(active.mailbox.email).toBe('owner@example.com');
    expect(active.auth.credentials.refresh_token).toBe('existing-token');
  });
});
