import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { dailyQuerySchema, parseInput, summaryQuerySchema, toSummaryFilters } from '../schemas';

export function registerStatsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/stats/summary', async (request) => {
    const query = parseInput(summaryQuerySchema, request.query, 'Invalid summary filters');
    return ctx.sends.summary(toSummaryFilters(query));
  });

  app.get('/api/stats/daily', async (request) => {
    const query = parseInput(dailyQuerySchema, request.query, 'Invalid daily filters');
    const items = await ctx.sends.daily(query.days, query.clientId);
    return { items };
  });

  app.get('/api/stats/by-client', async (request) => {
    const query = parseInput(summaryQuerySchema, request.query, 'Invalid client filters');
    const items = await ctx.sends.byClient(toSummaryFilters(query));
    return { items };
  });
}
