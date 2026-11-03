import { and, asc, desc, eq, gte, inArray, lte, or, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  type EmailSendEventRow,
  type EmailSendRow,
  emailSendEvents,
  emailSends,
} from '../db/schema';
import { NotFoundError } from '../domain/errors';
import type { AttachmentMetadata, EmailProviderName, SendMode, SendStatus } from '../domain/types';

export interface CreateSendInput {
  provider: EmailProviderName;
  mode: SendMode;
  mailboxId: string | null;
  clientId: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: AttachmentMetadata[];
  messageIdHeader: string;
  trackingId?: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface UpdateSendStatusInput {
  status: SendStatus;
  providerMessageId: string | null;
  providerThreadId: string | null;
  providerLabels: string[] | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  verifiedAt: Date | null;
}

export interface SendFilters {
  clientId?: string;
  status?: SendStatus;
  q?: string;
  createdFrom?: Date;
  createdTo?: Date;
  page?: number;
  pageSize?: number;
}

export interface SummaryFilters {
  clientId?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

export interface ListSendsResult {
  items: EmailSendRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SendSummary {
  total: number;
  sent: number;
  verified: number;
  failed: number;
  inFlight: number;
  delivered: number;
  bounced: number;
  opened: number;
  read: number;
  acknowledged: number;
  replied: number;
}

export interface DailySendCount {
  date: string;
  sent: number;
  failed: number;
  total: number;
}

export interface ClientSendCount {
  clientId: string;
  sent: number;
  failed: number;
  total: number;
}

function buildConditions(filters: SummaryFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.clientId) {
    conditions.push(eq(emailSends.clientId, filters.clientId));
  }
  if (filters.createdFrom) {
    conditions.push(gte(emailSends.createdAt, filters.createdFrom));
  }
  if (filters.createdTo) {
    conditions.push(lte(emailSends.createdAt, filters.createdTo));
  }
  return conditions;
}

function buildSendConditions(filters: SendFilters): SQL[] {
  const conditions = buildConditions(filters);
  if (filters.status) {
    conditions.push(eq(emailSends.status, filters.status));
  }
  if (filters.q && filters.q.trim().length > 0) {
    const like = `%${filters.q.trim()}%`;
    const search = or(
      sql`${emailSends.subject} ilike ${like}`,
      sql`${emailSends.fromEmail} ilike ${like}`,
      sql`array_to_string(${emailSends.toEmails}, ',') ilike ${like}`,
      sql`array_to_string(${emailSends.ccEmails}, ',') ilike ${like}`,
    );
    if (search) {
      conditions.push(search);
    }
  }
  return conditions;
}

function whereClause(conditions: SQL[]): SQL | undefined {
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export class SendRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateSendInput): Promise<EmailSendRow> {
    const [row] = await this.db.insert(emailSends).values(input).returning();
    if (!row) {
      throw new Error('Failed to create send record');
    }
    return row;
  }

  async findById(id: string): Promise<EmailSendRow | undefined> {
    const [row] = await this.db.select().from(emailSends).where(eq(emailSends.id, id)).limit(1);
    return row;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<EmailSendRow | undefined> {
    const [row] = await this.db
      .select()
      .from(emailSends)
      .where(eq(emailSends.idempotencyKey, idempotencyKey))
      .limit(1);
    return row;
  }

  async updateStatus(id: string, patch: UpdateSendStatusInput): Promise<EmailSendRow> {
    const update: Partial<typeof emailSends.$inferInsert> = {
      status: patch.status,
      updatedAt: new Date(),
    };

    if (patch.providerMessageId !== undefined) {
      update.providerMessageId = patch.providerMessageId;
    }
    if (patch.providerThreadId !== undefined) {
      update.providerThreadId = patch.providerThreadId;
    }
    if (patch.providerLabels !== undefined) {
      update.providerLabels = patch.providerLabels;
    }
    if (patch.errorCode !== undefined) {
      update.errorCode = patch.errorCode;
    }
    if (patch.errorMessage !== undefined) {
      update.errorMessage = patch.errorMessage;
    }
    if (patch.sentAt !== undefined) {
      update.sentAt = patch.sentAt;
    }
    if (patch.verifiedAt !== undefined) {
      update.verifiedAt = patch.verifiedAt;
    }

    const [row] = await this.db
      .update(emailSends)
      .set(update)
      .where(eq(emailSends.id, id))
      .returning();

    if (!row) {
      throw new NotFoundError('Send record not found');
    }
    return row;
  }

  async addEvent(
    sendId: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<EmailSendEventRow> {
    const [row] = await this.db
      .insert(emailSendEvents)
      .values({ sendId, eventType, payload })
      .returning();
    if (!row) {
      throw new Error('Failed to create send event');
    }
    return row;
  }

  async getEvents(sendId: string): Promise<EmailSendEventRow[]> {
    return this.db
      .select()
      .from(emailSendEvents)
      .where(eq(emailSendEvents.sendId, sendId))
      .orderBy(asc(emailSendEvents.createdAt));
  }

  async list(filters: SendFilters = {}): Promise<ListSendsResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const where = whereClause(buildSendConditions(filters));

    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(emailSends)
        .where(where)
        .orderBy(desc(emailSends.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ value: sql<number>`count(*)::int` }).from(emailSends).where(where),
    ]);

    return {
      items,
      total: totalRows[0]?.value ?? 0,
      page,
      pageSize,
    };
  }

  async exportRows(filters: SendFilters = {}, limit = 10_000): Promise<EmailSendRow[]> {
    const safeLimit = Math.min(50_000, Math.max(1, limit));
    return this.db
      .select()
      .from(emailSends)
      .where(whereClause(buildSendConditions(filters)))
      .orderBy(desc(emailSends.createdAt))
      .limit(safeLimit);
  }

  async summary(filters: SummaryFilters = {}): Promise<SendSummary> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        sent: sql<number>`(count(*) filter (where ${emailSends.status} in ('SENT', 'VERIFIED')))::int`,
        verified: sql<number>`(count(*) filter (where ${emailSends.status} = 'VERIFIED'))::int`,
        failed: sql<number>`(count(*) filter (where ${emailSends.status} = 'FAILED'))::int`,
        inFlight: sql<number>`(count(*) filter (where ${emailSends.status} = 'SENDING'))::int`,
        delivered: sql<number>`(count(*) filter (where ${emailSends.deliveredAt} is not null))::int`,
        bounced: sql<number>`(count(*) filter (where ${emailSends.bouncedAt} is not null))::int`,
        opened: sql<number>`(count(*) filter (where ${emailSends.openedAt} is not null))::int`,
        read: sql<number>`(count(*) filter (where ${emailSends.readAt} is not null))::int`,
        acknowledged: sql<number>`(count(*) filter (where ${emailSends.acknowledgedAt} is not null))::int`,
        replied: sql<number>`(count(*) filter (where ${emailSends.repliedAt} is not null))::int`,
      })
      .from(emailSends)
      .where(whereClause(buildConditions(filters)));

    return (
      row ?? {
        total: 0,
        sent: 0,
        verified: 0,
        failed: 0,
        inFlight: 0,
        delivered: 0,
        bounced: 0,
        opened: 0,
        read: 0,
        acknowledged: 0,
        replied: 0,
      }
    );
  }

  async daily(days = 14, clientId?: string): Promise<DailySendCount[]> {
    const safeDays = Math.min(90, Math.max(1, days));
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (safeDays - 1));

    const conditions: SQL[] = [gte(emailSends.createdAt, since)];
    if (clientId) {
      conditions.push(eq(emailSends.clientId, clientId));
    }

    const dayGroup = sql`date_trunc('day', ${emailSends.createdAt} at time zone 'UTC')`;

    return this.db
      .select({
        date: sql<string>`to_char(${dayGroup}, 'YYYY-MM-DD')`,
        sent: sql<number>`(count(*) filter (where ${emailSends.status} in ('SENT', 'VERIFIED')))::int`,
        failed: sql<number>`(count(*) filter (where ${emailSends.status} = 'FAILED'))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(emailSends)
      .where(whereClause(conditions))
      .groupBy(dayGroup)
      .orderBy(dayGroup);
  }

  async byClient(filters: SummaryFilters = {}): Promise<ClientSendCount[]> {
    return this.db
      .select({
        clientId: emailSends.clientId,
        sent: sql<number>`(count(*) filter (where ${emailSends.status} in ('SENT', 'VERIFIED')))::int`,
        failed: sql<number>`(count(*) filter (where ${emailSends.status} = 'FAILED'))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(emailSends)
      .where(whereClause(buildConditions(filters)))
      .groupBy(emailSends.clientId)
      .orderBy(asc(emailSends.clientId));
  }

  async countToday(mailboxId?: string): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);

    const conditions: SQL[] = [
      gte(emailSends.createdAt, start),
      inArray(emailSends.status, ['SENDING', 'SENT', 'VERIFIED']),
    ];
    if (mailboxId) {
      conditions.push(eq(emailSends.mailboxId, mailboxId));
    }

    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(emailSends)
      .where(and(...conditions));

    return row?.value ?? 0;
  }

  async recentForReconciliation(days = 2, limit = 500): Promise<EmailSendRow[]> {
    const safeDays = Math.max(1, days);
    const safeLimit = Math.min(2_000, Math.max(1, limit));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    return this.db
      .select()
      .from(emailSends)
      .where(and(gte(emailSends.createdAt, since), inArray(emailSends.status, ['SENT', 'SENDING'])))
      .orderBy(asc(emailSends.createdAt))
      .limit(safeLimit);
  }
}
