import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { type ClientRow, clients } from '../db/schema';

export class ClientRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<ClientRow[]> {
    return this.db.select().from(clients).orderBy(asc(clients.id));
  }

  async findById(id: string): Promise<ClientRow | undefined> {
    const [row] = await this.db.select().from(clients).where(eq(clients.id, id)).limit(1);
    return row;
  }

  async create(input: { id: string; name: string }): Promise<ClientRow> {
    const [row] = await this.db.insert(clients).values(input).returning();
    if (!row) {
      throw new Error('Failed to create client');
    }
    return row;
  }

  async ensure(input: { id: string; name: string }): Promise<ClientRow> {
    const existing = await this.findById(input.id);
    if (existing) {
      return existing;
    }
    return this.create(input);
  }
}
