import { agentPortionSource, portionUnitName } from '../../nutrition-reference.ts';
import type { Database } from '../db/client.ts';
import { portions } from '../db/schema.ts';
import { convertMeasurement } from '../nutrition/amounts.ts';
import { getFood } from '../services/catalog.ts';
import type { LoopTrace } from './loop.ts';
import { AgentError, type LlmProvider, type PortionLookupResult } from './provider.ts';
import { resolveFoodAmount, type PortionLookup } from './resolve.ts';

export function createPortionLookup(
  db: Database,
  provider: LlmProvider,
  options: { signal?: AbortSignal; onTool?: (name: string) => void; trace?: LoopTrace }
): PortionLookup | undefined {
  const lookup = provider.lookupPortion?.bind(provider);
  if (!lookup) return undefined;
  const pending = new Map<string, ReturnType<PortionLookup>>();
  let lookupSignal: AbortSignal | undefined;

  const resolve: PortionLookup = async (food, unit) => {
    options.signal?.throwIfAborted();
    const current = await getFood(db, food.id);
    if (!current || resolveFoodAmount(current, 1, unit, false).grams) return current;
    options.signal?.throwIfAborted();
    if (!lookupSignal) {
      const timeout = AbortSignal.timeout(30_000);
      lookupSignal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    }
    if (lookupSignal.aborted) return null;
    options.trace?.toolCalls.push('lookup_portion');
    options.onTool?.('lookup_portion');

    const { name, nameEn, brand, barcode } = current;
    const volumeMl = convertMeasurement(1, unit, 'ml');
    let result: PortionLookupResult;
    try {
      result = await lookup(
        { name, nameEn, brand, barcode, unit: portionUnitName(unit), volumeMl },
        lookupSignal
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof AgentError) {
        options.trace?.toolCalls.push('lookup_portion_unavailable');
        return null;
      }
      throw error;
    }
    options.signal?.throwIfAborted();
    if (options.trace) {
      options.trace.inputTokens += result.tokens?.input ?? 0;
      options.trace.outputTokens += result.tokens?.output ?? 0;
    }
    if (lookupSignal.aborted || !result.weight) return null;

    const { grams, sourceUrl, singlePieceServing } = result.weight;
    if (!Number.isFinite(grams) || grams < 0.01 || grams > 5000) return null;
    const units =
      sourceUrl && singlePieceServing && (unit === 'portion' || unit === 'st')
        ? ['portion', 'st']
        : [unit];
    await db
      .insert(portions)
      .values(
        units.map((key) => ({
          foodId: food.id,
          label: key === 'ml' ? 'Per ml' : `Typical ${portionUnitName(key)}`,
          unit: key,
          source: agentPortionSource,
          grams,
          sourceUrl,
          isDefault: key === 'portion' || (key === 'st' && units.length === 2)
        }))
      )
      .onConflictDoNothing({
        target: [portions.foodId, portions.source, portions.unit, portions.label]
      });
    return getFood(db, food.id);
  };
  return (food, unit) => {
    if (food.kind === 'custom' || food.sourceId === 'user') return Promise.resolve(null);
    const key = `${food.id}:${unit}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const result = resolve(food, unit);
    pending.set(key, result);
    return result;
  };
}
