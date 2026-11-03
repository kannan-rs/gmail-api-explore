import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { type MailboxRow, mailboxes } from '../db/schema';
import type { EmailProviderName } from '../domain/types';

export interface UpsertMailboxInput {
  provider: EmailProviderName;
  email: string;
  displayName?: string | null;
}

export class MailboxRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<MailboxRow[]> {
    return this.db.select().from(mailboxes).orderBy(desc(mailboxes.updatedAt));
  }

  async findById(id: string): Promise<MailboxRow | undefined> {
    const [row] = await this.db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
    return row;
  }

  async findByEmail(email: string): Promise<MailboxRow | undefined> {
    const [row] = await this.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.email, email.toLowerCase()))
      .limit(1);
    return row;
  }

  async upsert(input: UpsertMailboxInput): Promise<MailboxRow> {
    const [row] = await this.db
      .insert(mailboxes)
      .values({
        provider: input.provider,
        email: input.email.toLowerCase(),
        displayName: input.displayName ?? null,
      })
      .onConflictDoUpdate({
        target: [mailboxes.provider, mailboxes.email],
        set: {
          displayName: input.displayName ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) {
      throw new Error('Failed to upsert mailbox');
    }
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(mailboxes).where(eq(mailboxes.id, id));
  }
}
