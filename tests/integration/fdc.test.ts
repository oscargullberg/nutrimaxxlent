import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import {
  datasetRuns,
  foodComponents,
  foodNutrients,
  foodSources,
  foods,
  logEntries,
  logEntryItems,
  logEntryRevisions,
  logItemNutrients,
  portions
} from '../../src/lib/server/db/schema';
import { fdcAdapter, fdcDatasets } from '../../src/lib/server/importers/fdc';
import { runImport } from '../../src/lib/server/importers/source';
import {
  addManualEntry,
  backfillCatalogDietary,
  getEntry
} from '../../src/lib/server/services/entries';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'imports FDC nutrients, portions and weighted ingredients and backfills missing log groups',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nutrimaxxlent-fdc-'));
    const sourceId = `fixture-${randomUUID()}`;
    const { db, close } = connectDatabase(databaseUrl!);
    let entryId: string | undefined;
    try {
      await mkdir(join(dir, 'fdc'));
      const ingredients = [
        {
          fdcId: 10000,
          ndbNumber: 13317,
          description: 'Beef, ground, cooked',
          foodCategory: { description: 'Beef Products' },
          foodNutrients: []
        },
        {
          fdcId: 10001,
          ndbNumber: 11282,
          description: 'Onions, raw',
          foodCategory: { description: 'Vegetables and Vegetable Products' },
          foodNutrients: []
        }
      ];
      await Promise.all(
        fdcDatasets.map(({ file, key }, index) =>
          writeFile(
            join(dir, 'fdc', `${file}.json`),
            JSON.stringify({
              [key]:
                file !== 'fndds'
                  ? [ingredients[index]]
                  : [
                      {
                        fdcId: 10002,
                        foodCode: '27000001',
                        description: file,
                        foodNutrients: [
                          {
                            amount: 120,
                            nutrient: { number: '208', unitName: 'kcal', name: 'Energy' }
                          },
                          {
                            amount: 480,
                            nutrient: { number: '268', unitName: 'kJ', name: 'Energy' }
                          },
                          {
                            amount: 200,
                            nutrient: { number: '307', unitName: 'mg', name: 'Sodium' }
                          }
                        ],
                        foodPortions: [
                          { gramWeight: 90, sequenceNumber: 1, portionDescription: '1/2 cup' }
                        ],
                        foodAttributes: [
                          { value: 'Moisture change: -10%', foodAttributeType: { id: 1002 } }
                        ],
                        inputFoods: [
                          {
                            ingredientCode: 27000002,
                            ingredientDescription: 'Onion side dish',
                            ingredientWeight: 30,
                            sequenceNumber: 2
                          },
                          {
                            ingredientCode: 13317,
                            ingredientDescription: 'Beef, ground, cooked',
                            ingredientWeight: 170,
                            sequenceNumber: 1
                          },
                          {
                            ingredientCode: 999999,
                            ingredientDescription: 'Unresolved ingredient',
                            ingredientWeight: 10,
                            sequenceNumber: 3
                          }
                        ]
                      },
                      {
                        fdcId: 10003,
                        foodCode: '27000002',
                        description: 'Onion side dish',
                        foodNutrients: [],
                        inputFoods: [
                          {
                            ingredientCode: 11282,
                            ingredientDescription: 'Onions, raw',
                            ingredientWeight: 15,
                            sequenceNumber: 1
                          }
                        ]
                      }
                    ]
            })
          )
        )
      );
      const adapter = await fdcAdapter(dir);
      expect(
        await runImport(db, { ...adapter, source: { ...adapter.source, id: sourceId } })
      ).toMatchObject({ inserted: 4 });
      const catalog = await db.select().from(foods).where(eq(foods.sourceId, sourceId));
      expect(catalog.map(({ name }) => name)).toEqual(
        expect.arrayContaining(['Beef, ground, cooked', 'Onions, raw', 'Onion side dish', 'fndds'])
      );
      const survey = catalog.find(({ name }) => name === 'fndds')!;
      const child = (id: string) => catalog.find(({ sourceFoodId }) => sourceFoodId === id)!.id;
      expect(
        await db
          .select()
          .from(foodComponents)
          .where(eq(foodComponents.parentFoodId, survey.id))
          .orderBy(foodComponents.sortOrder)
      ).toMatchObject([
        { childFoodId: child('10000'), amountG: 153, depth: 0 },
        { childFoodId: child('10003'), amountG: 27, depth: 0 },
        { childFoodId: child('10001'), amountG: 27, depth: 1 },
        { childFoodId: null, amountG: 9, depth: 0 }
      ]);
      expect(await db.select().from(portions).where(eq(portions.foodId, survey.id))).toMatchObject([
        { label: '1/2 cup', unit: 'portion', grams: 90, isDefault: true },
        { label: '1 cup', unit: 'cup', grams: 180, isDefault: false }
      ]);
      expect(
        await db.select().from(foodNutrients).where(eq(foodNutrients.foodId, survey.id))
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nutrientId: 'energy_kcal', amount: 120 }),
          expect.objectContaining({ nutrientId: 'energy_kj', amount: 480 }),
          expect.objectContaining({ nutrientId: 'salt_g', amount: 0.5, isDerived: true })
        ])
      );
      const entry = await addManualEntry(db, {
        date: '2024-01-12',
        items: [{ kind: 'food', foodId: survey.id, quantity: 90, unit: 'g', confidence: 1 }]
      });
      entryId = entry!.id;
      const [item] = entry!.items;
      expect(item?.dietary?.groups.redMeat).toEqual({
        grams: expect.closeTo((170 / 210) * 90),
        partial: true
      });
      expect(item?.dietary?.groups.vegetables).toEqual({
        grams: expect.closeTo((30 / 210) * 90),
        partial: true
      });
      expect(item?.dietary?.unknownNovaG).toBe(90);

      // Simulate a log from before the importer saved ingredient classifications.
      await db.update(logEntryItems).set({ dietary: null }).where(eq(logEntryItems.id, item!.id));
      await db
        .update(foodNutrients)
        .set({ amount: 900 })
        .where(eq(foodNutrients.foodId, survey.id));
      expect(await backfillCatalogDietary(db, sourceId)).toBe(1);
      expect(await backfillCatalogDietary(db, sourceId)).toBe(0);
      expect((await getEntry(db, entryId))?.items[0]).toMatchObject({
        dietary: item!.dietary,
        grams: 90,
        nutrients: { energy_kcal: 108 }
      });
    } finally {
      if (entryId) {
        const items = await db
          .select({ id: logEntryItems.id })
          .from(logEntryItems)
          .where(eq(logEntryItems.entryId, entryId));
        if (items.length) {
          await db.delete(logItemNutrients).where(
            inArray(
              logItemNutrients.itemId,
              items.map(({ id }) => id)
            )
          );
        }
        await db.delete(logEntryItems).where(eq(logEntryItems.entryId, entryId));
        await db.delete(logEntryRevisions).where(eq(logEntryRevisions.entryId, entryId));
        await db.delete(logEntries).where(eq(logEntries.id, entryId));
      }
      await db.delete(foods).where(eq(foods.sourceId, sourceId));
      await db.delete(datasetRuns).where(eq(datasetRuns.sourceId, sourceId));
      await db.delete(foodSources).where(eq(foodSources.id, sourceId));
      await close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);
