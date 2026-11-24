import { scaleNutrients, type NutrientAmounts } from './amounts.ts';
import { canonicalNutrients } from '../../nutrition-reference.ts';
import { scaleDietary, sumDietary, unknownDietary, type DietaryAmounts } from './dietary.ts';

export type RecipeNutrition = {
  id: string;
  servings: number;
  totalWeightG?: number | null;
  ingredients: readonly RecipeNutritionIngredient[];
};

type RecipeNutritionIngredient = {
  grams: number;
  optional: boolean;
} & ({ food: NutrientAmounts; dietary?: DietaryAmounts } | { recipe: RecipeNutrition });

export function rollupRecipe(
  recipe: RecipeNutrition,
  includeOptional = false,
  ancestors: ReadonlySet<string> = new Set()
) {
  if (ancestors.has(recipe.id)) throw new Error('Recipe contains a cycle.');
  if (!Number.isFinite(recipe.servings) || recipe.servings <= 0) {
    throw new Error('Recipe servings must be positive.');
  }
  const visited = new Set([...ancestors, recipe.id]);
  const ingredients = recipe.ingredients.filter((item) => includeOptional || !item.optional);
  const weights = ingredients.reduce((sum, item) => sum + item.grams, 0);
  const allWeights = recipe.ingredients.reduce((sum, item) => sum + item.grams, 0);
  const grams =
    recipe.totalWeightG && allWeights > 0 ? recipe.totalWeightG * (weights / allWeights) : weights;
  const amounts = ingredients.map(
    (item): { nutrients: NutrientAmounts; dietary: DietaryAmounts } => {
      if ('food' in item)
        return {
          nutrients: scaleNutrients(item.food, item.grams),
          dietary: item.dietary
            ? scaleDietary(item.dietary, item.grams / 100)
            : unknownDietary(item.grams)
        };
      const nested = rollupRecipe(item.recipe, includeOptional, visited);
      if (nested.grams <= 0) throw new Error('Sub-recipe has no weight.');
      return {
        nutrients: scaleNutrients(nested.nutrients, (item.grams * 100) / nested.grams),
        dietary: scaleDietary(nested.dietary, item.grams / nested.grams)
      };
    }
  );

  const nutrients: NutrientAmounts = {};
  for (const { id } of canonicalNutrients) {
    const values = amounts.map((amount) => amount.nutrients[id]);
    if (values.every((value) => value === undefined)) continue;
    nutrients[id] = values.every((value): value is number => typeof value === 'number')
      ? values.reduce((sum, value) => sum + value, 0)
      : null;
  }

  return {
    grams,
    nutrients,
    dietary: sumDietary(amounts.map((amount) => amount.dietary)),
    gramsPerServing: grams / recipe.servings,
    perServing: scaleNutrients(nutrients, 100 / recipe.servings)
  };
}
