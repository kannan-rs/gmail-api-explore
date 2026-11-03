import { loadConfig } from '../config';
import { createDatabase } from './client';
import { clients } from './schema';

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl, 1);

try {
  await db
    .insert(clients)
    .values({ id: 'client-01', name: 'Client 01' })
    .onConflictDoNothing({ target: clients.id });
  console.log('Seeded client-01');
} finally {
  await pool.end();
}
