import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import {
  foodAliases,
  foodNutrients,
  foodSources,
  foods,
  logEntries,
  logEntryItems
} from '../../src/lib/server/db/schema';
import { normalizeSearch } from '../../src/lib/server/importers/source';
import { searchFoods } from '../../src/lib/server/services/catalog';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'ranks barcode, exact alias, exact name, FTS and fuzzy matches with recent, favorite and source boosts',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const tag = randomUUID().slice(0, 8);
    const acronym = `zarvina${tag}`;
    const slv = 'slv';
    const fdc = 'fdc';
    const ids: string[] = [];
    let entryId: string | undefined;

    async function add(
      name: string,
      sourceId: string,
      options: { barcode?: string; favorite?: boolean } = {}
    ) {
      const [row] = await db
        .insert(foods)
        .values({
          sourceId,
          sourceFoodId: randomUUID(),
          sourceVersion: 'test',
          kind: 'generic',
          name,
          searchText: normalizeSearch(name),
          ...options
        })
        .returning({ id: foods.id });
      ids.push(row!.id);
      return row!.id;
    }

    try {
      await db
        .insert(foodSources)
        .values(
          [slv, fdc].map((id) => ({
            id,
            name: id,
            license: 'CC0',
            attribution: id,
            homepage: 'https://example.test'
          }))
        )
        .onConflictDoNothing();
      const barcode = String(BigInt('0x' + tag) + 2000000000000n);
      const barcodeId = await add('Product code', slv, { barcode });
      await add(barcode, slv);
      expect((await searchFoods(db, barcode))[0]).toMatchObject({
        id: barcodeId,
        match: 'barcode'
      });

      const aliasId = await add('Product alias', fdc);
      const exact = await add(acronym, slv);
      const textId = await add(`${acronym} ground`, slv);
      await db.insert(foodAliases).values({ foodId: aliasId, alias: acronym, source: 'fixture' });
      await db
        .insert(foodNutrients)
        .values({ foodId: exact, nutrientId: 'energy_kcal', amount: 123, unit: 'kcal' });

      const ranked = await searchFoods(db, acronym);
      expect(ranked.slice(0, 3)).toMatchObject([
        { id: aliasId, match: 'alias', sourceId: fdc, sourceName: expect.any(String) },
        { id: exact, match: 'name', energyKcal: 123, proteinG: null },
        { id: textId, match: 'text' }
      ]);
      expect(
        await searchFoods(db, acronym.replace('zarvina', 'zarvinae'), { source: slv })
      ).toEqual(expect.arrayContaining([expect.objectContaining({ id: exact, match: 'fuzzy' })]));

      const boostedName = `norlava${tag}`;
      const foreign = await add(boostedName, fdc);
      const local = await add(boostedName, slv);
      expect((await searchFoods(db, boostedName))[0]?.id).toBe(local);
      await db.update(foods).set({ favorite: true }).where(eq(foods.id, foreign));
      expect((await searchFoods(db, boostedName))[0]?.id).toBe(foreign);

      const [entry] = await db
        .insert(logEntries)
        .values({
          loggedAt: new Date(),
          rawText: boostedName,
          confidence: 1
        })
        .returning({ id: logEntries.id });
      entryId = entry!.id;
      await db.insert(logEntryItems).values({
        entryId,
        foodId: local,
        kind: 'food',
        label: boostedName,
        quantity: 100,
        unit: 'g',
        grams: 100,
        provenance: 'catalog',
        confidence: 1,
        resolution: {}
      });
      expect((await searchFoods(db, boostedName))[0]?.id).toBe(local);
    } finally {
      if (entryId) {
        await db.delete(logEntryItems).where(eq(logEntryItems.entryId, entryId));
        await db.delete(logEntries).where(eq(logEntries.id, entryId));
      }
      if (ids.length) await db.delete(foods).where(inArray(foods.id, ids));
      await close();
    }
  }
);
