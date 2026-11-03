import type { TrackingEventType, TrackingSource } from '../domain/tracking';
import type { MailboxConnection } from '../services/credential-service';

export interface TrackingSendRef {
  id: string;
  trackingId: string;
  messageIdHeader: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  sentAt: Date | null;
  repliedAt: Date | null;
}

export interface TrackingCollectInput {
  mailboxEmail: string;
  days: number;
  sends: TrackingSendRef[];
}

export interface ProviderTrackingEvent {
  sendId: string;
  trackingId: string;
  eventType: TrackingEventType;
  source: TrackingSource;
  providerEventId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export interface TrackingProvider {
  collectEvents(input: TrackingCollectInput): Promise<ProviderTrackingEvent[]>;
}

export type TrackingProviderResolver = (connection: MailboxConnection) => TrackingProvider;
