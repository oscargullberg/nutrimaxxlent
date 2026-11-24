import { json } from '@sveltejs/kit';
import { eq, inArray, or } from 'drizzle-orm';
import { getDatabase } from '#lib/server/db/runtime.ts';
import {
  chatMessages,
  chatThreads,
  foodAliases,
  foodNutrients,
  foods,
  goals,
  logEntries,
  logEntryItems,
  logEntryRevisions,
  logItemNutrients,
  portions,
  profiles,
  recipeIngredients,
  recipes
} from '#lib/server/db/schema.ts';
import { endpoint } from '#lib/server/http/api.ts';

export const GET = endpoint(async () => {
  const db = getDatabase();
  const content = await db.transaction(
    async (tx) => {
      const [
        entries,
        items,
        nutrients,
        edits,
        threads,
        messages,
        settings,
        targets,
        userRecipes,
        ingredients,
        ownFoods,
        aliases
      ] = await Promise.all([
        tx.select().from(logEntries),
        tx.select().from(logEntryItems),
        tx.select().from(logItemNutrients),
        tx.select().from(logEntryRevisions),
        tx.select().from(chatThreads),
        tx.select().from(chatMessages),
        tx.select().from(profiles),
        tx.select().from(goals),
        tx.select().from(recipes),
        tx.select().from(recipeIngredients),
        tx.select().from(foods).where(eq(foods.sourceId, 'user')),
        tx.select().from(foodAliases).where(eq(foodAliases.source, 'learned'))
      ]);
      const ownIds = ownFoods.map(({ id }) => id);
      const [ownNutrients, ownPortions] = await Promise.all([
        ownIds.length
          ? tx.select().from(foodNutrients).where(inArray(foodNutrients.foodId, ownIds))
          : [],
        tx
          .select()
          .from(portions)
          .where(
            or(
              eq(portions.source, 'user'),
              ownIds.length ? inArray(portions.foodId, ownIds) : undefined
            )
          )
      ]);
      return {
        version: 1,
        exportedAt: new Date(),
        entries,
        items,
        nutrients,
        edits,
        threads,
        messages,
        settings,
        targets,
        recipes: userRecipes,
        ingredients,
        foods: ownFoods,
        aliases,
        foodNutrients: ownNutrients,
        portions: ownPortions
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  );
  return json(content, {
    headers: { 'content-disposition': 'attachment; filename="nutrimaxxlent-export.json"' }
  });
});
