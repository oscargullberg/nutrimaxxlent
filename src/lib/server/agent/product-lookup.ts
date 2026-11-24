import { and, eq } from 'drizzle-orm';
import { canonicalNutrients, productLabelSource as sourceId } from '../../nutrition-reference.ts';
import type { Database } from '../db/client.ts';
import { foodAliases, foodNutrients, foods, foodSources, portions } from '../db/schema.ts';
import { normalizeSearch } from '../importers/source.ts';
import type { IngredientEvidence } from '../nutrition/ingredient-evidence.ts';
import { searchFoods } from '../services/catalog.ts';
import { getProductIngredients, saveProductIngredients } from '../services/product-composition.ts';
import type { LoopTrace } from './loop.ts';
import { productEvidence } from './product-evidence.ts';
import { AgentError, type LlmProvider } from './provider.ts';

const canonicalById = new Map(canonicalNutrients.map(({ id, unit }) => [id, unit]));
const ingredientRetryMs = 24 * 60 * 60 * 1000;
type CompositionOptions = {
  learnIngredients?: boolean;
  userIngredients?: IngredientEvidence;
  requireExactIdentity?: boolean;
};

function productNameKey(brand: string, name: string) {
  const brandKey = normalizeSearch(brand);
  const nameKey = normalizeSearch(name);
  return nameKey.startsWith(`${brandKey} `) ? nameKey : `${brandKey} ${nameKey}`;
}

export const productLookupOutcomes = [
  'cached',
  'saved',
  'ambiguous',
  'no_label',
  'web_search_not_run',
  'web_search_failed',
  'source_unverified',
  'invalid_evidence',
  'provider_rejected',
  'timed_out',
  'unavailable'
] as const;

export function createProductLookup(db: Database, provider: LlmProvider, trace?: LoopTrace) {
  const lookup = provider.lookupProduct?.bind(provider);
  function record(outcome: (typeof productLookupOutcomes)[number]) {
    trace?.toolCalls.push(`lookup_product_${outcome}`);
  }
  const research = async (query: string, signal: AbortSignal, timeoutMs: number) => {
    if (!lookup) {
      record('unavailable');
      return { status: 'unavailable' as const, reason: 'unavailable' };
    }
    signal.throwIfAborted();

    let result;
    try {
      result = await lookup(query, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]));
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof AgentError) {
        const reason =
          error.code === 'AGENT_TIMEOUT'
            ? 'timed_out'
            : error.code === 'PROVIDER_MODEL_UNAVAILABLE'
              ? 'provider_rejected'
              : 'unavailable';
        record(reason);
        return { status: 'unavailable' as const, reason };
      }
      throw error;
    }
    signal.throwIfAborted();
    if (trace) {
      trace.inputTokens += result.tokens?.input ?? 0;
      trace.outputTokens += result.tokens?.output ?? 0;
    }
    const evidence = productEvidence.safeParse(result);
    if (!evidence.success) {
      record('invalid_evidence');
      return { status: 'not_found' as const, reason: 'invalid_evidence' };
    }
    const { product, alternatives } = evidence.data;
    if (alternatives.length > 1) {
      record('ambiguous');
      return { status: 'ambiguous' as const, alternatives };
    }
    if (!product) {
      const reason = result.reason ?? 'no_label';
      record(reason);
      return { status: 'not_found' as const, reason };
    }

    const labelUrl = URL.parse(product.sourceUrl);
    const sourceFoodId = normalizeSearch(`${product.brand} ${product.name}`);
    if (
      !labelUrl ||
      labelUrl.protocol !== 'https:' ||
      labelUrl.username ||
      labelUrl.password ||
      (/^\d{8,14}$/u.test(query) && product.barcode !== query) ||
      !sourceFoodId
    ) {
      record('invalid_evidence');
      return { status: 'not_found' as const, reason: 'invalid_evidence' };
    }
    const amounts = product.nutrients.map(({ id, amount }) => ({
      nutrientId: id,
      unit: canonicalById.get(id)!,
      amount: (amount / product.referenceGrams) * 100,
      sourceMeta: {
        sourceUrl: labelUrl.href,
        referenceGrams: product.referenceGrams,
        ...(product.volume && {
          referenceMl: product.volume.ml,
          weightEstimated: product.volume.weightEstimated
        })
      }
    }));
    const density = product.volume ? product.referenceGrams / product.volume.ml : null;
    if (
      new Set(amounts.map(({ nutrientId }) => nutrientId)).size !== amounts.length ||
      amounts.some(({ amount }) => !Number.isFinite(amount)) ||
      (density !== null && (!Number.isFinite(density) || density < 0.01 || density > 5))
    ) {
      record('invalid_evidence');
      return { status: 'not_found' as const, reason: 'invalid_evidence' };
    }

    return { status: 'label' as const, product, labelUrl, sourceFoodId, amounts, density };
  };

  async function learnCachedIngredients(
    foodId: string,
    composition: CompositionOptions,
    signal: AbortSignal
  ) {
    if (!lookup && !composition.userIngredients) return;
    const [food] = await db.select().from(foods).where(eq(foods.id, foodId));
    if (!food) return;
    if (composition.userIngredients) {
      signal.throwIfAborted();
      await saveProductIngredients(db, food, composition.userIngredients, null);
      return;
    }

    const prior = await getProductIngredients(db, food);
    if (prior?.evidence || (prior && Date.now() - prior.checkedAt.getTime() < ingredientRetryMs))
      return;

    const query = [food.brand, food.name].filter(Boolean).join(' ');
    const result = await research(
      food.barcode ? `${query} (barcode ${food.barcode})` : query,
      signal,
      8000
    );
    if (result.status === 'label') {
      const exact =
        food.barcode && result.product.barcode
          ? food.barcode === result.product.barcode
          : [food.name, food.nameEn].some(
              (name) =>
                name &&
                food.brand &&
                normalizeSearch(food.brand) === normalizeSearch(result.product.brand) &&
                productNameKey(food.brand, name) ===
                  productNameKey(result.product.brand, result.product.name)
            );
      if (exact) {
        const sourceUrl = result.labelUrl.href;
        await saveProductIngredients(
          db,
          food,
          result.product.ingredients ?? null,
          sourceUrl,
          result.product.volume?.weightEstimated
            ? (prior?.labelNutrients ?? undefined)
            : {
                sourceUrl,
                values: Object.fromEntries(
                  result.amounts.map(({ nutrientId, amount }) => [nutrientId, amount])
                )
              }
        );
        return;
      }
    }
    await saveProductIngredients(
      db,
      food,
      null,
      prior?.sourceUrl ?? null,
      prior?.labelNutrients ?? undefined
    );
  }

  const resolve = async (query: string, signal: AbortSignal, composition?: CompositionOptions) => {
    signal.throwIfAborted();
    const local = (await searchFoods(db, query)).filter(
      (food) =>
        food.kind === 'branded' &&
        (composition?.requireExactIdentity
          ? ['barcode', 'name']
          : ['barcode', 'learned_alias', 'alias', 'name']
        ).includes(food.match)
    );
    const preferred = local.filter(({ match }) => match === 'barcode' || match === 'learned_alias');
    const matches = preferred.length ? preferred : local;
    if (matches.length === 1) {
      record('cached');
      if (composition?.learnIngredients)
        await learnCachedIngredients(matches[0]!.id, composition, signal);
      return { status: 'found' as const, food: { id: matches[0]!.id } };
    }

    const found = await research(query, signal, 25_000);
    if (found.status !== 'label') return found;
    const { product, labelUrl, sourceFoodId, amounts, density } = found;
    if (product.volume?.weightEstimated && !composition?.learnIngredients) {
      record('invalid_evidence');
      return { status: 'not_found' as const, reason: 'invalid_evidence' };
    }
    const foodId = await db.transaction(async (tx) => {
      await tx
        .insert(foodSources)
        .values({
          id: sourceId,
          name: 'Product labels',
          attribution: 'Individual product labels',
          license: 'Public product facts',
          homepage: ''
        })
        .onConflictDoNothing();
      const [inserted] = await tx
        .insert(foods)
        .values({
          sourceId,
          sourceFoodId,
          sourceVersion: new Date().toISOString(),
          kind: 'branded',
          name: product.name,
          brand: product.brand,
          barcode: product.barcode,
          searchText: sourceFoodId,
          densityGPerMl: density
        })
        .onConflictDoNothing({ target: [foods.sourceId, foods.sourceFoodId] })
        .returning({ id: foods.id, sourceVersion: foods.sourceVersion, barcode: foods.barcode });
      const food =
        inserted ??
        (
          await tx
            .select({ id: foods.id, sourceVersion: foods.sourceVersion, barcode: foods.barcode })
            .from(foods)
            .where(and(eq(foods.sourceId, sourceId), eq(foods.sourceFoodId, sourceFoodId)))
        )[0];
      if (!food) throw new Error('Could not save the product label.');
      if (food.barcode && product.barcode && food.barcode !== product.barcode) return null;
      if (inserted) {
        await tx.insert(foodNutrients).values(
          amounts.map(({ nutrientId, unit, amount, sourceMeta }) => ({
            foodId: food.id,
            nutrientId,
            unit,
            amount,
            sourceMeta
          }))
        );
        if (product.piece)
          await tx.insert(portions).values({
            ...product.piece,
            foodId: food.id,
            unit: 'st',
            source: sourceId,
            sourceUrl: labelUrl.href
          });
      }
      await tx
        .insert(foodAliases)
        .values({ foodId: food.id, alias: query, source: sourceId })
        .onConflictDoNothing();
      if (composition?.learnIngredients) {
        await saveProductIngredients(
          tx,
          food,
          composition.userIngredients ?? product.ingredients ?? null,
          composition.userIngredients ? null : labelUrl.href
        );
      }
      return food.id;
    });
    if (!foodId) {
      record('invalid_evidence');
      return { status: 'not_found' as const, reason: 'invalid_evidence' };
    }
    record('saved');
    return { status: 'found' as const, food: { id: foodId } };
  };
  const requests = new Map<string, ReturnType<typeof resolve>>();

  return (query: string, signal: AbortSignal, composition?: CompositionOptions) => {
    const key = normalizeSearch(query);
    if (!key) return { status: 'not_found' as const, reason: 'no_label' };
    const requestKey = JSON.stringify([
      key,
      composition?.learnIngredients,
      composition?.userIngredients,
      composition?.requireExactIdentity
    ]);
    const existing = requests.get(requestKey);
    if (existing) return existing;
    const request = resolve(key, signal, composition);
    requests.set(requestKey, request);
    return request;
  };
}
