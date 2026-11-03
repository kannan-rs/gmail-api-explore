import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (_request, reply) => {
    let databaseOk = true;
    try {
      await ctx.db.execute(sql`select 1`);
    } catch {
      databaseOk = false;
    }

    const active = databaseOk ? await ctx.credentials.getActiveMailbox() : null;

    return reply.code(databaseOk ? 200 : 503).send({
      status: databaseOk ? 'ok' : 'degraded',
      database: databaseOk ? 'ok' : 'error',
      gmail: ctx.config.googleConfigured ? 'configured' : 'not_configured',
      mailbox: active?.mailbox.email ?? null,
      time: new Date().toISOString(),
    });
  });
}
