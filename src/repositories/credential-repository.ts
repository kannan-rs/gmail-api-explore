import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  type MailboxRow,
  mailboxes,
  type OAuthCredentialRow,
  oauthCredentials,
} from '../db/schema';

export interface UpsertCredentialInput {
  mailboxId: string;
  refreshTokenEncrypted: string;
  scopes: string[];
  tokenType?: string;
}

export interface CredentialWithMailbox {
  mailbox: MailboxRow;
  credential: OAuthCredentialRow;
}

export class CredentialRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: UpsertCredentialInput): Promise<OAuthCredentialRow> {
    const [row] = await this.db
      .insert(oauthCredentials)
      .values({
        mailboxId: input.mailboxId,
        refreshTokenEncrypted: input.refreshTokenEncrypted,
        scopes: input.scopes,
        tokenType: input.tokenType ?? 'Bearer',
      })
      .onConflictDoUpdate({
        target: oauthCredentials.mailboxId,
        set: {
          refreshTokenEncrypted: input.refreshTokenEncrypted,
          scopes: input.scopes,
          tokenType: input.tokenType ?? 'Bearer',
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) {
      throw new Error('Failed to upsert OAuth credential');
    }
    return row;
  }

  async findByMailboxId(mailboxId: string): Promise<OAuthCredentialRow | undefined> {
    const [row] = await this.db
      .select()
      .from(oauthCredentials)
      .where(eq(oauthCredentials.mailboxId, mailboxId))
      .limit(1);
    return row;
  }

  async findLatestWithMailbox(): Promise<CredentialWithMailbox | undefined> {
    const [row] = await this.db
      .select({ mailbox: mailboxes, credential: oauthCredentials })
      .from(oauthCredentials)
      .innerJoin(mailboxes, eq(oauthCredentials.mailboxId, mailboxes.id))
      .orderBy(desc(oauthCredentials.updatedAt))
      .limit(1);
    return row;
  }

  async deleteByMailboxId(mailboxId: string): Promise<void> {
    await this.db.delete(oauthCredentials).where(eq(oauthCredentials.mailboxId, mailboxId));
  }
}
