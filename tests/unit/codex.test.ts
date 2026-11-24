import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { CodexOAuthProvider } from '../../src/lib/server/agent/codex';

test('reports the configured model and actionable status when the auth file is missing', async () => {
  const provider = new CodexOAuthProvider(
    'fixture-model',
    join(tmpdir(), randomUUID(), 'auth.json')
  );
  expect(await provider.status()).toEqual({
    provider: 'codex',
    model: 'fixture-model',
    connected: false,
    code: 'PROVIDER_NOT_CONNECTED',
    message: expect.stringContaining('npx @openai/codex login')
  });
  await expect(
    provider.step({ system: '', messages: [], tools: {}, signal: new AbortController().signal })
  ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONNECTED' });
});
