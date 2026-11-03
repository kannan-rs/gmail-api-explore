import { randomUUID } from 'node:crypto';
import type { EmailSendRow, TrackingEventRow } from '../db/schema';
import type { TrackingEventType } from '../domain/tracking';
import type { TrackingProviderResolver, TrackingSendRef } from '../providers/tracking-provider';
import type { TrackingRepository } from '../repositories/tracking-repository';
import type { CredentialService } from './credential-service';

export interface TrackingServiceDeps {
  tracking: TrackingRepository;
  credentials: CredentialService;
  resolveTrackingProvider: TrackingProviderResolver;
}

export interface SyncTrackingResult {
  checked: number;
  events: number;
  recorded: number;
  duplicates: number;
  errors: number;
}

export interface WebhookTrackingInput {
  trackingId?: string | undefined;
  messageIdHeader?: string | undefined;
  providerMessageId?: string | undefined;
  eventType: TrackingEventType;
  occurredAt?: Date | undefined;
  providerEventId?: string | undefined;
  payload?: Record<string, unknown> | undefined;
}

export interface WebhookTrackingResult {
  recorded: boolean;
  reason: string | null;
  sendId: string | null;
  event: TrackingEventRow | null;
}

export class TrackingService {
  constructor(private readonly deps: TrackingServiceDeps) {}

  async recordOpen(trackingId: string, meta: Record<string, unknown> = {}): Promise<boolean> {
    const send = await this.deps.tracking.findByTrackingId(trackingId);
    if (!send) {
      return false;
    }
    const occurredAt = new Date();
    const event = await this.deps.tracking.record({
      sendId: send.id,
      trackingId: send.trackingId,
      eventType: 'OPENED',
      source: 'pixel',
      providerEventId: randomUUID(),
      occurredAt,
      payload: meta,
    });
    if (event) {
      await this.deps.tracking.applyToSend(send.id, 'OPENED', occurredAt, meta);
    }
    return event !== null;
  }

  async recordAcknowledgement(
    trackingId: string,
    meta: Record<string, unknown> = {},
  ): Promise<boolean> {
    const send = await this.deps.tracking.findByTrackingId(trackingId);
    if (!send) {
      return false;
    }
    const occurredAt = new Date();
    const event = await this.deps.tracking.record({
      sendId: send.id,
      trackingId: send.trackingId,
      eventType: 'ACKNOWLEDGED',
      source: 'ack_link',
      providerEventId: randomUUID(),
      occurredAt,
      payload: meta,
    });
    if (event) {
      await this.deps.tracking.applyToSend(send.id, 'ACKNOWLEDGED', occurredAt, meta);
    }
    return event !== null;
  }

  async recordWebhook(input: WebhookTrackingInput): Promise<WebhookTrackingResult> {
    const send = await this.findWebhookSend(input);
    if (!send) {
      return { recorded: false, reason: 'send_not_found', sendId: null, event: null };
    }

    const occurredAt = input.occurredAt ?? new Date();
    const payload = input.payload ?? {};
    const event = await this.deps.tracking.record({
      sendId: send.id,
      trackingId: send.trackingId,
      eventType: input.eventType,
      source: 'webhook',
      providerEventId: input.providerEventId ?? randomUUID(),
      occurredAt,
      payload,
    });

    if (!event) {
      return { recorded: false, reason: 'duplicate', sendId: send.id, event: null };
    }

    await this.deps.tracking.applyToSend(send.id, input.eventType, occurredAt, payload);
    return { recorded: true, reason: null, sendId: send.id, event };
  }

  async sync(days: number): Promise<SyncTrackingResult> {
    const connection = await this.deps.credentials.getActiveConnection();
    const rows = await this.deps.tracking.findRecentTrackable(days, 100);
    const sends: TrackingSendRef[] = rows
      .filter((row) => row.trackingId.length > 0)
      .map((row) => ({
        id: row.id,
        trackingId: row.trackingId,
        messageIdHeader: row.messageIdHeader,
        providerMessageId: row.providerMessageId,
        providerThreadId: row.providerThreadId,
        fromEmail: row.fromEmail,
        toEmails: row.toEmails,
        ccEmails: row.ccEmails,
        bccEmails: row.bccEmails,
        subject: row.subject,
        sentAt: row.sentAt,
        repliedAt: row.repliedAt,
      }));

    if (sends.length === 0) {
      return { checked: 0, events: 0, recorded: 0, duplicates: 0, errors: 0 };
    }

    const provider = this.deps.resolveTrackingProvider(connection);
    const events = await provider.collectEvents({
      mailboxEmail: connection.mailbox.email,
      days,
      sends,
    });

    let recorded = 0;
    let duplicates = 0;
    let errors = 0;
    for (const event of events) {
      try {
        const row = await this.deps.tracking.record({
          sendId: event.sendId,
          trackingId: event.trackingId,
          eventType: event.eventType,
          source: event.source,
          providerEventId: event.providerEventId,
          occurredAt: event.occurredAt,
          payload: event.payload,
        });
        if (!row) {
          duplicates += 1;
          continue;
        }
        await this.deps.tracking.applyToSend(
          event.sendId,
          event.eventType,
          event.occurredAt,
          event.payload,
        );
        recorded += 1;
      } catch {
        errors += 1;
      }
    }

    return {
      checked: sends.length,
      events: events.length,
      recorded,
      duplicates,
      errors,
    };
  }

  async getEvents(sendId: string): Promise<TrackingEventRow[]> {
    return this.deps.tracking.getEvents(sendId);
  }

  private async findWebhookSend(input: WebhookTrackingInput): Promise<EmailSendRow | undefined> {
    if (input.trackingId) {
      const send = await this.deps.tracking.findByTrackingId(input.trackingId);
      if (send) {
        return send;
      }
    }
    if (input.messageIdHeader) {
      const send = await this.deps.tracking.findByMessageIdHeader(input.messageIdHeader);
      if (send) {
        return send;
      }
    }
    if (input.providerMessageId) {
      return this.deps.tracking.findByProviderMessageId(input.providerMessageId);
    }
    return undefined;
  }
}
