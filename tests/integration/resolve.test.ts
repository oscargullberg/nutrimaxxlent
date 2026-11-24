import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { resolveProposal } from '../../src/lib/server/agent/resolve';
import { connectDatabase } from '../../src/lib/server/db/client';
import { datasetRuns, foodComponents, foodSources, foods } from '../../src/lib/server/db/schema';
import { runImport, type SourceFood } from '../../src/lib/server/importers/source';
import { deleteRecipe, saveRecipe } from '../../src/lib/server/services/recipes';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'resolves carbonara, a portion, dish adjustments, recipe servings, and estimates',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const sourceId = `resolve-${randomUUID()}`;
    let recipeId: string | undefined;
    const kcal = (amount: number) => ({ nutrientId: 'energy_kcal' as const, unit: 'kcal', amount });

    try {
      await runImport(db, {
        source: {
          id: sourceId,
          name: 'Fixture',
          license: 'CC0',
          attribution: 'Fixture',
          homepage: 'https://example.test'
        },
        version: '1',
        async *records() {
          await Promise.resolve();
          const batch: SourceFood[] = [
            {
              id: 'carbonara',
              name: 'Carbonara',
              kind: 'dish',
              nutrients: [kcal(180)],
              components: [
                { foodId: 'pancetta', name: 'Pancetta', depth: 0, amountG: 200 },
                { foodId: 'pasta', name: 'Pasta', depth: 0, amountG: 800 }
              ]
            },
            { id: 'pancetta', name: 'Pancetta', kind: 'generic', nutrients: [kcal(400)] },
            {
              id: 'pasta',
              name: 'Pasta',
              kind: 'generic',
              nutrients: [kcal(125)],
              portions: [{ label: 'Bowl', unit: 'portion', grams: 200, isDefault: true }]
            },
            { id: 'peas', name: 'Peas', kind: 'generic', nutrients: [kcal(80)] }
          ];
          yield* batch;
        }
      });
      const catalog = await db.select().from(foods).where(eq(foods.sourceId, sourceId));
      const byId = new Map(catalog.map(({ sourceFoodId, id }) => [sourceFoodId, id]));
      const carbonaraId = byId.get('carbonara')!;
      const pastaId = byId.get('pasta')!;
      const [pancetta] = await db
        .select()
        .from(foodComponents)
        .where(eq(foodComponents.parentFoodId, carbonaraId))
        .orderBy(foodComponents.sortOrder);
      const recipe = await saveRecipe(db, {
        name: 'Pasta bowl',
        servings: 2,
        ingredients: [{ kind: 'food', foodId: pastaId, quantity: 400, unit: 'g' }]
      });
      recipeId = recipe!.id;
      const { items } = await resolveProposal(db, {
        reply: 'Here is your meal',
        needsClarification: false,
        items: [
          { kind: 'food', foodId: carbonaraId, quantity: 1, unit: 'serving', confidence: 0.95 },
          { kind: 'food', foodId: pastaId, quantity: 1.5, unit: 'portion', confidence: 0.95 },
          {
            kind: 'dish_adjustment',
            foodId: carbonaraId,
            grams: 375,
            confidence: 0.95,
            adjustments: [
              { kind: 'remove', component: pancetta!.id },
              { kind: 'add', food: { foodId: byId.get('peas'), quantity: 50, unit: 'g' } }
            ]
          },
          { kind: 'recipe', recipeId, servings: 2, confidence: 1 },
          {
            kind: 'estimate',
            label: 'A bite',
            grams: 20,
            confidence: 0.8,
            per100g: { energy_kcal: 100 },
            assumptions: ['Example estimate']
          }
        ]
      });
      expect(items).toMatchObject([
        {
          grams: 250,
          nutrients: { energy_kcal: 450 },
          assumptions: [expect.stringContaining('quarter')]
        },
        { grams: 300, nutrients: { energy_kcal: 375 } },
        { grams: 350, nutrients: { energy_kcal: 415 }, provenance: 'catalog' },
        { grams: 400, nutrients: { energy_kcal: 500 }, provenance: 'recipe' },
        { grams: 20, nutrients: { energy_kcal: 20 }, provenance: 'estimate' }
      ]);
    } finally {
      if (recipeId) await deleteRecipe(db, recipeId);
      await db.delete(foods).where(eq(foods.sourceId, sourceId));
      await db.delete(datasetRuns).where(eq(datasetRuns.sourceId, sourceId));
      await db.delete(foodSources).where(eq(foodSources.id, sourceId));
      await close();
    }
  }
);
