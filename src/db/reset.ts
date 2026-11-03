import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config';
import { createDatabase } from './client';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to reset a production database');
}

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl, 1);

try {
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'migrations') });
  console.log('Database reset and migrations applied');
} finally {
  await pool.end();
}
