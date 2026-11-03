import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppConfig, loadConfig } from '../../src/config';
import { createDatabase, type Database } from '../../src/db/client';
import { buildApp } from '../../src/http/app';

const live = process.env.RUN_LIVE_GMAIL_TESTS === '1';
const describeLive = live ? describe : describe.skip;

describeLive('Gmail live smoke test', () => {
  let config: AppConfig;
  let db: Database;
  let pool: Awaited<ReturnType<typeof createDatabase>>['pool'];
  let app: FastifyInstance;

  beforeAll(async () => {
    config = loadConfig();
    const connection = createDatabase(config.databaseUrl, 2);
    db = connection.db;
    pool = connection.pool;
    app = await buildApp({ config, db });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('sends through Gmail, verifies the SENT copy, and returns a deep link', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(me.statusCode).toBe(200);
    const identity = me.json();

    if (!identity.connected || !identity.mailbox?.email) {
      console.warn('Skipping live send: no Gmail mailbox is connected in the configured database.');
      return;
    }

    await app.inject({
      method: 'POST',
      url: '/api/clients',
      payload: { id: 'client-01', name: 'Client 01' },
    });

    const recipient = config.liveTestRecipient || identity.mailbox.email;
    const subject = `Gmail Send Tracker live test ${new Date().toISOString()}`;
    const send = await app.inject({
      method: 'POST',
      url: '/api/sends',
      payload: {
        clientId: 'client-01',
        to: [recipient],
        subject,
        text: 'Live smoke test from the Gmail Send Tracker. The Gmail Sent copy is the audit evidence.',
        idempotencyKey: randomUUID(),
      },
    });

    expect(send.statusCode).toBe(201);
    const result = send.json();
    expect(result.send.providerMessageId).toBeTruthy();
    expect(['SENT', 'VERIFIED']).toContain(result.send.status);
    expect(result.gmailUrl).toContain('#sent/');

    const verify = await app.inject({
      method: 'POST',
      url: `/api/sends/${result.send.id}/verify`,
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().verified).toBe(true);
  });
});
