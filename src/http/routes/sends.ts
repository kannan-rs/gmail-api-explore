import type { FastifyInstance } from 'fastify';
import type { EmailSendRow } from '../../db/schema';
import { NotFoundError } from '../../domain/errors';
import { buildGmailSentUrl } from '../../domain/gmail-url';
import { buildTrackingLinks } from '../../domain/tracking';
import type { AppContext } from '../context';
import { type CsvColumn, toCsv } from '../csv';
import {
  exportQuerySchema,
  parseInput,
  reconcileBodySchema,
  sendIdParamsSchema,
  sendListQuerySchema,
  toSendFilters,
} from '../schemas';

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'id', header: 'id' },
  { key: 'createdAt', header: 'created_at' },
  { key: 'clientId', header: 'client_id' },
  { key: 'provider', header: 'provider' },
  { key: 'mode', header: 'mode' },
  { key: 'status', header: 'status' },
  { key: 'fromEmail', header: 'from_email' },
  { key: 'toEmails', header: 'to' },
  { key: 'ccEmails', header: 'cc' },
  { key: 'bccEmails', header: 'bcc' },
  { key: 'subject', header: 'subject' },
  { key: 'messageIdHeader', header: 'message_id_header' },
  { key: 'trackingId', header: 'tracking_id' },
  { key: 'providerMessageId', header: 'provider_message_id' },
  { key: 'providerThreadId', header: 'provider_thread_id' },
  { key: 'sentAt', header: 'sent_at' },
  { key: 'verifiedAt', header: 'verified_at' },
  { key: 'deliveredAt', header: 'delivered_at' },
  { key: 'bouncedAt', header: 'bounced_at' },
  { key: 'bounceType', header: 'bounce_type' },
  { key: 'deferredAt', header: 'deferred_at' },
  { key: 'lastDeferredAt', header: 'last_deferred_at' },
  { key: 'deferredCount', header: 'deferred_count' },
  { key: 'openedAt', header: 'opened_at' },
  { key: 'lastOpenedAt', header: 'last_opened_at' },
  { key: 'openCount', header: 'open_count' },
  { key: 'readAt', header: 'read_at' },
  { key: 'acknowledgedAt', header: 'acknowledged_at' },
  { key: 'repliedAt', header: 'replied_at' },
  { key: 'complainedAt', header: 'complained_at' },
  { key: 'errorCode', header: 'error_code' },
  { key: 'errorMessage', header: 'error_message' },
  { key: 'gmailUrl', header: 'gmail_url' },
];

function gmailUrlFor(send: EmailSendRow): string | null {
  if (!send.providerMessageId) {
    return null;
  }
  return buildGmailSentUrl(send.fromEmail, send.providerMessageId);
}

function exportValue(send: EmailSendRow, key: string): unknown {
  if (key === 'gmailUrl') {
    return gmailUrlFor(send);
  }
  if (
    key === 'createdAt' ||
    key === 'sentAt' ||
    key === 'verifiedAt' ||
    key === 'deliveredAt' ||
    key === 'bouncedAt' ||
    key === 'deferredAt' ||
    key === 'lastDeferredAt' ||
    key === 'openedAt' ||
    key === 'lastOpenedAt' ||
    key === 'readAt' ||
    key === 'acknowledgedAt' ||
    key === 'repliedAt' ||
    key === 'complainedAt'
  ) {
    const value = send[key];
    return value instanceof Date ? value.toISOString() : value;
  }
  if (key === 'toEmails' || key === 'ccEmails' || key === 'bccEmails') {
    return send[key].join('; ');
  }
  return (send as unknown as Record<string, unknown>)[key];
}

export function registerSendRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/sends', async (request, reply) => {
    const result = await ctx.sendService.send(request.body);
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });

  app.get('/api/sends', async (request) => {
    const query = parseInput(sendListQuerySchema, request.query, 'Invalid send filters');
    const filters = toSendFilters(query);
    filters.page = query.page;
    filters.pageSize = query.pageSize;
    return ctx.sends.list(filters);
  });

  app.get('/api/sends/export', async (request, reply) => {
    const query = parseInput(exportQuerySchema, request.query, 'Invalid export filters');
    const rows = await ctx.sends.exportRows(toSendFilters(query), 10_000);
    const csv = toCsv(
      CSV_COLUMNS,
      rows.map((row) =>
        Object.fromEntries(CSV_COLUMNS.map((column) => [column.key, exportValue(row, column.key)])),
      ),
    );

    const filename = `gmail-sends-${new Date().toISOString().slice(0, 10)}.csv`;
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.post('/api/sends/reconcile', async (request) => {
    const body = parseInput(
      reconcileBodySchema,
      request.body ?? {},
      'Invalid reconciliation request',
    );
    return ctx.verificationService.reconcile(body.days);
  });

  app.get('/api/sends/:id', async (request) => {
    const { id } = parseInput(sendIdParamsSchema, request.params, 'Invalid send id');
    const send = await ctx.sends.findById(id);
    if (!send) {
      throw new NotFoundError('Send record not found');
    }
    const events = await ctx.sends.getEvents(send.id);
    const trackingEvents = await ctx.tracking.getEvents(send.id);
    const trackingLinks = ctx.config.trackingEnabled
      ? buildTrackingLinks(ctx.config.publicBaseUrl, send.trackingId, {
          pixelEnabled: ctx.config.trackingPixelEnabled,
          acknowledgementEnabled: ctx.config.trackingAcknowledgementEnabled,
        })
      : null;
    return { send, events, trackingEvents, trackingLinks, gmailUrl: gmailUrlFor(send) };
  });

  app.post('/api/sends/:id/verify', async (request) => {
    const { id } = parseInput(sendIdParamsSchema, request.params, 'Invalid send id');
    const result = await ctx.verificationService.verify(id);
    return { ...result, gmailUrl: gmailUrlFor(result.send) };
  });
}
