import { loadEnvFile } from 'node:process';

export function loadLocalEnv() {
  try {
    loadEnvFile();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

export function readListenConfig(env = process.env) {
  const host = env.HOST?.trim() || '127.0.0.1';
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return { host, port };
}

export function readServerEnv(env = process.env) {
  const { host, port } = readListenConfig(env);
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('Missing DATABASE_URL. Set it in .env or the environment.');
  const database = URL.parse(databaseUrl);
  if (
    !database ||
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }

  const origin = URL.parse(env.ORIGIN ?? `http://127.0.0.1:${port}`);
  if (
    !origin ||
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.href !== `${origin.origin}/`
  ) {
    throw new Error('ORIGIN must be an HTTP origin without a path, query, or credentials.');
  }

  const provider = env.LLM_PROVIDER ?? 'codex';
  if (provider !== 'codex' && provider !== 'fake') {
    throw new Error('LLM_PROVIDER must be codex or fake.');
  }

  return {
    host,
    port,
    origin: origin.origin,
    databaseUrl,
    provider,
    model: env.LLM_MODEL?.trim() || undefined,
    dataDir: env.DATA_DIR?.trim() || './data'
  };
}
