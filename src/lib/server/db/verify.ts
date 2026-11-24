import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Database } from './client.ts';

export async function verifyDatabase(db: Database) {
  let extensions;
  try {
    extensions = await db.execute<{ extname: string }>(sql`
      SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')
    `);
  } catch {
    throw new Error(
      'Cannot connect to Postgres. Run docker compose up -d --wait and check DATABASE_URL.'
    );
  }
  const missing = ['pg_trgm', 'unaccent'].filter(
    (name) => !extensions.some(({ extname }) => extname === name)
  );
  if (missing.length) {
    throw new Error(
      `Postgres extensions are missing: ${missing.join(', ')}. Apply docker/init.sql to the application database.`
    );
  }

  const expected = readMigrationFiles({ migrationsFolder: 'drizzle' });
  const [migrationTable] = await db.execute<{ exists: boolean }>(sql`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists
  `);
  if (!migrationTable?.exists)
    throw new Error('Database schema is missing. Run pnpm db:migrate and pnpm db:seed.');
  const applied = await db.execute<{ hash: string }>(
    sql`SELECT hash FROM drizzle.__drizzle_migrations`
  );
  const hashes = new Set(applied.map(({ hash }) => hash));
  if (expected.some(({ hash }) => !hashes.has(hash))) {
    throw new Error('Database schema is out of date. Run pnpm db:migrate.');
  }
}
