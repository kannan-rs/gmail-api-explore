import 'dotenv/config';
import { z } from 'zod';
import { ConfigError } from './domain/errors';

const booleanString = z.preprocess(
  (value) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value),
  z.boolean(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.url().optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.url().default('http://localhost:5173'),
  PUBLIC_BASE_URL: optionalUrl,
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REFRESH_TOKEN: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.url().default('http://localhost:3000/api/auth/google/callback'),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  COOKIE_SECRET: z.string().min(1),
  DAILY_SEND_LIMIT: z.coerce.number().int().positive().default(100),
  MAX_ATTACHMENT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),
  MAX_ATTACHMENTS: z.coerce.number().int().positive().default(10),
  GMAIL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LIVE_TEST_RECIPIENT: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
  TRACKING_ENABLED: booleanString.default(true),
  TRACKING_PIXEL_ENABLED: booleanString.default(true),
  TRACKING_ACK_ENABLED: booleanString.default(true),
  READ_RECEIPT_REQUESTED: booleanString.default(true),
  TRACKING_WEBHOOK_SECRET: z.string().default(''),
  TRACKING_SYNC_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  TRACKING_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly appBaseUrl: string;
  readonly publicBaseUrl: string;
  readonly databaseUrl: string;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly googleRefreshToken: string;
  readonly googleRedirectUri: string;
  readonly googleConfigured: boolean;
  readonly tokenEncryptionKey: string;
  readonly cookieSecret: string;
  readonly dailySendLimit: number;
  readonly maxAttachmentBytes: number;
  readonly maxAttachments: number;
  readonly gmailApiTimeoutMs: number;
  readonly liveTestRecipient: string;
  readonly logLevel: string;
  readonly trackingEnabled: boolean;
  readonly trackingPixelEnabled: boolean;
  readonly trackingAcknowledgementEnabled: boolean;
  readonly readReceiptRequested: boolean;
  readonly trackingWebhookSecret: string;
  readonly trackingSyncDays: number;
  readonly trackingSyncIntervalMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      'Invalid environment configuration',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  const data = result.data;
  const googleClientId = data.GOOGLE_CLIENT_ID.trim();
  const googleClientSecret = data.GOOGLE_CLIENT_SECRET.trim();
  const googleRefreshToken = data.GOOGLE_REFRESH_TOKEN.trim();
  const publicBaseUrl = (data.PUBLIC_BASE_URL ?? data.APP_BASE_URL).replace(/\/+$/, '');

  return {
    nodeEnv: data.NODE_ENV,
    host: data.HOST,
    port: data.PORT,
    appBaseUrl: data.APP_BASE_URL,
    publicBaseUrl,
    databaseUrl: data.DATABASE_URL,
    googleClientId,
    googleClientSecret,
    googleRefreshToken,
    googleRedirectUri: data.GOOGLE_REDIRECT_URI,
    googleConfigured: googleClientId.length > 0 && googleClientSecret.length > 0,
    tokenEncryptionKey: data.TOKEN_ENCRYPTION_KEY,
    cookieSecret: data.COOKIE_SECRET,
    dailySendLimit: data.DAILY_SEND_LIMIT,
    maxAttachmentBytes: data.MAX_ATTACHMENT_BYTES,
    maxAttachments: data.MAX_ATTACHMENTS,
    gmailApiTimeoutMs: data.GMAIL_API_TIMEOUT_MS,
    liveTestRecipient: data.LIVE_TEST_RECIPIENT.trim(),
    logLevel: data.LOG_LEVEL,
    trackingEnabled: data.TRACKING_ENABLED,
    trackingPixelEnabled: data.TRACKING_PIXEL_ENABLED,
    trackingAcknowledgementEnabled: data.TRACKING_ACK_ENABLED,
    readReceiptRequested: data.READ_RECEIPT_REQUESTED,
    trackingWebhookSecret: data.TRACKING_WEBHOOK_SECRET.trim(),
    trackingSyncDays: data.TRACKING_SYNC_DAYS,
    trackingSyncIntervalMinutes: data.TRACKING_SYNC_INTERVAL_MINUTES,
  };
}
