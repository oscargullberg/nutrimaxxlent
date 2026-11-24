import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { connectDatabase } from '../src/lib/server/db/client.ts';
import { migrateDatabase } from '../src/lib/server/db/migrate.ts';
import { seedDatabase } from '../src/lib/server/db/seed.ts';
import { loadLocalEnv, readServerEnv } from '../src/lib/server/env.ts';
import { seedBrowserCatalog } from './e2e/fixtures.ts';

loadLocalEnv();
const args = process.argv.slice(2);
const demo = args[0] === '--demo';
const base = new URL(
  (demo ? undefined : process.env.E2E_DATABASE_URL) ?? readServerEnv().databaseUrl
);
const name = `nutrimax_${demo ? 'demo' : 'e2e'}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const testDatabase = new URL(base);
testDatabase.pathname = `/${name}`;
const admin = postgres(base.href, { max: 1, connect_timeout: 5 });
const authDirectory = await mkdtemp(join(tmpdir(), 'nutrimaxxlent-e2e-auth-'));
let created = false;
let interrupted = false;
let child: ReturnType<typeof spawn> | undefined;

const interrupt = () => {
  interrupted = true;
  child?.kill('SIGTERM');
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

try {
  await admin`CREATE DATABASE ${admin(name)}`;
  created = true;
  const { db, close } = connectDatabase(testDatabase.href);
  try {
    await migrateDatabase(db);
    await seedDatabase(db);
    await seedBrowserCatalog(db);
  } finally {
    await close();
  }

  const port = '4173';
  const command = demo
    ? ['dev', '--host', '127.0.0.1', '--port', port, '--strictPort']
    : ['exec', 'playwright', 'test', ...args];
  process.exitCode = await new Promise<number>((resolve, reject) => {
    if (interrupted) return resolve(demo ? 0 : 1);
    child = spawn('pnpm', command, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(demo
          ? {
              DATABASE_URL: testDatabase.href,
              LLM_PROVIDER: 'fake',
              ORIGIN: `http://127.0.0.1:${port}`
            }
          : { E2E_DATABASE_URL: testDatabase.href }),
        CODEX_HOME: authDirectory
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(demo && interrupted ? 0 : (code ?? 1)));
  });
} finally {
  try {
    if (created) await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  } finally {
    await admin.end({ timeout: 5 });
    await rm(authDirectory, { recursive: true, force: true });
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
