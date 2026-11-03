import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { createDatabase, type Database } from '../../src/db/client';

let database: Database | undefined;
let pool: Pool | undefined;
let migration: Promise<void> | undefined;

export async function getTestDatabase(): Promise<{ db: Database; pool: Pool }> {
  if (!database || !pool) {
    const connection = createDatabase(process.env.DATABASE_URL as string, 5);
    database = connection.db;
    pool = connection.pool;
    migration = migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'migrations'),
    });
  }

  await migration;
  return { db: database, pool };
}

export async function resetTestDatabase(): Promise<void> {
  const { db } = await getTestDatabase();
  await db.execute(
    sql`TRUNCATE TABLE tracking_events, email_send_events, email_sends, oauth_credentials, mailboxes, clients RESTART IDENTITY CASCADE`,
  );
}

export async function closeTestDatabase(): Promise<void> {
  await pool?.end();
  database = undefined;
  pool = undefined;
  migration = undefined;
}
