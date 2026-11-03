import { z } from 'zod';
import { ValidationError } from '../domain/errors';
import type { SendStatus } from '../domain/types';
import type { SendFilters, SummaryFilters } from '../repositories/send-repository';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

const queryString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
const dateQuery = z.preprocess(emptyToUndefined, z.coerce.date().optional());
const statusQuery = z.preprocess(
  emptyToUndefined,
  z.enum(['SENDING', 'SENT', 'VERIFIED', 'FAILED']).optional(),
);

export interface SendFilterQuery {
  clientId?: string | undefined;
  status?: SendStatus | undefined;
  q?: string | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}

export const sendFilterQuerySchema = z.object({
  clientId: queryString,
  status: statusQuery,
  q: queryString,
  createdFrom: dateQuery,
  createdTo: dateQuery,
});

export const sendListQuerySchema = sendFilterQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const exportQuerySchema = sendFilterQuerySchema;

export const summaryQuerySchema = z.object({
  clientId: queryString,
  createdFrom: dateQuery,
  createdTo: dateQuery,
});

export const dailyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
  clientId: queryString,
});

export const reconcileBodySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(2),
});

export const clientBodySchema = z.strictObject({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'id must be lowercase letters, digits, or dashes'),
  name: z.string().trim().min(1, 'name is required').max(200, 'name is too long'),
});

export const sendIdParamsSchema = z.object({
  id: z.string().regex(UUID_PATTERN, 'Invalid send id'),
});

export const trackingTokenParamsSchema = z.object({
  token: z.string().trim().min(1).max(100),
});

export const trackingSyncBodySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional(),
});

const trackingEventTypeSchema = z.enum([
  'DELIVERED',
  'DEFERRED',
  'BOUNCED',
  'OPENED',
  'READ',
  'ACKNOWLEDGED',
  'REPLIED',
  'COMPLAINED',
]);

export const trackingWebhookBodySchema = z
  .object({
    trackingId: z.string().trim().min(1).optional(),
    messageIdHeader: z.string().trim().min(1).optional(),
    providerMessageId: z.string().trim().min(1).optional(),
    eventType: trackingEventTypeSchema,
    occurredAt: z.coerce.date().optional(),
    providerEventId: z.string().trim().min(1).max(200).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (value) => Boolean(value.trackingId || value.messageIdHeader || value.providerMessageId),
    { message: 'trackingId, messageIdHeader, or providerMessageId is required' },
  );

export const oauthCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export function parseInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  message = 'Invalid request',
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      message,
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
  return result.data;
}

export function toSendFilters(query: SendFilterQuery): SendFilters {
  const filters: SendFilters = {};
  if (query.clientId !== undefined) {
    filters.clientId = query.clientId;
  }
  if (query.status !== undefined) {
    filters.status = query.status;
  }
  if (query.q !== undefined) {
    filters.q = query.q;
  }
  if (query.createdFrom !== undefined) {
    filters.createdFrom = query.createdFrom;
  }
  if (query.createdTo !== undefined) {
    filters.createdTo = query.createdTo;
  }
  return filters;
}

export function toSummaryFilters(query: {
  clientId?: string | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}): SummaryFilters {
  const filters: SummaryFilters = {};
  if (query.clientId !== undefined) {
    filters.clientId = query.clientId;
  }
  if (query.createdFrom !== undefined) {
    filters.createdFrom = query.createdFrom;
  }
  if (query.createdTo !== undefined) {
    filters.createdTo = query.createdTo;
  }
  return filters;
}
