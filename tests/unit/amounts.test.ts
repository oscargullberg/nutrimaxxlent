import { expect, test } from 'vitest';
import {
  convertMeasurement,
  resolveGrams,
  scaleNutrients
} from '../../src/lib/server/nutrition/amounts';

test.each([
  [1, 'pound', 'ounces', 16],
  [2, 'hg', 'kg', 0.2],
  [500, 'mcg', 'milligrams', 0.5],
  [50, 'cL', 'litres', 0.5],
  [2, 'fl. oz.', 'ml', 59.147059125],
  [1, 'cup', 'tablespoons', 16],
  [1, 'msk', 'tsk', 3],
  [3, 'tablet', 'pieces', 3]
])('converts %s %s to %s', (quantity, from, to, expected) => {
  expect(convertMeasurement(quantity, from, to)).toBeCloseTo(expected);
});

test('requires food-specific evidence across dimensions and rejects overflow', () => {
  expect(convertMeasurement(1, 'oz', 'fl oz')).toBeNull();
  expect(convertMeasurement(1, 'cup', 'pieces')).toBeNull();
  expect(convertMeasurement(Number.MAX_VALUE, 'kg', 'g')).toBeNull();
  expect(resolveGrams(3, 'capsules')).toBeNull();
  expect(resolveGrams(1, 'bottle', { densityGPerMl: 1 })).toBeNull();
});

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
