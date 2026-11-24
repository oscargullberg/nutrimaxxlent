import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { productLabelSource } from '../../src/lib/nutrition-reference';
import { runAgent } from '../../src/lib/server/agent/agent';
import { continueClarification, resolveForLogging } from '../../src/lib/server/agent/clarify';
import { FakeProvider } from '../../src/lib/server/agent/fake';
import { preSearch } from '../../src/lib/server/agent/presearch';
import type { LlmProvider } from '../../src/lib/server/agent/provider';
import { createProductLookup } from '../../src/lib/server/agent/product-lookup';
import { resolveItem } from '../../src/lib/server/agent/resolve';
import { resolveNamedProducts } from '../../src/lib/server/agent/resolve-products';
import { connectDatabase } from '../../src/lib/server/db/client';
import {
  foodNutrients,
  foods,
  foodSources,
  logEntries,
  logEntryItems,
  logItemNutrients
} from '../../src/lib/server/db/schema';
import { normalizeSearch } from '../../src/lib/server/importers/source';
import type { IngredientEvidence } from '../../src/lib/server/nutrition/ingredient-evidence';
import { getFood } from '../../src/lib/server/services/catalog';
import { commitEntry } from '../../src/lib/server/services/entries';
import { createThread, deleteThread } from '../../src/lib/server/services/threads';
import { dayTotals } from '../../src/lib/server/services/totals';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'scales a volume-only published label and flags estimated weight',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const name = `Coconut Milk ${randomUUID()}`;
    const brand = 'Fixture Foods';
    const sourceUrl = 'https://example.test/coconut-milk';
    const provider = Object.assign(new FakeProvider(), {
      lookupProduct: vi.fn<NonNullable<LlmProvider['lookupProduct']>>().mockResolvedValue({
        product: {
          name,
          brand,
          sourceUrl,
          barcode: null,
          referenceGrams: 105,
          volume: { ml: 100, weightEstimated: true },
          nutrients: [{ id: 'energy_kcal', amount: 172 }],
          piece: null,
          ingredients: null
        },
        alternatives: []
      })
    });
    try {
      const lookup = createProductLookup(db, provider);
      const signal = new AbortController().signal;
      const result = await lookup(`${brand} ${name}`, signal, { learnIngredients: true });
      if (result.status !== 'found') throw new Error('Expected the volume label to be saved.');
      const base = {
        kind: 'food' as const,
        foodId: result.food.id,
        confidence: 1,
        assumptions: []
      };
      const measured = await resolveItem(db, { ...base, quantity: 0.625, unit: 'dl' });
      expect(measured.grams).toBeCloseTo(65.625);
      expect(measured.nutrients.energy_kcal).toBeCloseTo(107.5);
      expect(measured.estimatedNutrients).toBeUndefined();
      expect(measured.assumptions[0]).toContain('equivalent weight is estimated');
      const weighed = await resolveItem(db, { ...base, quantity: 105, unit: 'g' });
      expect(weighed.nutrients.energy_kcal).toBeCloseTo(172);
      expect(weighed.estimatedNutrients).toEqual(['energy_kcal']);
      expect(await lookup(`${brand} ${name}`, signal, { learnIngredients: true })).toEqual(result);
      expect(provider.lookupProduct).toHaveBeenCalledOnce();
    } finally {
      await db
        .delete(foods)
        .where(and(eq(foods.sourceId, productLabelSource), eq(foods.name, name)));
      await close();
    }
  }
);

test.skipIf(!databaseUrl)(
  'offers the saved generic fallback if a selected variant has no label',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    try {
      const lookupProduct = vi
        .fn<ReturnType<typeof createProductLookup>>()
        .mockResolvedValueOnce({
          status: 'ambiguous',
          alternatives: ['Fixture milk original', 'Fixture milk light']
        })
        .mockResolvedValueOnce({ status: 'not_found', reason: 'no_label' });
      const proposal = await resolveNamedProducts(
        {
          reply: 'Checking your meal.',
          needsClarification: false,
          items: [
            {
              kind: 'product',
              query: 'Fixture milk',
              quantity: 50,
              unit: 'ml',
              productType: 'food',
              fallback: {
                kind: 'estimate',
                label: 'Coconut milk',
                grams: 50,
                per100g: { energy_kcal: 170 },
                confidence: 0.85,
                assumptions: ['Standard coconut milk.']
              }
            }
          ]
        },
        lookupProduct,
        new AbortController().signal
      );
      const review = await resolveForLogging(db, proposal, { estimateThreshold: 200 });
      const fallback = await continueClarification(
        db,
        review.proposal,
        review.clarification!,
        { optionId: 'option-1' },
        { estimateThreshold: 200, lookupProduct }
      );
      expect(fallback).toMatchObject({
        confirmed: [],
        clarification: { code: 'LOW_CONFIDENCE' },
        items: [
          {
            label: 'Coconut milk',
            grams: 50,
            provenance: 'estimate',
            nutrients: { energy_kcal: 85 }
          }
        ]
      });
      expect(
        (
          await continueClarification(
            db,
            fallback.proposal,
            fallback.clarification!,
            { optionId: 'option-1' },
            { estimateThreshold: 200, confirmed: fallback.confirmed }
          )
        ).clarification
      ).toBeNull();
    } finally {
      await close();
    }
  }
);

test.skipIf(!databaseUrl)(
  'looks up a missing product label and reuses it for capsule counts',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const name = `Forte Oil ${randomUUID()}`;
    const brand = 'Fixture Labs';
    const query = `${brand} ${name}`;
    const sourceUrl = 'https://example.test/forte-oil';
    const lookupProduct = vi.fn<NonNullable<LlmProvider['lookupProduct']>>(async () => ({
      product: {
        name,
        brand,
        sourceUrl,
        barcode: null,
        referenceGrams: 1,
        volume: null,
        nutrients: [
          { id: 'omega3_epa_mg', amount: 300 },
          { id: 'omega3_dha_mg', amount: 200 }
        ],
        piece: { grams: 1, label: 'One capsule (fish oil fill)' },
        ingredients: null
      },
      alternatives: []
    }));
    let threadId: string | undefined;
    let cachedId: string | undefined;
    const provider = Object.assign(
      new FakeProvider(() => ({
        text: '',
        toolCalls: [
          {
            id: 'proposal',
            name: 'submit_proposal',
            input: {
              reply: 'Checking the product.',
              needsClarification: false,
              items: [
                {
                  kind: 'product',
                  query,
                  quantity: 3,
                  unit: 'capsules',
                  productType: 'supplement',
                  fallback: null
                }
              ]
            }
          }
        ]
      })),
      { lookupProduct }
    );
    try {
      threadId = (await createThread(db)).id;
      const run = () =>
        runAgent(db, { threadId: threadId!, text: `And 3x ${query} tabs`, provider });
      for (const result of [await run(), await run()]) {
        cachedId ??= result.items[0]?.foodId;
        expect(result).toMatchObject({
          clarification: null,
          items: [
            {
              foodId: cachedId,
              grams: 3,
              provenance: 'catalog',
              nutrients: { omega3_epa_mg: 900, omega3_dha_mg: 600 }
            }
          ]
        });
      }
      expect(lookupProduct).toHaveBeenCalledTimes(1);
      expect(await preSearch(db, `And 3× ${query} tabs`)).toMatchObject([
        {
          foods: expect.arrayContaining([expect.objectContaining({ id: cachedId, match: 'alias' })])
        }
      ]);
      expect(await getFood(db, cachedId!)).toMatchObject({
        sourceId: productLabelSource,
        portions: [{ unit: 'st', grams: 1, sourceUrl }]
      });
    } finally {
      if (threadId) await deleteThread(db, threadId);
      await db
        .delete(foods)
        .where(and(eq(foods.sourceId, productLabelSource), eq(foods.name, name)));
      await close();
    }
  }
);

test.skipIf(!databaseUrl)(
  'reuses ingredient evidence and learns label corrections without rewriting past totals',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const token = randomUUID();
    const brand = 'Fixture Foods';
    const name = `Chicken wrap ${token}`;
    const query = `${brand} ${name}`;
    const labelUrl = 'https://example.test/chicken-wrap';
    const ingredientNames = [
      `Tortilla ${token}`,
      `Cooked chicken ${token}`,
      `Seasoned chicken ${token}`
    ];
    const ingredient = (chicken: string): IngredientEvidence => ({
      text: `${ingredientNames[0]}, ${chicken} (40%)`,
      orderedByWeight: true,
      components: [
        { name: ingredientNames[0]!, catalogNames: [], percent: null },
        { name: chicken, catalogNames: [], percent: 40 }
      ]
    });
    let correction: IngredientEvidence | undefined;
    const lookupProduct = vi.fn<NonNullable<LlmProvider['lookupProduct']>>(async () => ({
      product: {
        name,
        brand,
        barcode: null,
        sourceUrl: labelUrl,
        referenceGrams: 100,
        volume: null,
        nutrients: [
          { id: 'energy_kcal', amount: 200 },
          { id: 'protein_g', amount: 18 },
          { id: 'iron_mg', amount: 2.5 }
        ],
        piece: { grams: 200, label: 'One wrap' },
        ingredients: ingredient(ingredientNames[1]!)
      },
      alternatives: []
    }));
    const provider = Object.assign(
      new FakeProvider(() => ({
        text: '',
        toolCalls: [
          {
            id: 'proposal',
            name: 'submit_proposal',
            input: {
              reply: 'Checking the wrap.',
              needsClarification: false,
              items: [
                {
                  kind: 'product',
                  query,
                  quantity: 1,
                  unit: 'st',
                  productType: 'food',
                  userIngredients: correction,
                  fallback: null
                }
              ]
            }
          }
        ]
      })),
      { lookupProduct }
    );
    const date = '2199-09-09';
    const loggedAt = new Date(`${date}T12:00:00Z`);
    const entryIds: string[] = [];
    let threadId: string | undefined;
    try {
      await db
        .insert(foodSources)
        .values({
          id: 'slv',
          name: 'Livsmedelsverket',
          license: 'CC0',
          attribution: 'Livsmedelsverket',
          homepage: ''
        })
        .onConflictDoNothing();
      const references = await db
        .insert(foods)
        .values(
          ingredientNames.map((ingredientName) => ({
            sourceId: 'slv',
            sourceFoodId: ingredientName,
            searchText: normalizeSearch(ingredientName),
            sourceVersion: 'fixture',
            name: ingredientName,
            kind: 'generic' as const
          }))
        )
        .returning({ id: foods.id });
      await db.insert(foodNutrients).values(
        references.flatMap(({ id }, index) => [
          { foodId: id, nutrientId: 'protein_g', amount: index === 0 ? 10 : 30, unit: 'g' },
          { foodId: id, nutrientId: 'magnesium_mg', amount: [10, 50, 100][index]!, unit: 'mg' }
        ])
      );
      threadId = (await createThread(db)).id;
      const log = async () => {
        const text = `${query}${correction ? `, label ingredients: ${correction.text}` : ''}`;
        const result = await runAgent(db, { threadId: threadId!, text, provider });
        expect(result.clarification).toBeNull();
        const entry = await db.transaction((tx) =>
          commitEntry(tx, { items: result.items, rawText: text, loggedAt })
        );
        entryIds.push(entry!.id);
        return entry!.items[0]!;
      };

      const first = await log();
      expect(first).toMatchObject({
        grams: 200,
        nutrients: { energy_kcal: 400, protein_g: 36, iron_mg: 5, magnesium_mg: 52 },
        estimatedNutrients: ['magnesium_mg']
      });
      correction = ingredient(ingredientNames[2]!);
      const corrected = await log();
      correction = undefined;
      const reused = await log();
      for (const item of [corrected, reused]) {
        expect(item).toMatchObject({
          foodId: first.foodId,
          nutrients: { protein_g: 36, iron_mg: 5, magnesium_mg: 92 },
          estimatedNutrients: ['magnesium_mg']
        });
      }
      expect(lookupProduct).toHaveBeenCalledTimes(1);
      expect(await dayTotals(db, date)).toMatchObject({
        totals: { magnesium_mg: 236, iron_mg: 15 },
        estimatedTotals: { magnesium_mg: 236 }
      });
    } finally {
      if (entryIds.length) {
        await db
          .delete(logItemNutrients)
          .where(
            inArray(
              logItemNutrients.itemId,
              db
                .select({ id: logEntryItems.id })
                .from(logEntryItems)
                .where(inArray(logEntryItems.entryId, entryIds))
            )
          );
        await db.delete(logEntryItems).where(inArray(logEntryItems.entryId, entryIds));
        await db.delete(logEntries).where(inArray(logEntries.id, entryIds));
      }
      if (threadId) await deleteThread(db, threadId);
      await db
        .delete(foods)
        .where(and(eq(foods.sourceId, productLabelSource), eq(foods.name, name)));
      await db
        .delete(foods)
        .where(and(eq(foods.sourceId, 'slv'), inArray(foods.sourceFoodId, ingredientNames)));
      await close();
    }
  }
);
