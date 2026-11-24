import { tool } from 'ai';
import { z } from 'zod';
import { CodexOAuthProvider } from '../src/lib/server/agent/codex.ts';
import { runToolLoop } from '../src/lib/server/agent/loop.ts';
import { proposalSchema, validateProposal } from '../src/lib/server/agent/proposal.ts';
import { AgentError } from '../src/lib/server/agent/provider.ts';
import { loadLocalEnv } from '../src/lib/server/env.ts';
import { resolveGrams, scaleNutrients } from '../src/lib/server/nutrition/amounts.ts';

loadLocalEnv();
const provider = new CodexOAuthProvider(process.env.LLM_MODEL?.trim() || undefined);
const fixture = {
  id: 'f7594e40-5df5-4705-b918-5bcac4105ad4',
  name: 'Smoke test rice',
  kcalPer100g: 120
};

try {
  const status = await provider.status();
  if (!status.connected) throw new AgentError(status.code, status.message);
  const { proposal, trace } = await runToolLoop(provider, {
    system:
      'You are running a synthetic food logging smoke test. Search the fixture catalog, then submit exactly one food item using the food ID and the requested amount. Do not produce an estimate.',
    messages: [{ role: 'user', content: 'Log 150 g of smoke test rice.' }],
    tools: {
      search_foods: tool({
        description: 'Read the synthetic food catalog.',
        inputSchema: z.object({ query: z.string() }),
        execute: () => Promise.resolve([{ id: fixture.id, name: fixture.name }])
      }),
      submit_proposal: tool({
        description: 'Submit the final food proposal.',
        inputSchema: proposalSchema
      })
    }
  });
  const validated = await validateProposal(proposal, {
    foodUnits: (id) => Promise.resolve(id === fixture.id ? ['g'] : null),
    foodComponents: () => Promise.resolve(null),
    recipeIngredients: () => Promise.resolve(null)
  });
  const item = validated.items[0];
  const grams = item?.kind === 'food' ? resolveGrams(item.quantity, item.unit) : null;
  if (grams !== 150 || validated.items.length !== 1)
    throw new Error('The fixture did not resolve to 150 g of rice.');
  const { energy_kcal } = scaleNutrients({ energy_kcal: fixture.kcalPer100g }, grams);
  console.log(`${status.model}: ${fixture.name}, ${grams} g, ${energy_kcal} kcal.`);
  console.log(`Tool calls: ${trace.toolCalls.join(', ')}`);
} catch (error) {
  console.error(
    error instanceof AgentError ? `${error.code}: ${error.message}` : 'Provider smoke test failed.'
  );
  process.exitCode = 1;
}
