import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { GoogleGmailApi } from '../providers/gmail/gmail-api';
import { GmailProvider } from '../providers/gmail/gmail-provider';
import { GmailTrackingProvider } from '../providers/gmail/gmail-tracking-provider';
import { GmailOAuthService } from '../providers/gmail/oauth';
import type { TrackingProviderResolver } from '../providers/tracking-provider';
import { ClientRepository } from '../repositories/client-repository';
import { CredentialRepository } from '../repositories/credential-repository';
import { MailboxRepository } from '../repositories/mailbox-repository';
import { SendRepository } from '../repositories/send-repository';
import { TrackingRepository } from '../repositories/tracking-repository';
import { CredentialService } from '../services/credential-service';
import { TokenCipher } from '../services/crypto';
import type { ProviderResolver } from '../services/provider-resolver';
import { SendService } from '../services/send-service';
import { TrackingService } from '../services/tracking-service';
import { VerificationService } from '../services/verification-service';
import type { AppContext } from './context';
import { errorHandler } from './errors';
import { registerAuthRoutes } from './routes/auth';
import { registerClientRoutes } from './routes/clients';
import { registerHealthRoutes } from './routes/health';
import { registerSendRoutes } from './routes/sends';
import { registerStatsRoutes } from './routes/stats';
import { registerTrackingRoutes } from './routes/tracking';

export interface BuildAppOptions {
  config: AppConfig;
  db: Database;
  resolveProvider?: ProviderResolver;
  resolveTrackingProvider?: TrackingProviderResolver;
  logger?: FastifyServerOptions['logger'];
}

function defaultProviderResolver(config: AppConfig): ProviderResolver {
  return (connection) =>
    new GmailProvider(new GoogleGmailApi(connection.auth, config.gmailApiTimeoutMs));
}

function defaultTrackingProviderResolver(config: AppConfig): TrackingProviderResolver {
  return (connection) =>
    new GmailTrackingProvider(new GoogleGmailApi(connection.auth, config.gmailApiTimeoutMs));
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const sends = new SendRepository(db);
  const tracking = new TrackingRepository(db);
  const clients = new ClientRepository(db);
  const mailboxes = new MailboxRepository(db);
  const credentialsRepo = new CredentialRepository(db);
  const oauth = new GmailOAuthService({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  });
  const credentials = new CredentialService(
    mailboxes,
    credentialsRepo,
    new TokenCipher(config.tokenEncryptionKey),
    oauth,
  );
  const resolveProvider = options.resolveProvider ?? defaultProviderResolver(config);
  const resolveTrackingProvider =
    options.resolveTrackingProvider ?? defaultTrackingProviderResolver(config);
  const sendService = new SendService({
    sends,
    clients,
    credentials,
    resolveProvider,
    config: {
      dailySendLimit: config.dailySendLimit,
      maxAttachmentBytes: config.maxAttachmentBytes,
      maxAttachments: config.maxAttachments,
      publicBaseUrl: config.publicBaseUrl,
      trackingEnabled: config.trackingEnabled,
      trackingPixelEnabled: config.trackingPixelEnabled,
      trackingAcknowledgementEnabled: config.trackingAcknowledgementEnabled,
      readReceiptRequested: config.readReceiptRequested,
    },
  });
  const verificationService = new VerificationService({
    sends,
    credentials,
    resolveProvider,
  });
  const trackingService = new TrackingService({
    tracking,
    credentials,
    resolveTrackingProvider,
  });

  const ctx: AppContext = {
    config,
    db,
    clients,
    mailboxes,
    sends,
    tracking,
    credentials,
    sendService,
    verificationService,
    trackingService,
    oauth,
  };

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: Math.ceil(config.maxAttachmentBytes * 1.5) + 1024 * 1024,
  });

  await app.register(cookie, { secret: config.cookieSecret });
  app.setErrorHandler(errorHandler);

  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerClientRoutes(app, ctx);
  registerSendRoutes(app, ctx);
  registerStatsRoutes(app, ctx);
  registerTrackingRoutes(app, ctx);

  if (config.nodeEnv === 'production') {
    await app.register(fastifyStatic, {
      root: path.resolve(process.cwd(), 'dist/web'),
      prefix: '/',
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
        },
      });
    }

    if (config.nodeEnv === 'production' && request.method === 'GET') {
      return reply.type('text/html').sendFile('index.html');
    }

    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Not found',
      },
    });
  });

  return app;
}
