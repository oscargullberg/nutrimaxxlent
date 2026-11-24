import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import {
  foodNutrients,
  foods,
  foodSources,
  logEntries,
  logEntryItems,
  logEntryRevisions,
  logItemNutrients
} from '../../src/lib/server/db/schema';
import {
  addManualEntry,
  changeEntryStatus,
  editLogItem,
  getEntry,
  listEntries,
  removeLogItem,
  updateEntry
} from '../../src/lib/server/services/entries';
import { dayTotals } from '../../src/lib/server/services/totals';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'commits snapshots, recomputes intentional edits, removes items, and audits undo and deletion',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const id = `entries-${randomUUID()}`;
    let entryId: string | undefined;
    try {
      await db.insert(foodSources).values({
        id,
        name: 'Fixture',
        license: 'CC0',
        attribution: 'Fixture',
        homepage: 'https://example.test'
      });
      const [food] = await db
        .insert(foods)
        .values({
          sourceId: id,
          sourceFoodId: '1',
          sourceVersion: '1',
          name: 'Fixture rice',
          classification: {
            dietary: {
              groups: { wholeGrains: { grams: 100 } },
              novaGrams: { 4: 100 },
              unknownNovaG: 0,
              novaSources: ['Fixture']
            }
          },
          kind: 'generic',
          searchText: 'fixture rice'
        })
        .returning({ id: foods.id });
      const foodId = food!.id;
      await db.insert(foodNutrients).values([
        { foodId, nutrientId: 'energy_kcal', unit: 'kcal', amount: 120 },
        { foodId, nutrientId: 'protein_g', unit: 'g', amount: 3 }
      ]);
      const entry = await addManualEntry(db, {
        date: '2024-09-21',
        meal: 'lunch',
        items: [
          { kind: 'food', foodId, quantity: 200, unit: 'g', confidence: 1 },
          {
            kind: 'estimate',
            label: 'Fixture fruit',
            grams: 100,
            confidence: 1,
            per100g: { energy_kcal: 80 },
            assumptions: ['Fixture']
          }
        ]
      });
      entryId = entry!.id;
      const riceId = entry!.items.find((item) => item.foodId === foodId)!.id;
      const fruitId = entry!.items.find((item) => item.kind === 'estimate')!.id;
      const totals = await dayTotals(db, '2024-09-21');
      expect(totals.dietary).toMatchObject({
        groups: { wholeGrains: { grams: 200, partial: true } },
        novaGrams: { 4: 200 },
        unknownNovaG: 100
      });
      await db.update(foodNutrients).set({ amount: 130 }).where(eq(foodNutrients.foodId, foodId));
      expect(
        (await getEntry(db, entryId))?.items.find((item) => item.id === riceId)?.nutrients
          .energy_kcal
      ).toBe(240);
      const converted = await editLogItem(db, entryId, riceId, { unit: 'kg' });
      expect(converted?.items.find((item) => item.id === riceId)).toMatchObject({
        quantity: 0.2,
        unit: 'kg',
        grams: 200,
        nutrients: { energy_kcal: 240 }
      });
      await expect(editLogItem(db, entryId, riceId, { unit: 'cup' })).rejects.toMatchObject({
        code: 'INVALID_INPUT'
      });
      const edited = await editLogItem(db, entryId, riceId, { grams: 300 });
      expect(edited?.items.find((item) => item.id === riceId)).toMatchObject({
        grams: 300,
        dietary: { groups: { wholeGrains: { grams: 300 } } },
        nutrients: { energy_kcal: 390 }
      });
      const corrected = await editLogItem(db, entryId, fruitId, { per100g: { energy_kcal: 65 } });
      expect(corrected?.items.find((item) => item.id === fruitId)).toMatchObject({
        provenance: 'corrected',
        nutrients: { energy_kcal: 65 }
      });
      expect((await removeLogItem(db, entryId, fruitId))?.items).toHaveLength(1);
      expect((await dayTotals(db, '2024-09-21')).dietary).toMatchObject({
        groups: { wholeGrains: { grams: 300 } },
        unknownNovaG: 0
      });
      expect((await updateEntry(db, entryId, { meal: 'dinner' }))?.meal).toBe('dinner');
      expect((await changeEntryStatus(db, entryId, 'undone'))?.status).toBe('undone');
      expect((await listEntries(db)).map(({ id }) => id)).not.toContain(entryId);
      expect((await dayTotals(db, '2024-09-21')).dietary.novaGrams).toEqual({});
      expect((await changeEntryStatus(db, entryId, 'deleted'))?.status).toBe('deleted');

      const revisions = await db
        .select()
        .from(logEntryRevisions)
        .where(eq(logEntryRevisions.entryId, entryId));
      expect(revisions.map(({ action }) => action)).toEqual(
        expect.arrayContaining(['edit_item', 'remove_item', 'edit_entry', 'undo', 'delete'])
      );
      expect(revisions).toHaveLength(7);
    } finally {
      if (entryId) {
        const items = await db
          .select({ id: logEntryItems.id })
          .from(logEntryItems)
          .where(eq(logEntryItems.entryId, entryId));
        if (items.length)
          await db.delete(logItemNutrients).where(
            inArray(
              logItemNutrients.itemId,
              items.map(({ id }) => id)
            )
          );
        await db.delete(logEntryItems).where(eq(logEntryItems.entryId, entryId));
        await db.delete(logEntryRevisions).where(eq(logEntryRevisions.entryId, entryId));
        await db.delete(logEntries).where(eq(logEntries.id, entryId));
      }
      await db.delete(foods).where(eq(foods.sourceId, id));
      await db.delete(foodSources).where(eq(foodSources.id, id));
      await close();
    }
  }
);
