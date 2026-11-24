import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { runAgent } from '../../src/lib/server/agent/agent';
import { resolveForLogging } from '../../src/lib/server/agent/clarify';
import { FakeProvider } from '../../src/lib/server/agent/fake';
import { createPortionLookup } from '../../src/lib/server/agent/portion-lookup';
import type { LlmProvider } from '../../src/lib/server/agent/provider';
import { connectDatabase } from '../../src/lib/server/db/client';
import {
  agentRuns,
  datasetRuns,
  foodSources,
  foods,
  portions
} from '../../src/lib/server/db/schema';
import { runImport, type SourceFood } from '../../src/lib/server/importers/source';
import { updateFoodSettings } from '../../src/lib/server/services/custom-food';
import { createThread, deleteThread } from '../../src/lib/server/services/threads';

const databaseUrl = process.env.TEST_DATABASE_URL;

const proposal = (foodId: string, unit: string, quantity: number) => ({
  reply: 'Fixture food',
  needsClarification: false,
  items: [{ kind: 'food', foodId, quantity, unit, confidence: 1 }]
});

test.skipIf(!databaseUrl)(
  'learns reusable weights by food and unit, with or without sources',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const source = {
      id: `portion-${randomUUID()}`,
      name: 'Portion lookup fixtures',
      license: 'CC0',
      attribution: 'Test',
      homepage: 'https://example.test'
    };
    const sourceUrl = 'https://example.test/biscuit';
    const lookupPortion = vi.fn<NonNullable<LlmProvider['lookupPortion']>>(
      async ({ name, unit, volumeMl }) => {
        if (name === 'Fixture biscuit')
          return { weight: { grams: 40, sourceUrl, singlePieceServing: true } };
        if (name === 'Fixture berry' && unit === 'piece')
          return {
            weight: { grams: 5, sourceUrl: 'https://example.test/berry', singlePieceServing: false }
          };
        if (name === 'Fixture drink' && (unit === 'glass' || volumeMl === 1))
          return {
            weight: {
              grams: unit === 'glass' ? 225 : 1.05,
              sourceUrl: null,
              singlePieceServing: false
            }
          };
        if (name === 'Fixture drink' && unit === 'serving')
          return { weight: { grams: 300, sourceUrl: null, singlePieceServing: false } };
        return { weight: null };
      }
    );
    let threadId: string | undefined;
    function importCatalog(version: string, biscuitPortions: SourceFood['portions'] = []) {
      return runImport(db, {
        source,
        version,
        async *records() {
          await Promise.resolve();
          yield {
            id: 'biscuit',
            name: 'Fixture biscuit',
            kind: 'generic',
            nutrients: [{ nutrientId: 'energy_kcal', unit: 'kcal', amount: 450 }],
            portions: biscuitPortions
          };
          yield { id: 'unknown', name: 'Fixture no evidence', kind: 'generic', nutrients: [] };
          yield { id: 'berry', name: 'Fixture berry', kind: 'generic', nutrients: [] };
          yield {
            id: 'drink',
            name: 'Fixture drink',
            kind: 'generic',
            nutrients: [{ nutrientId: 'energy_kcal', unit: 'kcal', amount: 40 }]
          };
        }
      });
    }

    try {
      await importCatalog('1');
      const catalog = await db.select().from(foods).where(eq(foods.sourceId, source.id));
      const biscuit = catalog.find(({ sourceFoodId }) => sourceFoodId === 'biscuit')!;
      const unknown = catalog.find(({ sourceFoodId }) => sourceFoodId === 'unknown')!;
      const berry = catalog.find(({ sourceFoodId }) => sourceFoodId === 'berry')!;
      const drink = catalog.find(({ sourceFoodId }) => sourceFoodId === 'drink')!;
      const provider = Object.assign(
        new FakeProvider(() => ({
          text: 'Fixture food',
          toolCalls: [
            {
              id: 'fixture-proposal',
              name: 'submit_proposal',
              input: proposal(biscuit.id, 'portion', 2)
            }
          ]
        })),
        { lookupPortion }
      );
      const resolve = (foodId: string, unit: string, quantity = 1) =>
        resolveForLogging(db, proposal(foodId, unit, quantity), {
          estimateThreshold: 200,
          lookupPortion: createPortionLookup(db, provider, {})
        });

      threadId = (await createThread(db)).id;
      expect(await runAgent(db, { threadId, provider, text: '2 fixture biscuit' })).toMatchObject({
        clarification: null,
        items: [
          {
            grams: 80,
            provenance: 'catalog',
            nutrients: { energy_kcal: 360 },
            assumptions: [expect.stringContaining('40 g per serving')]
          }
        ]
      });
      const [run] = await db.select().from(agentRuns).where(eq(agentRuns.threadId, threadId));
      expect(run?.toolCalls).toEqual(['submit_proposal', 'lookup_portion']);
      expect(lookupPortion).toHaveBeenCalledWith(
        {
          name: 'Fixture biscuit',
          nameEn: null,
          brand: null,
          barcode: null,
          unit: 'serving',
          volumeMl: null
        },
        expect.any(AbortSignal)
      );
      expect((await resolve(biscuit.id, 'piece', 3)).items[0]?.grams).toBe(120);
      expect(lookupPortion).toHaveBeenCalledTimes(1);

      await importCatalog('2', [
        { label: 'Regular biscuit', unit: 'st', grams: 55, isDefault: true }
      ]);
      expect((await resolve(biscuit.id, 'st')).items[0]?.grams).toBe(55);
      expect((await resolve(biscuit.id, 'portion')).items[0]?.grams).toBe(55);
      expect(await db.select().from(portions).where(eq(portions.foodId, biscuit.id))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ unit: 'st', grams: 40, source: 'agent', sourceUrl })
        ])
      );
      await updateFoodSettings(db, biscuit.id, { portionG: 35 });
      expect((await resolve(biscuit.id, 'portion')).items[0]?.grams).toBe(35);
      expect((await resolve(unknown.id, 'g', 30)).items[0]?.grams).toBe(30);
      expect(lookupPortion).toHaveBeenCalledTimes(1);

      expect((await resolve(unknown.id, 'st')).clarification?.code).toBe('UNIT_UNRESOLVED');
      expect(await db.select().from(portions).where(eq(portions.foodId, unknown.id))).toEqual([]);
      expect((await resolve(berry.id, 'st', 3)).items[0]?.grams).toBe(15);
      expect((await resolve(berry.id, 'portion')).clarification?.code).toBe('UNIT_UNRESOLVED');

      lookupPortion.mockClear();
      const [twoGlasses, oneGlass] = await Promise.all([
        resolve(drink.id, 'glas', 2),
        resolve(drink.id, 'glass')
      ]);
      expect(twoGlasses).toMatchObject({
        clarification: null,
        items: [
          {
            grams: 450,
            nutrients: { energy_kcal: 180 },
            assumptions: ['Estimated weight: 225 g per glass.']
          }
        ]
      });
      expect(oneGlass.items[0]?.grams).toBe(225);
      expect(await db.select().from(portions).where(eq(portions.foodId, drink.id))).toMatchObject([
        { unit: 'glass', grams: 225, sourceUrl: null, isDefault: false }
      ]);
      lookupPortion.mockClear();
      expect((await resolve(drink.id, 'glasses', 3)).items[0]?.grams).toBe(675);
      expect(lookupPortion).not.toHaveBeenCalled();
      expect((await resolve(drink.id, 'serving')).items[0]?.grams).toBe(300);
      expect((await resolve(drink.id, 'dl', 2)).items[0]?.grams).toBe(210);
      expect((await resolve(drink.id, 'ml', 200)).items[0]?.grams).toBe(210);
      expect(lookupPortion).toHaveBeenCalledTimes(2);
      await updateFoodSettings(db, drink.id, { portionUnit: 'glass', portionG: 180 });
      expect((await resolve(drink.id, 'glass')).items[0]?.grams).toBe(180);
      expect((await resolve(drink.id, 'serving')).items[0]?.grams).toBe(300);
    } finally {
      if (threadId) await deleteThread(db, threadId);
      await db.delete(foods).where(eq(foods.sourceId, source.id));
      await db.delete(datasetRuns).where(eq(datasetRuns.sourceId, source.id));
      await db.delete(foodSources).where(eq(foodSources.id, source.id));
      await close();
    }
  }
);
