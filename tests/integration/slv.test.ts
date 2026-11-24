import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import {
  datasetRuns,
  foodComponents,
  foodNutrients,
  foodSources,
  foods
} from '../../src/lib/server/db/schema';
import { downloadSlv, slvAdapter } from '../../src/lib/server/importers/slv';
import { runImport } from '../../src/lib/server/importers/source';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'imports a carbonara tree, its English name, classification and both energy units',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nutrimaxxlent-slv-'));
    const { db, close } = connectDatabase(databaseUrl!);
    const sourceId = `fixture-${randomUUID()}`;
    const names = [
      [5804, 'Pasta carbonara m. pasta fläsk grädde', 'Pasta carbonara'],
      [2104, 'Carbonara pastasås', 'Carbonara sauce'],
      [3756, 'Pasta kokt m. salt', 'Boiled pasta'],
      [1234, 'Rökt sidfläsk', 'Smoked bacon']
    ] as const;
    const items = {
      5804: [
        {
          nummer: 2104,
          namn: 'Carbonara pastasås',
          viktForeTillagning: 210,
          viktEfterTillagning: 200
        },
        {
          nummer: 3756,
          namn: 'Pasta kokt m. salt',
          viktForeTillagning: 300,
          viktEfterTillagning: 300
        }
      ],
      2104: [
        { nummer: 1234, namn: 'Rökt sidfläsk', viktForeTillagning: 500, viktEfterTillagning: 400 }
      ]
    } as const;

    const fetcher: typeof fetch = async (input) => {
      await Promise.resolve();
      const url = new URL(String(input));
      const [, number, section] = url.pathname.match(/\/livsmedel(?:\/(\d+)\/(\w+))?$/u) ?? [];
      if (!number) {
        return Response.json({
          _meta: { totalRecords: names.length },
          livsmedel: names.map(([nummer, sv, en]) => ({
            nummer,
            namn: url.searchParams.get('sprak') === '2' ? en : sv,
            version: '2026-06-29',
            livsmedelsTypId: Object.hasOwn(items, nummer) ? 2 : 1,
            links: Object.hasOwn(items, nummer) ? [{ rel: 'ingredienser' }] : []
          }))
        });
      }
      if (section === 'ingredienser')
        return Response.json(items[Number(number) as keyof typeof items]);
      if (section === 'klassificeringar') {
        return Response.json(
          number === '1234'
            ? [
                { fasett: 'A Gruppindelning EuroFIR', namn: 'Konserverat kött' },
                { fasett: 'B Artklassificering', namn: 'Gris' }
              ]
            : [{ fasett: 'A Gruppindelning EuroFIR', namn: 'Pastarätter' }]
        );
      }
      return Response.json([
        { euroFIRkod: 'ENERC', enhet: 'kJ', varde: 793, viktGram: 100 },
        { euroFIRkod: 'ENERC', enhet: 'kcal', varde: 189, viktGram: 100 }
      ]);
    };

    try {
      await downloadSlv(folder, { fetcher });
      const adapter = await slvAdapter(folder);
      expect(
        await runImport(db, { ...adapter, source: { ...adapter.source, id: sourceId } })
      ).toMatchObject({ inserted: 4 });
      const catalog = await db.select().from(foods).where(eq(foods.sourceId, sourceId));
      const dish = catalog.find((row) => row.sourceFoodId === '5804');
      const bacon = catalog.find((row) => row.sourceFoodId === '1234');
      expect(dish).toMatchObject({
        nameEn: 'Pasta carbonara',
        category: 'Pastarätter',
        classification: {
          dietary: {
            groups: {
              redMeat: { grams: 40, partial: true },
              processedMeat: { grams: 40, partial: true }
            },
            unknownNovaG: 100
          }
        }
      });
      const components = await db
        .select()
        .from(foodComponents)
        .where(eq(foodComponents.parentFoodId, dish!.id))
        .orderBy(foodComponents.sortOrder);
      expect(components).toMatchObject([
        { depth: 0, name: 'Carbonara pastasås', amountG: 200 },
        { depth: 1, childFoodId: bacon?.id, amountG: 200, rawAmountG: 250 },
        { depth: 0, name: 'Pasta kokt m. salt', amountG: 300 }
      ]);
      expect(
        await db.select().from(foodNutrients).where(eq(foodNutrients.foodId, dish!.id))
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nutrientId: 'energy_kcal', amount: 189 }),
          expect.objectContaining({ nutrientId: 'energy_kj', amount: 793 })
        ])
      );
      await db.update(foods).set({ sourceVersion: 'old-version' }).where(eq(foods.id, dish!.id));
      await runImport(db, { ...adapter, source: { ...adapter.source, id: sourceId } });
      expect(
        await db
          .select()
          .from(foodComponents)
          .where(eq(foodComponents.parentFoodId, dish!.id))
          .orderBy(foodComponents.sortOrder)
      ).toEqual(components);
    } finally {
      await db.delete(foods).where(eq(foods.sourceId, sourceId));
      await db.delete(datasetRuns).where(eq(datasetRuns.sourceId, sourceId));
      await db.delete(foodSources).where(eq(foodSources.id, sourceId));
      await close();
      await rm(folder, { recursive: true, force: true });
    }
  }
);
