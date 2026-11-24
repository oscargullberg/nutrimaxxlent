import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';
const databaseUrl = process.env.E2E_DATABASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { baseURL: origin },
  webServer: databaseUrl
    ? {
        command: 'pnpm dev --host 127.0.0.1 --port 4173 --strictPort',
        url: origin,
        env: { ORIGIN: origin, DATABASE_URL: databaseUrl, LLM_PROVIDER: 'fake' }
      }
    : undefined
});
