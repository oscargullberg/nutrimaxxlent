import { connectDatabase } from '../src/lib/server/db/client.ts';
import { migrateDatabase } from '../src/lib/server/db/migrate.ts';
import { loadLocalEnv, readServerEnv } from '../src/lib/server/env.ts';

loadLocalEnv();
const { db, close } = connectDatabase(readServerEnv().databaseUrl);
try {
  await migrateDatabase(db);
  console.log('Database migrations are up to date.');
} finally {
  await close();
}
