import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createTrackingId } from '../domain/tracking';
import type { AttachmentMetadata, EmailProviderName, SendMode, SendStatus } from '../domain/types';

export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mailboxes = pgTable(
  'mailboxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').$type<EmailProviderName>().notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('mailboxes_provider_email_unique').on(table.provider, table.email),
    index('mailboxes_email_idx').on(table.email),
  ],
);

export const oauthCredentials = pgTable(
  'oauth_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
    scopes: text('scopes').array().notNull(),
    tokenType: text('token_type').notNull().default('Bearer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('oauth_credentials_mailbox_unique').on(table.mailboxId)],
);

export const emailSends = pgTable(
  'email_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').$type<EmailProviderName>().notNull().default('gmail'),
    mode: text('mode').$type<SendMode>().notNull().default('direct'),
    mailboxId: uuid('mailbox_id').references(() => mailboxes.id, { onDelete: 'set null' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    fromEmail: text('from_email').notNull(),
    toEmails: text('to_emails').array().notNull(),
    ccEmails: text('cc_emails').array().notNull(),
    bccEmails: text('bcc_emails').array().notNull(),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html'),
    bodyText: text('body_text'),
    attachments: jsonb('attachments').$type<AttachmentMetadata[]>().notNull().default([]),
    messageIdHeader: text('message_id_header').notNull(),
    trackingId: text('tracking_id')
      .notNull()
      .$defaultFn(() => createTrackingId()),
    providerMessageId: text('provider_message_id'),
    providerThreadId: text('provider_thread_id'),
    providerLabels: text('provider_labels').array(),
    status: text('status').$type<SendStatus>().notNull().default('SENDING'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    bounceType: text('bounce_type'),
    deferredAt: timestamp('deferred_at', { withTimezone: true }),
    lastDeferredAt: timestamp('last_deferred_at', { withTimezone: true }),
    deferredCount: integer('deferred_count').notNull().default(0),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    openCount: integer('open_count').notNull().default(0),
    readAt: timestamp('read_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    complainedAt: timestamp('complained_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('email_sends_idempotency_key_unique').on(table.idempotencyKey),
    uniqueIndex('email_sends_message_id_header_unique').on(table.messageIdHeader),
    uniqueIndex('email_sends_tracking_id_unique').on(table.trackingId),
    index('email_sends_client_created_at_idx').on(table.clientId, table.createdAt),
    index('email_sends_status_created_at_idx').on(table.status, table.createdAt),
    index('email_sends_provider_message_id_idx').on(table.providerMessageId),
  ],
);

export const emailSendEvents = pgTable(
  'email_send_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sendId: uuid('send_id')
      .notNull()
      .references(() => emailSends.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('email_send_events_send_created_idx').on(table.sendId, table.createdAt)],
);

export const trackingEvents = pgTable(
  'tracking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sendId: uuid('send_id')
      .notNull()
      .references(() => emailSends.id, { onDelete: 'cascade' }),
    trackingId: text('tracking_id').notNull(),
    eventType: text('event_type').notNull(),
    source: text('source').notNull(),
    providerEventId: text('provider_event_id').notNull().default(''),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tracking_events_send_created_idx').on(table.sendId, table.createdAt),
    index('tracking_events_tracking_id_idx').on(table.trackingId),
    uniqueIndex('tracking_events_dedupe_unique').on(
      table.sendId,
      table.eventType,
      table.source,
      table.providerEventId,
    ),
  ],
);

export type ClientRow = typeof clients.$inferSelect;
export type MailboxRow = typeof mailboxes.$inferSelect;
export type OAuthCredentialRow = typeof oauthCredentials.$inferSelect;
export type EmailSendRow = typeof emailSends.$inferSelect;
export type EmailSendEventRow = typeof emailSendEvents.$inferSelect;
export type TrackingEventRow = typeof trackingEvents.$inferSelect;
