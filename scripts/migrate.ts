import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { connectDatabase } from '../src/lib/server/db/client.ts';
import { loadLocalEnv, readServerEnv } from '../src/lib/server/env.ts';

loadLocalEnv();
const { db, close } = connectDatabase(readServerEnv().databaseUrl);
try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log('Database migrations are up to date.');
} finally {
  await close();
}
