import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { foodNutrients, foods, portions, recipeIngredients, recipes } from '../db/schema.ts';
import { ApiError } from '../http/api.ts';
import { normalizeSearch } from '../importers/source.ts';
import { normalizeUnit, resolveGrams, type NutrientAmounts } from '../nutrition/amounts.ts';
import { rollupRecipe, type RecipeNutrition } from '../nutrition/recipes.ts';
import type { DietaryAmounts } from '../nutrition/dietary.ts';
import type { NutrientId } from '../../nutrition-reference.ts';

const ingredient = z.object({
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).max(100),
  optional: z.boolean().default(false)
});

export const recipeInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  instructions: z.string().trim().max(10000).optional(),
  servings: z.number().positive(),
  totalWeightG: z.number().positive().optional(),
  ingredients: z
    .array(
      z.discriminatedUnion('kind', [
        ingredient.extend({ kind: z.literal('food'), foodId: z.uuid() }),
        ingredient.extend({ kind: z.literal('recipe'), recipeId: z.uuid() })
      ])
    )
    .min(1)
    .max(100)
});

type DbReader = Pick<Database, 'select'>;

async function loadNutrition(db: DbReader) {
  const [definitions, ingredients] = await Promise.all([
    db.select().from(recipes),
    db.select().from(recipeIngredients).orderBy(recipeIngredients.sortOrder)
  ]);
  const foodIds = [...new Set(ingredients.flatMap((item) => (item.foodId ? [item.foodId] : [])))];
  const [nutrientRows, foodRows] = foodIds.length
    ? await Promise.all([
        db.select().from(foodNutrients).where(inArray(foodNutrients.foodId, foodIds)),
        db
          .select({
            id: foods.id,
            dietary: sql<DietaryAmounts | null>`${foods.classification}->'dietary'`
          })
          .from(foods)
          .where(inArray(foods.id, foodIds))
      ])
    : [[], []];
  const dietaryByFood = new Map(foodRows.map(({ id, dietary }) => [id, dietary]));
  const amountsByFood = new Map<string, NutrientAmounts>();
  for (const row of nutrientRows) {
    const amounts = amountsByFood.get(row.foodId) ?? {};
    amounts[row.nutrientId as NutrientId] = row.amount;
    amountsByFood.set(row.foodId, amounts);
  }
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const byRecipe = Map.groupBy(ingredients, (item) => item.recipeId);
  return { byId, byRecipe, amountsByFood, dietaryByFood };
}

function recipeTree(
  data: Awaited<ReturnType<typeof loadNutrition>>,
  id: string,
  visited: string[] = []
): RecipeNutrition {
  if (visited.includes(id)) throw new ApiError(409, 'RECIPE_CYCLE', 'Recipe contains a cycle.');
  const definition = data.byId.get(id);
  if (!definition) throw new Error('Recipe was not found.');
  const ingredients = (data.byRecipe.get(id) ?? []).map((item) => {
    const base = { optional: item.optional, grams: item.grams };
    return item.subRecipeId
      ? { ...base, recipe: recipeTree(data, item.subRecipeId, [...visited, id]) }
      : {
          ...base,
          food: data.amountsByFood.get(item.foodId ?? '') ?? {},
          dietary: data.dietaryByFood.get(item.foodId ?? '') ?? undefined
        };
  });
  return { id, servings: definition.servings, totalWeightG: definition.totalWeightG, ingredients };
}

export async function getRecipe(db: DbReader, id: string) {
  const data = await loadNutrition(db);
  const definition = data.byId.get(id);
  if (!definition) return null;
  return {
    ...definition,
    ingredients: data.byRecipe.get(id) ?? [],
    nutrition: rollupRecipe(recipeTree(data, id))
  };
}

export async function getRecipeTree(db: DbReader, id: string) {
  const data = await loadNutrition(db);
  return data.byId.has(id) ? recipeTree(data, id) : null;
}

export async function saveRecipe(db: Database, input: z.input<typeof recipeInput>, id?: string) {
  const recipe = recipeInput.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('recipe-graph'))`);
    const values = {
      name: recipe.name,
      description: recipe.description ?? null,
      instructions: recipe.instructions ?? null,
      servings: recipe.servings,
      totalWeightG: recipe.totalWeightG ?? null,
      searchText: normalizeSearch([recipe.name, recipe.description].filter(Boolean).join(' '))
    };
    const [saved] = id
      ? await tx.update(recipes).set(values).where(eq(recipes.id, id)).returning()
      : await tx.insert(recipes).values(values).returning();
    if (!saved) throw new ApiError(404, 'NOT_FOUND', 'Recipe was not found.');

    await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, saved.id));
    const foodIds = [
      ...new Set(recipe.ingredients.flatMap((item) => (item.kind === 'food' ? [item.foodId] : [])))
    ];
    const selectedFoods = foodIds.length
      ? await tx.select().from(foods).where(inArray(foods.id, foodIds))
      : [];
    const selectedPortions = foodIds.length
      ? await tx.select().from(portions).where(inArray(portions.foodId, foodIds))
      : [];
    const selectedById = new Map(selectedFoods.map((food) => [food.id, food]));
    const portionsByFood = Map.groupBy(selectedPortions, (portion) => portion.foodId);
    const data = await loadNutrition(tx);

    const rows = recipe.ingredients.map((ingredient, sortOrder) => {
      const base = {
        recipeId: saved.id,
        unit: ingredient.unit,
        quantity: ingredient.quantity,
        optional: ingredient.optional,
        sortOrder
      };

      if (ingredient.kind === 'food') {
        const food = selectedById.get(ingredient.foodId);
        if (!food) throw new ApiError(400, 'INVALID_INPUT', 'Ingredient food was not found.');
        const grams = resolveGrams(ingredient.quantity, ingredient.unit, {
          densityGPerMl: food.densityGPerMl,
          portions: portionsByFood.get(food.id)
        });
        if (!grams)
          throw new ApiError(
            400,
            'INVALID_INPUT',
            `Use a known portion or a weight for ${food.name}.`
          );
        return { ...base, foodId: food.id, name: food.name, grams };
      }

      const subRecipe = data.byId.get(ingredient.recipeId);
      if (!subRecipe) throw new ApiError(400, 'INVALID_INPUT', 'Ingredient recipe was not found.');
      const subTree = recipeTree(data, subRecipe.id, [saved.id]);
      const grams =
        normalizeUnit(ingredient.unit) === 'portion'
          ? ingredient.quantity * rollupRecipe(subTree).gramsPerServing
          : resolveGrams(ingredient.quantity, ingredient.unit);
      if (!grams)
        throw new ApiError(
          400,
          'INVALID_INPUT',
          `Use a serving or a weight for ${subRecipe.name}.`
        );
      return { ...base, subRecipeId: subRecipe.id, name: subRecipe.name, grams };
    });

    await tx.insert(recipeIngredients).values(rows);
    return getRecipe(tx, saved.id);
  });
}

export async function deleteRecipe(db: Database, id: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('recipe-graph'))`);
    const [reference] = await tx
      .select({ id: recipeIngredients.id })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.subRecipeId, id))
      .limit(1);
    if (reference)
      throw new ApiError(
        409,
        'RECIPE_IN_USE',
        'Remove this recipe from other recipes before deleting it.'
      );
    const [removed] = await tx
      .delete(recipes)
      .where(eq(recipes.id, id))
      .returning({ id: recipes.id });
    return Boolean(removed);
  });
}

export async function searchRecipes(db: Database, phrase = '', limit = 20) {
  const query = normalizeSearch(phrase);
  return db.execute<{ id: string; name: string; description: string | null; servings: number }>(sql`
    SELECT id, name, description, servings FROM recipes
    WHERE ${query} = '' OR lower(unaccent(name)) = ${query}
      OR to_tsvector('simple', search_text) @@ plainto_tsquery('simple', ${query})
      OR (${query.length} >= 3 AND ${query} <% search_text)
    ORDER BY (lower(unaccent(name)) = ${query}) DESC,
      word_similarity(${query}, search_text) DESC, name, id
    LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}
  `);
}
