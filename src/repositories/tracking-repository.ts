import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { type EmailSendRow, emailSends, type TrackingEventRow, trackingEvents } from '../db/schema';
import { resolveBounceType, type TrackingEventType, type TrackingSource } from '../domain/tracking';

export interface RecordTrackingEventInput {
  sendId: string;
  trackingId: string;
  eventType: TrackingEventType;
  source: TrackingSource;
  providerEventId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export class TrackingRepository {
  constructor(private readonly db: Database) {}

  async findByTrackingId(trackingId: string): Promise<EmailSendRow | undefined> {
    const [row] = await this.db
      .select()
      .from(emailSends)
      .where(eq(emailSends.trackingId, trackingId))
      .limit(1);
    return row;
  }

  async findByMessageIdHeader(messageIdHeader: string): Promise<EmailSendRow | undefined> {
    const [row] = await this.db
      .select()
      .from(emailSends)
      .where(eq(emailSends.messageIdHeader, messageIdHeader))
      .limit(1);
    return row;
  }

  async findByProviderMessageId(providerMessageId: string): Promise<EmailSendRow | undefined> {
    const [row] = await this.db
      .select()
      .from(emailSends)
      .where(eq(emailSends.providerMessageId, providerMessageId))
      .limit(1);
    return row;
  }

  async findRecentTrackable(days: number, limit = 100): Promise<EmailSendRow[]> {
    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
    return this.db
      .select()
      .from(emailSends)
      .where(
        and(gte(emailSends.createdAt, since), inArray(emailSends.status, ['SENT', 'VERIFIED'])),
      )
      .orderBy(desc(emailSends.createdAt))
      .limit(Math.min(500, Math.max(1, limit)));
  }

  async record(input: RecordTrackingEventInput): Promise<TrackingEventRow | null> {
    const [row] = await this.db
      .insert(trackingEvents)
      .values(input)
      .onConflictDoNothing({
        target: [
          trackingEvents.sendId,
          trackingEvents.eventType,
          trackingEvents.source,
          trackingEvents.providerEventId,
        ],
      })
      .returning();
    return row ?? null;
  }

  async applyToSend(
    sendId: string,
    eventType: TrackingEventType,
    occurredAt: Date,
    payload: Record<string, unknown>,
  ): Promise<EmailSendRow | undefined> {
    const now = new Date();
    const base = { updatedAt: now };

    let patch: Record<string, unknown> | null = null;
    switch (eventType) {
      case 'DELIVERED':
        patch = { ...base, deliveredAt: sql`coalesce(${emailSends.deliveredAt}, ${occurredAt})` };
        break;
      case 'BOUNCED': {
        const bounceType = resolveBounceType(payload);
        patch = {
          ...base,
          bouncedAt: sql`coalesce(${emailSends.bouncedAt}, ${occurredAt})`,
          bounceType:
            bounceType === 'hard'
              ? sql`'hard'`
              : sql`case when ${emailSends.bounceType} = 'hard' then 'hard' else ${bounceType} end`,
        };
        break;
      }
      case 'OPENED':
        patch = {
          ...base,
          openedAt: sql`coalesce(${emailSends.openedAt}, ${occurredAt})`,
          lastOpenedAt: occurredAt,
          openCount: sql`${emailSends.openCount} + 1`,
        };
        break;
      case 'READ':
        patch = { ...base, readAt: sql`coalesce(${emailSends.readAt}, ${occurredAt})` };
        break;
      case 'ACKNOWLEDGED':
        patch = {
          ...base,
          acknowledgedAt: sql`coalesce(${emailSends.acknowledgedAt}, ${occurredAt})`,
        };
        break;
      case 'REPLIED':
        patch = { ...base, repliedAt: sql`coalesce(${emailSends.repliedAt}, ${occurredAt})` };
        break;
      case 'COMPLAINED':
        patch = { ...base, complainedAt: sql`coalesce(${emailSends.complainedAt}, ${occurredAt})` };
        break;
      case 'DEFERRED':
        patch = {
          ...base,
          deferredAt: sql`coalesce(${emailSends.deferredAt}, ${occurredAt})`,
          lastDeferredAt: occurredAt,
          deferredCount: sql`${emailSends.deferredCount} + 1`,
        };
        break;
    }

    if (!patch) {
      return undefined;
    }

    const [row] = await this.db
      .update(emailSends)
      .set(patch as Partial<typeof emailSends.$inferInsert>)
      .where(eq(emailSends.id, sendId))
      .returning();
    return row;
  }

  async getEvents(sendId: string): Promise<TrackingEventRow[]> {
    return this.db
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.sendId, sendId))
      .orderBy(asc(trackingEvents.occurredAt), asc(trackingEvents.createdAt));
  }
}
