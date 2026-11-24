import { json } from '@sveltejs/kit';
import { AgentError } from '#lib/server/agent/provider.ts';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint } from '#lib/server/http/api.ts';
import { getProfile } from '#lib/server/services/totals.ts';
import { createProvider, providerConfig } from '#lib/server/services/settings.ts';
export const POST = endpoint(async ({ request }) => {
  const provider = createProvider(providerConfig(await getProfile(getDatabase())));
  const status = await provider.status();
  if (!status.connected) throw new AgentError(status.code, status.message);
  if (provider.name === 'codex') {
    await provider.step({
      system: 'Reply with OK only.',
      messages: [{ role: 'user', content: 'Connection test.' }],
      tools: {},
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])
    });
  }
  return json(status);
});
