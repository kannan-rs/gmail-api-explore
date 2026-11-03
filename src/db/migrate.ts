import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config';
import { createDatabase } from './client';

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl, 1);

try {
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'migrations') });
  console.log('Database migrations applied');
} finally {
  await pool.end();
}
