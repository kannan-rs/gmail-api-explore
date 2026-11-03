import type { FastifyInstance } from 'fastify';
import { ConflictError } from '../../domain/errors';
import type { AppContext } from '../context';
import { clientBodySchema, parseInput } from '../schemas';

export function registerClientRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/clients', async () => {
    const items = await ctx.clients.list();
    return { items };
  });

  app.post('/api/clients', async (request, reply) => {
    const body = parseInput(clientBodySchema, request.body, 'Invalid client');
    const existing = await ctx.clients.findById(body.id);
    if (existing) {
      throw new ConflictError('Client already exists', { id: body.id });
    }
    const client = await ctx.clients.create(body);
    return reply.code(201).send(client);
  });
}
