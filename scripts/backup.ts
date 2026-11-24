import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadLocalEnv, readServerEnv } from '../src/lib/server/env.ts';

loadLocalEnv();
const url = new URL(readServerEnv().databaseUrl);
const password = decodeURIComponent(url.password);
url.password = '';

const folder = resolve('backups');
await mkdir(folder, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(folder, `nutrimaxxlent-${stamp}-${randomUUID().slice(0, 8)}.dump`);
const temporary = `${output}.tmp`;
try {
  await promisify(execFile)(
    'pg_dump',
    ['--no-password', '--format=custom', '--file', temporary, '--dbname', url.toString()],
    { env: { ...process.env, PGPASSWORD: password || process.env.PGPASSWORD } }
  );
  await rename(temporary, output);
  console.log(output);
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    throw new Error('Install the PostgreSQL client tools and make pg_dump available on PATH.');
  }
  throw new Error('pg_dump failed. Check that Postgres is running and DATABASE_URL is correct.');
} finally {
  await rm(temporary, { force: true });
}
