import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client.ts';

export async function migrateDatabase(db: Database) {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
  await migrate(db, { migrationsFolder: 'drizzle' });
}
