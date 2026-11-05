import type { FastifyServerOptions } from 'fastify';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { buildApp } from './http/app';

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);

const redact = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];
const logger: FastifyServerOptions['logger'] =
  config.nodeEnv === 'development'
    ? {
        level: config.logLevel,
        redact,
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : { level: config.logLevel, redact };

const app = await buildApp({
  config,
  db,
  logger,
  autoConnectGmail: true,
  autoSyncTracking: true,
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { host: config.host, port: config.port, appBaseUrl: config.appBaseUrl },
    'Gmail Send Tracker API listening',
  );
} catch (error) {
  app.log.error({ err: error }, 'Failed to start API');
  await pool.end();
  process.exitCode = 1;
}
