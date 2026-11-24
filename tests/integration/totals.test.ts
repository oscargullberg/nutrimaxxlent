import { and, eq, inArray } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import { goals, logEntries, logEntryItems, logItemNutrients } from '../../src/lib/server/db/schema';
import {
  dayTotals,
  getProfile,
  rangeTotals,
  recentMeals
} from '../../src/lib/server/services/totals';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'groups by local day and meal and compares with that date’s goals',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const profile = await getProfile(db);
    const date = '2199-05-19';
    const goalDate = '2199-05-18';
    const goalKey = and(eq(goals.profileId, 1), eq(goals.effectiveFrom, goalDate));
    const entryIds: string[] = [];
    const itemIds: string[] = [];
    expect(profile.timezone).toBe('Europe/Stockholm');
    try {
      await db
        .insert(goals)
        .values({ profileId: 1, effectiveFrom: goalDate, kcal: 2300, proteinG: 80 });
      const entries = await db
        .insert(logEntries)
        .values([
          {
            rawText: 'Breakfast',
            loggedAt: new Date('2199-05-18T22:01Z'),
            meal: 'breakfast',
            confidence: 1
          },
          {
            rawText: 'Lunch',
            loggedAt: new Date('2199-05-19T10:00Z'),
            meal: 'lunch',
            confidence: 1
          },
          {
            rawText: 'Tomorrow',
            loggedAt: new Date('2199-05-19T22:01Z'),
            meal: 'dinner',
            confidence: 1
          }
        ])
        .returning({ id: logEntries.id });
      entryIds.push(...entries.map(({ id }) => id));
      const items = await db
        .insert(logEntryItems)
        .values(
          entryIds.map((entryId) => ({
            entryId,
            label: 'Fixture',
            kind: 'estimate' as const,
            quantity: 100,
            unit: 'g',
            grams: 100,
            provenance: 'estimate' as const,
            confidence: 1,
            resolution: {}
          }))
        )
        .returning({ id: logEntryItems.id });
      itemIds.push(...items.map(({ id }) => id));
      await db.insert(logItemNutrients).values(
        itemIds.map((itemId) => ({
          itemId,
          nutrientId: 'energy_kcal',
          amount: 125,
          unit: 'kcal'
        }))
      );

      const day = await dayTotals(db, date);
      expect(day.meals.breakfast?.totals.energy_kcal).toBe(125);
      expect(day.meals.lunch?.totals.energy_kcal).toBe(125);
      expect(day.meals.dinner).toBeUndefined();
      expect(day.comparison.energy_kcal).toEqual({ consumed: 250, target: 2300 });
      expect(day.comparison.protein_g).toEqual({ consumed: null, target: 80 });
      expect(
        (await rangeTotals(db, date, '2199-05-20')).map(({ totals }) => totals.energy_kcal)
      ).toEqual([250, 125]);

      const [side] = await db
        .insert(logEntryItems)
        .values({
          entryId: entries[1]!.id,
          label: 'Side dish',
          kind: 'estimate',
          quantity: 60,
          unit: 'g',
          grams: 60,
          provenance: 'estimate',
          confidence: 1,
          resolution: {}
        })
        .returning({ id: logEntryItems.id });
      itemIds.push(side!.id);
      expect(await recentMeals(db, profile, { date, limit: 1 })).toMatchObject([
        {
          id: entries[1]!.id,
          meal: 'lunch',
          items: expect.arrayContaining([
            expect.objectContaining({ label: 'Fixture', grams: 100 }),
            expect.objectContaining({ label: 'Side dish', grams: 60 })
          ])
        }
      ]);
    } finally {
      if (itemIds.length) {
        await db.delete(logItemNutrients).where(inArray(logItemNutrients.itemId, itemIds));
        await db.delete(logEntryItems).where(inArray(logEntryItems.id, itemIds));
      }
      if (entryIds.length) await db.delete(logEntries).where(inArray(logEntries.id, entryIds));
      await db.delete(goals).where(goalKey);
      await close();
    }
  }
);
