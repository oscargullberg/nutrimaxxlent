import { expect, test, vi } from 'vitest';
import { FakeProvider } from '../../src/lib/server/agent/fake';
import { createProductLookup } from '../../src/lib/server/agent/product-lookup';
import { AgentError, type LlmProvider } from '../../src/lib/server/agent/provider';
import type { Database } from '../../src/lib/server/db/client';
import { searchFoods } from '../../src/lib/server/services/catalog';
import {
  getProductIngredients,
  saveProductIngredients
} from '../../src/lib/server/services/product-composition';

vi.mock('../../src/lib/server/services/catalog', () => ({
  searchFoods: vi.fn<typeof searchFoods>()
}));

vi.mock('../../src/lib/server/services/product-composition', () => ({
  getProductIngredients: vi.fn<typeof getProductIngredients>(),
  saveProductIngredients: vi.fn<typeof saveProductIngredients>()
}));

test('reuses cached ingredients and accepts a new explicit label for the same product', async () => {
  const food = {
    id: 'wrap',
    name: 'Chicken Wrap',
    nameEn: null,
    brand: 'Example',
    barcode: '12345678',
    sourceVersion: '1'
  };
  vi.mocked(searchFoods).mockResolvedValue([
    {
      ...food,
      sourceId: 'off',
      sourceName: 'Open Food Facts',
      kind: 'branded',
      energyKcal: 200,
      proteinG: 18,
      match: 'barcode'
    }
  ]);
  const original = {
    text: 'Chicken, tortilla',
    orderedByWeight: false,
    components: [{ name: 'chicken', catalogNames: [], percent: null }]
  };
  vi.mocked(getProductIngredients).mockResolvedValue({
    foodId: food.id,
    foodVersion: food.sourceVersion,
    evidence: original,
    sourceUrl: 'https://example.test/label',
    checkedAt: new Date(),
    labelNutrients: null
  });
  vi.mocked(saveProductIngredients).mockClear();
  const correction = { ...original, text: 'Cooked chicken, tortilla' };
  const db = {
    select: () => ({ from: () => ({ where: async () => [food] }) })
  } as unknown as Database;
  const lookupProduct = vi.fn<NonNullable<LlmProvider['lookupProduct']>>();
  const lookup = createProductLookup(db, Object.assign(new FakeProvider(), { lookupProduct }));
  const signal = new AbortController().signal;

  await expect(lookup(food.barcode, signal, { learnIngredients: true })).resolves.toEqual({
    status: 'found',
    food: { id: food.id }
  });
  expect(saveProductIngredients).not.toHaveBeenCalled();
  await lookup(food.barcode, signal, { learnIngredients: true, userIngredients: correction });
  expect(saveProductIngredients).toHaveBeenCalledExactlyOnceWith(db, food, correction, null);
  expect(lookupProduct).not.toHaveBeenCalled();
});

test.each(['web_search_not_run', 'web_search_failed', 'source_unverified'] as const)(
  'records %s separately from a search that finds no usable label',
  async (reason) => {
    vi.mocked(searchFoods).mockResolvedValue([]);
    const trace = { toolCalls: [], inputTokens: 0, outputTokens: 0 };
    const lookupProduct: NonNullable<LlmProvider['lookupProduct']> = async () => ({
      product: null,
      alternatives: [],
      reason
    });
    const provider = Object.assign(new FakeProvider(), { lookupProduct });
    const lookup = createProductLookup({} as Database, provider, trace)!;

    await expect(lookup('Example product', new AbortController().signal)).resolves.toEqual({
      status: 'not_found',
      reason
    });
    expect(trace.toolCalls).toEqual([`lookup_product_${reason}`]);
  }
);

test('records a rejected provider request as a lookup failure', async () => {
  vi.mocked(searchFoods).mockResolvedValue([]);
  const trace = { toolCalls: [], inputTokens: 0, outputTokens: 0 };
  const lookupProduct = vi
    .fn<NonNullable<LlmProvider['lookupProduct']>>()
    .mockRejectedValue(new AgentError('PROVIDER_MODEL_UNAVAILABLE', 'Fixture rejection'));
  const provider = Object.assign(new FakeProvider(), { lookupProduct });
  const lookup = createProductLookup({} as Database, provider, trace)!;

  await expect(lookup('Example product', new AbortController().signal)).resolves.toEqual({
    status: 'unavailable',
    reason: 'provider_rejected'
  });
  expect(trace.toolCalls).toEqual(['lookup_product_provider_rejected']);
});
