import { expect, test, vi } from 'vitest';
import { createPortionLookup } from '../../src/lib/server/agent/portion-lookup';
import { FakeProvider } from '../../src/lib/server/agent/fake';
import { resolveItem } from '../../src/lib/server/agent/resolve';
import type { LlmProvider } from '../../src/lib/server/agent/provider';
import type { Database } from '../../src/lib/server/db/client';
import { getFood } from '../../src/lib/server/services/catalog';

vi.mock('../../src/lib/server/services/catalog', () => ({ getFood: vi.fn<typeof getFood>() }));

test('looks up only the missing unit, stores its estimate and reuses it on a later turn', async () => {
  const food: NonNullable<Awaited<ReturnType<typeof getFood>>> = {
    id: 'test-food',
    name: 'Test drink',
    nameEn: null,
    brand: null,
    barcode: null,
    category: null,
    classification: null,
    sourceId: 'catalog',
    sourceFoodId: 'drink',
    sourceVersion: '1',
    searchText: 'test drink',
    kind: 'generic',
    densityGPerMl: null,
    favorite: false,
    components: [],
    nutrientRows: [],
    nutrients: { energy_kcal: 40 },
    portions: []
  };
  vi.mocked(getFood).mockImplementation(async () => food);
  const write = vi.fn<(rows: typeof food.portions) => Promise<void>>(async (rows) => {
    food.portions.push(...rows);
  });
  const db = {
    insert: () => ({
      values: (rows: (typeof food.portions)[number][]) => ({
        onConflictDoNothing: () => write(rows)
      })
    })
  } as unknown as Database;
  const lookupPortion = vi.fn<NonNullable<LlmProvider['lookupPortion']>>(async () => ({
    weight: { grams: 230, sourceUrl: null, singlePieceServing: false }
  }));
  const provider = Object.assign(new FakeProvider(), { lookupPortion });
  const item = {
    kind: 'food' as const,
    foodId: food.id,
    quantity: 2,
    unit: 'glas',
    confidence: 1,
    assumptions: []
  };
  expect(await resolveItem(db, item, createPortionLookup(db, provider, {}))).toMatchObject({
    grams: 460,
    nutrients: { energy_kcal: 184 },
    assumptions: ['Estimated weight: 230 g per glass.']
  });
  expect(lookupPortion).toHaveBeenCalledWith(
    expect.objectContaining({ name: food.name, unit: 'glass', volumeMl: null }),
    expect.any(AbortSignal)
  );
  expect(write).toHaveBeenCalledWith([
    expect.objectContaining({ foodId: food.id, unit: 'glass', grams: 230, sourceUrl: null })
  ]);
  const nextTurn = createPortionLookup(db, provider, {});
  expect(await resolveItem(db, { ...item, unit: 'glass', quantity: 1 }, nextTurn)).toMatchObject({
    grams: 230
  });
  expect(await resolveItem(db, { ...item, unit: 'g', quantity: 200 }, nextTurn)).toMatchObject({
    grams: 200
  });
  expect(lookupPortion).toHaveBeenCalledTimes(1);
});
