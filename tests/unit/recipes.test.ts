import { expect, test } from 'vitest';
import { rollupRecipe, type RecipeNutrition } from '../../src/lib/server/nutrition/recipes';

const recipe: RecipeNutrition = {
  id: 'meal',
  servings: 2,
  ingredients: [
    {
      grams: 50,
      optional: false,
      recipe: {
        id: 'sauce',
        servings: 1,
        totalWeightG: 100,
        ingredients: [{ grams: 200, optional: false, food: { energy_kcal: 50, protein_g: 2 } }]
      }
    },
    { grams: 150, optional: true, food: { energy_kcal: 200 } }
  ]
};

test('uses the cooked weight of a nested recipe and scales to servings', () => {
  expect(rollupRecipe(recipe)).toEqual({
    grams: 50,
    gramsPerServing: 25,
    nutrients: { energy_kcal: 50, protein_g: 2 },
    dietary: { groups: {}, groupsKnown: false, novaGrams: {}, unknownNovaG: 100, novaSources: [] },
    perServing: { energy_kcal: 25, protein_g: 1 }
  });
});

test('includes optional ingredients when requested and preserves unknown nutrients', () => {
  expect(rollupRecipe(recipe, true).perServing).toEqual({ energy_kcal: 175, protein_g: null });
});

test('rejects cycles', () => {
  const cycle: RecipeNutrition = { id: 'cycle', servings: 1, ingredients: [] };
  cycle.ingredients = [{ recipe: cycle, grams: 100, optional: false }];
  expect(() => rollupRecipe(cycle)).toThrow('cycle');
});
