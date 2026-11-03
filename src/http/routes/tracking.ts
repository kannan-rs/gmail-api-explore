import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError, UnauthorizedError } from '../../domain/errors';
import { isTrackingId } from '../../domain/tracking';
import type { AppContext } from '../context';
import {
  parseInput,
  trackingSyncBodySchema,
  trackingTokenParamsSchema,
  trackingWebhookBodySchema,
} from '../schemas';

const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function sendPixel(reply: FastifyReply): FastifyReply {
  return reply
    .header('Content-Type', 'image/gif')
    .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    .header('Pragma', 'no-cache')
    .send(TRANSPARENT_GIF);
}

function sendAckPage(reply: FastifyReply, recorded: boolean): FastifyReply {
  const message = recorded
    ? 'Your acknowledgement has been recorded.'
    : 'This acknowledgement link is not recognized.';
  return reply
    .header('Cache-Control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt acknowledgement</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#1c2330}h1{font-size:1.4rem}p{line-height:1.5;color:#475467}</style></head><body><h1>Receipt acknowledgement</h1><p>${message}</p></body></html>`,
    );
}

function secretsMatch(expected: string, provided: string | string[] | undefined): boolean {
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value || value.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export function registerTrackingRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/t/open/:token', async (request, reply) => {
    const { token } = parseInput(
      trackingTokenParamsSchema,
      request.params,
      'Invalid tracking token',
    );
    if (ctx.config.trackingEnabled && ctx.config.trackingPixelEnabled && isTrackingId(token)) {
      try {
        await ctx.trackingService.recordOpen(token, {
          userAgent: request.headers['user-agent'] ?? '',
        });
      } catch (error) {
        request.log.warn(
          { code: error instanceof AppError ? error.code : 'TRACKING_OPEN_FAILED' },
          'open tracking failed',
        );
      }
    }
    return sendPixel(reply);
  });

  app.get('/t/ack/:token', async (request, reply) => {
    const { token } = parseInput(
      trackingTokenParamsSchema,
      request.params,
      'Invalid tracking token',
    );
    if (
      !ctx.config.trackingEnabled ||
      !ctx.config.trackingAcknowledgementEnabled ||
      !isTrackingId(token)
    ) {
      return sendAckPage(reply.code(404), false);
    }
    const recorded = await ctx.trackingService.recordAcknowledgement(token, {
      userAgent: request.headers['user-agent'] ?? '',
    });
    return sendAckPage(reply.code(recorded ? 200 : 404), recorded);
  });

  app.post('/api/tracking/webhook', async (request, reply) => {
    if (ctx.config.trackingWebhookSecret.length === 0) {
      throw new AppError('Tracking webhook is not configured', {
        code: 'TRACKING_WEBHOOK_DISABLED',
        statusCode: 503,
      });
    }
    if (!secretsMatch(ctx.config.trackingWebhookSecret, request.headers['x-tracking-secret'])) {
      throw new UnauthorizedError('Invalid tracking webhook secret');
    }

    const body = parseInput(
      trackingWebhookBodySchema,
      request.body ?? {},
      'Invalid tracking event',
    );
    const result = await ctx.trackingService.recordWebhook(body);
    return reply.code(202).send(result);
  });

  app.post('/api/tracking/sync', async (request) => {
    const body = parseInput(
      trackingSyncBodySchema,
      request.body ?? {},
      'Invalid tracking sync request',
    );
    return ctx.trackingService.sync(body.days ?? ctx.config.trackingSyncDays);
  });
}
