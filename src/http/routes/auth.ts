import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError, isAppError, UnauthorizedError } from '../../domain/errors';
import type { AppContext } from '../context';
import { oauthCallbackQuerySchema, parseInput } from '../schemas';

const OAUTH_STATE_COOKIE = 'gmail_oauth_state';
const OAUTH_STATE_PATH = '/api/auth/google';

function stateCookieOptions(config: AppContext['config']) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.nodeEnv === 'production',
    path: OAUTH_STATE_PATH,
    maxAge: 600,
    signed: true,
  };
}

function redirectWithError(
  config: AppContext['config'],
  reply: FastifyReply,
  message: string,
): FastifyReply {
  return reply.redirect(`${config.appBaseUrl}/?oauth_error=${encodeURIComponent(message)}`);
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/auth/google', async (_request, reply) => {
    if (!ctx.config.googleConfigured) {
      throw new AppError(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        {
          code: 'GOOGLE_NOT_CONFIGURED',
          statusCode: 503,
        },
      );
    }

    const state = randomBytes(32).toString('base64url');
    reply.setCookie(OAUTH_STATE_COOKIE, state, stateCookieOptions(ctx.config));
    return reply.redirect(ctx.oauth.getAuthorizationUrl(state));
  });

  app.get('/api/auth/google/callback', async (request, reply) => {
    const query = parseInput(
      oauthCallbackQuerySchema,
      request.query,
      'Invalid Google OAuth callback',
    );

    const cookie = request.cookies[OAUTH_STATE_COOKIE];
    const unsigned = cookie ? request.unsignCookie(cookie) : null;
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_PATH });

    if (!unsigned?.valid) {
      throw new UnauthorizedError(
        'Google OAuth state is missing or invalid. Try connecting again.',
      );
    }

    if (query.error) {
      return redirectWithError(ctx.config, reply, 'Google connection was cancelled');
    }

    if (!query.code || !query.state || query.state !== unsigned.value) {
      throw new UnauthorizedError(
        'Google OAuth state is missing or invalid. Try connecting again.',
      );
    }

    try {
      const connection = await ctx.credentials.connect(query.code);
      return reply.redirect(
        `${ctx.config.appBaseUrl}/?connected=${encodeURIComponent(connection.mailbox.email)}`,
      );
    } catch (error) {
      return redirectWithError(
        ctx.config,
        reply,
        isAppError(error) ? error.message : 'Google connection failed',
      );
    }
  });

  app.get('/api/auth/me', async () => {
    const active = await ctx.credentials.getActiveMailbox();
    return {
      configured: ctx.config.googleConfigured,
      connected: active !== null,
      autoConnect: ctx.config.googleRefreshToken.length > 0,
      mailbox: active
        ? {
            id: active.mailbox.id,
            email: active.mailbox.email,
            displayName: active.mailbox.displayName,
            provider: active.mailbox.provider,
            createdAt: active.mailbox.createdAt,
            updatedAt: active.mailbox.updatedAt,
          }
        : null,
    };
  });

  app.post('/api/auth/disconnect', async (_request, reply) => {
    await ctx.credentials.disconnect();
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_PATH });
    return { connected: false };
  });
}
