import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { agentRuns } from '../db/schema.ts';
import type { LoopTrace } from './loop.ts';
import { productLookupOutcomes } from './product-lookup.ts';
import type { AgentErrorCode, LlmProvider } from './provider.ts';

export const promptVersion = 'nutrition-14';

const knownTools = new Set([
  'search_foods',
  'search_foods_batch',
  'lookup_product',
  'get_food',
  'search_recipes',
  'get_recipe',
  'get_recent_entries',
  'get_day_totals',
  'lookup_portion',
  'lookup_portion_unavailable',
  'submit_proposal',
  ...productLookupOutcomes.map((outcome) => `lookup_product_${outcome}`)
]);

export async function startAgentRun(db: Database, threadId: string, provider: LlmProvider) {
  const [run] = await db
    .insert(agentRuns)
    .values({
      threadId,
      provider: provider.name,
      model: provider.model,
      promptVersion
    })
    .returning({ id: agentRuns.id });
  if (!run) throw new Error('Could not start agent run.');
  return { id: run.id, start: performance.now() };
}

export async function finishAgentRun(
  db: Pick<Database, 'update'>,
  run: { id: string; start: number },
  status: 'complete' | 'clarification' | 'failed',
  trace: LoopTrace,
  errorCategory?: AgentErrorCode | 'INTERNAL_ERROR'
) {
  await db
    .update(agentRuns)
    .set({
      status,
      toolCalls: trace.toolCalls.filter((name) => knownTools.has(name)),
      tokens: { input: trace.inputTokens, output: trace.outputTokens },
      latencyMs: Math.max(0, Math.round(performance.now() - run.start)),
      errorCategory: errorCategory ?? null
    })
    .where(eq(agentRuns.id, run.id));
}
