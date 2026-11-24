import { expect, test } from 'vitest';
import { resolveGrams, scaleNutrients } from '../../src/lib/server/nutrition/amounts';

test.each([
  ['grams', 2],
  ['kilograms', 2000],
  ['milliliters', 1.6],
  ['deciliters', 160],
  ['tablespoons', 24],
  ['teaspoons', 8],
  ['cups', 384]
])('converts two %s to grams', (unit, grams) => {
  expect(resolveGrams(2, unit, { densityGPerMl: 0.8 })).toBeCloseTo(grams);
});

test('uses the user default portion and supports named portions', () => {
  const portions = [
    { label: 'Bowl', unit: 'portion', grams: 300, isDefault: true, source: 'catalog' },
    { label: 'My bowl', unit: 'portion', grams: 250, isDefault: true, source: 'user' }
  ];
  expect(resolveGrams(1.5, 'servings', { portions })).toBe(375);
  expect(resolveGrams(1, 'Bowl', { portions })).toBe(300);
});

test('requires a specific portion or density for volume and preserves missing nutrient values', () => {
  expect(resolveGrams(1, 'ml')).toBeNull();
  expect(resolveGrams(-1, 'g')).toBeNull();
  expect(scaleNutrients({ energy_kcal: 120, protein_g: null, fat_g: 0 }, 250)).toEqual({
    energy_kcal: 300,
    protein_g: null,
    fat_g: 0
  });
});
