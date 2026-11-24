import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { preSearch } from '../../src/lib/server/agent/presearch';
import { connectDatabase } from '../../src/lib/server/db/client';
import { foodAliases, foodSources, foods } from '../../src/lib/server/db/schema';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'pre-searches average carbonara and colloquial brand mentions',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const id = `presearch-${randomUUID()}`;
    try {
      await db.insert(foodSources).values({
        id,
        name: id,
        license: 'CC0',
        attribution: id,
        homepage: 'https://example.test'
      });
      const [bar, dish] = await db
        .insert(foods)
        .values([
          {
            sourceId: id,
            sourceFoodId: 'bar',
            sourceVersion: '1',
            kind: 'branded',
            name: 'Barebells protein bar',
            searchText: 'barebells protein bar'
          },
          {
            sourceId: id,
            sourceFoodId: 'dish',
            sourceVersion: '1',
            kind: 'dish',
            name: 'Carbonara',
            searchText: 'carbonara'
          }
        ])
        .returning({ id: foods.id });
      await db
        .insert(foodAliases)
        .values({ foodId: bar!.id, alias: 'barbell bar', source: 'fixture' });
      const order = await preSearch(
        db,
        'Double The Bastard Classic Cheese w shack fries,, chipotle dip'
      );
      expect(order.map(({ query }) => query)).toEqual([
        'double the bastard classic cheese',
        'shack fries',
        'chipotle dip'
      ]);
      const candidates = await preSearch(db, 'avg carbonara serving and barbell bar');
      expect(candidates.map(({ query }) => query)).toEqual(['carbonara', 'barbell bar']);
      expect(candidates[0]?.foods).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: dish!.id })])
      );
      expect(candidates[1]?.foods).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: bar!.id, match: 'alias' })])
      );
      const unpunctuated = await preSearch(
        db,
        'Ostkaka 300g frödinge 3x knäckebröd med ost, smör, salami äpple kaffe'
      );
      expect(unpunctuated.map(({ query }) => query)).toEqual([
        'ostkaka frodinge',
        'knackebrod',
        'ost',
        'smor',
        'salami',
        'apple',
        'kaffe'
      ]);
      expect(unpunctuated[1]?.standard).toMatchObject({ id: '190', grams: 12 });
      const water = await preSearch(db, 'Vattenglas, ett glas vatten, 2 glas med vatten');
      expect(water.map(({ query }) => query)).toEqual(['vatten', 'vatten', 'vatten']);
      const household = await preSearch(
        db,
        '1 glass of milk, 1 serving of carbonara, a piece of cake, 1 cup of flour'
      );
      expect(household.map(({ query }) => query)).toEqual(['milk', 'carbonara', 'cake', 'flour']);
    } finally {
      await db.delete(foods).where(eq(foods.sourceId, id));
      await db.delete(foodSources).where(eq(foodSources.id, id));
      await close();
    }
  }
);
