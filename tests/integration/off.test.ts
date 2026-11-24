import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import {
  datasetRuns,
  foodNutrients,
  foodSources,
  foods,
  portions
} from '../../src/lib/server/db/schema';
import { offAdapter, prefilterOff } from '../../src/lib/server/importers/off';
import { runImport } from '../../src/lib/server/importers/source';
import { learnFoodAlias } from '../../src/lib/server/services/aliases';
import { searchFoods } from '../../src/lib/server/services/catalog';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'filters Swedish Parquet products and imports per-100g nutrients and portions',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nutrimaxxlent-off-'));
    const parquet = join(folder, 'fixture.parquet');
    const id = `fixture-${randomUUID()}`;
    const { db, close } = connectDatabase(databaseUrl!);

    try {
      execFileSync('duckdb', [
        '-batch',
        '-bail',
        '-c',
        `
      COPY (
        SELECT
          barcode AS code,
          [{'lang': 'main', 'text': 'Protein Bar'}, {'lang': 'sv', 'text': 'Proteinbar'}] AS product_name,
          'Barebells' AS brands,
          pack_unit AS product_quantity_unit,
          '55 g' AS quantity,
          '1 bar (55 g)' AS serving_size,
          4 AS nova_group,
          [{'name': 'energy-kcal', '100g': 360.0}, {'name': 'sodium', '100g': 0.3}] AS nutriments,
          1 AS rev,
          [country] AS countries_tags,
          false AS obsolete,
          false AS no_nutrition_data
        FROM (VALUES ('0123456789012', 'en:sweden', 'g'), ('0234567890123', 'en:france', 'g'),
          ('0345678901234', 'en:sweden', 'ml')) AS fixtures(barcode, country, pack_unit)
      ) TO '${parquet.replaceAll("'", "''")}' (FORMAT PARQUET);
    `
      ]);
      await prefilterOff(folder, parquet);
      const adapter = await offAdapter(folder);
      expect(await runImport(db, { ...adapter, source: { ...adapter.source, id } })).toMatchObject({
        inserted: 1
      });
      const catalog = await db.select().from(foods).where(eq(foods.sourceId, id));
      expect(catalog).toMatchObject([
        {
          barcode: '0123456789012',
          name: 'Proteinbar',
          brand: 'Barebells',
          kind: 'branded',
          classification: {
            dietary: { novaGrams: { 4: 100 }, unknownNovaG: 0, novaSources: ['Open Food Facts'] }
          }
        }
      ]);
      expect((await searchFoods(db, 'barbell bar', { source: id }))[0]).toMatchObject({
        id: catalog[0]!.id,
        match: 'alias'
      });
      await learnFoodAlias(db, 'barbell bar', catalog[0]!.id);
      expect((await searchFoods(db, ' Barbell  BAR ', { source: id }))[0]).toMatchObject({
        id: catalog[0]!.id,
        match: 'learned_alias'
      });
      expect(
        await db.select().from(portions).where(eq(portions.foodId, catalog[0]!.id))
      ).toMatchObject([{ grams: 55 }]);
      expect(
        await db.select().from(foodNutrients).where(eq(foodNutrients.foodId, catalog[0]!.id))
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nutrientId: 'energy_kcal', amount: 360 }),
          expect.objectContaining({ nutrientId: 'sodium_mg', amount: 300 })
        ])
      );
    } finally {
      await db.delete(foods).where(eq(foods.sourceId, id));
      await db.delete(datasetRuns).where(eq(datasetRuns.sourceId, id));
      await db.delete(foodSources).where(eq(foodSources.id, id));
      await close();
      await rm(folder, { recursive: true, force: true });
    }
  }
);
