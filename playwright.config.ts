import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { baseURL: origin },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4173 --strictPort',
    url: origin,
    env: {
      ORIGIN: origin,
      ...(process.env.E2E_DATABASE_URL
        ? { DATABASE_URL: process.env.E2E_DATABASE_URL, LLM_PROVIDER: 'fake' }
        : {})
    }
  }
});
