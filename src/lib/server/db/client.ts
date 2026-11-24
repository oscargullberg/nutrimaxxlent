import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export function connectDatabase(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 5, connect_timeout: 5 });
  return { db: drizzle(sql, { schema }), close: () => sql.end({ timeout: 5 }) };
}

export type Database = ReturnType<typeof connectDatabase>['db'];

export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
