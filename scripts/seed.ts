import { connectDatabase } from '../src/lib/server/db/client.ts';
import { seedDatabase } from '../src/lib/server/db/seed.ts';
import { loadLocalEnv, readServerEnv } from '../src/lib/server/env.ts';

loadLocalEnv();
const { db, close } = connectDatabase(readServerEnv().databaseUrl);
try {
  await seedDatabase(db);
  console.log('Default database records are present.');
} finally {
  await close();
}
