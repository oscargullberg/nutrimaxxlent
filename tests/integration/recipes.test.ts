import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import { foodNutrients, foodSources, foods } from '../../src/lib/server/db/schema';
import {
  deleteRecipe,
  getRecipe,
  saveRecipe,
  searchRecipes
} from '../../src/lib/server/services/recipes';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)('creates, searches, rolls up, edits and deletes recipes', async () => {
  const { db, close } = connectDatabase(databaseUrl!);
  const sourceId = `recipe-fixture-${randomUUID()}`;
  const ids: string[] = [];
  try {
    await db.insert(foodSources).values({
      id: sourceId,
      name: 'Fixture',
      license: 'CC0',
      attribution: 'Fixture',
      homepage: 'https://example.test'
    });
    const [food] = await db
      .insert(foods)
      .values({
        name: 'Fixture food',
        sourceId,
        sourceFoodId: '1',
        sourceVersion: '1',
        kind: 'generic',
        searchText: 'fixture food'
      })
      .returning({ id: foods.id });
    await db
      .insert(foodNutrients)
      .values({ foodId: food!.id, nutrientId: 'energy_kcal', amount: 100, unit: 'kcal' });
    const name = `Fixture ${sourceId}`;
    const input = {
      name,
      servings: 2,
      ingredients: [{ kind: 'food' as const, foodId: food!.id, quantity: 300, unit: 'g' }]
    };
    const recipe = await saveRecipe(db, input);
    ids.unshift(recipe!.id);
    expect(recipe?.nutrition.perServing.energy_kcal).toBe(150);
    expect((await searchRecipes(db, name))[0]?.id).toBe(recipe?.id);

    const nested = await saveRecipe(db, {
      name: 'Fixture meal',
      servings: 1,
      ingredients: [{ kind: 'recipe', recipeId: recipe!.id, quantity: 1, unit: 'serving' }]
    });
    ids.unshift(nested!.id);
    expect(nested?.nutrition.perServing.energy_kcal).toBe(150);
    await expect(
      saveRecipe(
        db,
        {
          ...input,
          ingredients: [{ kind: 'recipe', recipeId: nested!.id, quantity: 1, unit: 'serving' }]
        },
        recipe!.id
      )
    ).rejects.toMatchObject({ status: 409, code: 'RECIPE_CYCLE' });
    await expect(deleteRecipe(db, recipe!.id)).rejects.toMatchObject({
      status: 409,
      code: 'RECIPE_IN_USE'
    });

    const updated = await saveRecipe(
      db,
      { ...input, name: 'Renamed recipe', servings: 3 },
      recipe!.id
    );
    expect(updated?.nutrition.perServing.energy_kcal).toBeCloseTo(100);
    expect((await getRecipe(db, recipe!.id))?.name).toBe('Renamed recipe');
    expect(await deleteRecipe(db, nested!.id)).toBe(true);
    expect(await deleteRecipe(db, recipe!.id)).toBe(true);
    expect(await getRecipe(db, recipe!.id)).toBeNull();
  } finally {
    for (const id of ids) await deleteRecipe(db, id);
    await db.delete(foods).where(eq(foods.sourceId, sourceId));
    await db.delete(foodSources).where(eq(foodSources.id, sourceId));
    await close();
  }
});
