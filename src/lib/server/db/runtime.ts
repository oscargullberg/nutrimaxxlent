import { loadLocalEnv, readServerEnv } from '../env.ts';
import { connectDatabase } from './client.ts';

let connection: ReturnType<typeof connectDatabase> | undefined;

export function getDatabase() {
  if (!connection) {
    loadLocalEnv();
    connection = connectDatabase(readServerEnv().databaseUrl);
  }
  return connection.db;
}

export async function closeDatabase() {
  const current = connection;
  connection = undefined;
  await current?.close();
}
