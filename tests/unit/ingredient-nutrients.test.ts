import { expect, test } from 'vitest';
import { estimateIngredientNutrients } from '../../src/lib/server/nutrition/ingredient-nutrients';

test('estimates stable nutrients while preserving label values and leaving ambiguous amounts out', () => {
  const estimates = estimateIngredientNutrients(
    { protein_g: 13.6, carbs_g: 26, fat_g: 5.6, iron_mg: 0 },
    [
      {
        percent: null,
        nutrients: {
          protein_g: 8,
          carbs_g: 50,
          fat_g: 8,
          iron_mg: 2,
          magnesium_mg: 35,
          vitamin_k_ug: 0
        }
      },
      {
        percent: 32,
        nutrients: {
          protein_g: 30,
          carbs_g: 0,
          fat_g: 4,
          iron_mg: 1,
          magnesium_mg: 29,
          vitamin_k_ug: 0
        }
      },
      {
        percent: null,
        nutrients: {
          protein_g: 0,
          carbs_g: 3,
          fat_g: 0,
          iron_mg: 1,
          magnesium_mg: 24,
          vitamin_k_ug: 100
        }
      },
      {
        percent: null,
        nutrients: {
          protein_g: 0,
          carbs_g: 3,
          fat_g: 0,
          iron_mg: 1,
          magnesium_mg: 15,
          vitamin_k_ug: 0
        }
      }
    ],
    false
  );

  // Tortilla and chicken are constrained by carbs and the declared percentage.
  // The feasible magnesium interval is approximately 28–32 mg per 100 g.
  expect(estimates).toEqual({ magnesium_mg: 30 });
});

test('declared weight order and percentages constrain composition without filling gaps in reference data', () => {
  const estimates = estimateIngredientNutrients(
    {},
    [
      { percent: null, nutrients: { calcium_mg: 100, magnesium_mg: 50 } },
      { percent: 49, nutrients: { calcium_mg: 0 } },
      { percent: null, nutrients: { calcium_mg: 0, magnesium_mg: 0 } }
    ],
    true
  );
  expect(estimates).toEqual({ calcium_mg: 50 });
});

test('rejects ingredient compositions that cannot reproduce the label', () => {
  const ingredients = [
    { percent: 60, nutrients: { protein_g: 0, magnesium_mg: 50 } },
    { percent: 40, nutrients: { protein_g: 0, magnesium_mg: 30 } }
  ];
  expect(estimateIngredientNutrients({ protein_g: 25 }, ingredients, true)).toEqual({});
  expect(estimateIngredientNutrients({}, ingredients.toReversed(), true)).toEqual({});
});
