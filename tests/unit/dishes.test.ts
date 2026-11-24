import { expect, test } from 'vitest';
import { adjustDish } from '../../src/lib/server/nutrition/dishes';

const dish = {
  per100g: { energy_kcal: 150, protein_g: 12 },
  cookedGrams: 1000,
  components: [{ id: 'pancetta', cookedGrams: 200, per100g: { energy_kcal: 400, protein_g: 15 } }]
};
const peas = { grams: 50, per100g: { energy_kcal: 80, protein_g: 5 } };

test('adds a weighed catalog food to the published dish values', () => {
  expect(adjustDish(dish, 250, [{ kind: 'add', food: peas }])).toMatchObject({
    grams: 300,
    nutrients: { energy_kcal: 415, protein_g: 32.5 }
  });
});
test('subtracts the component weight proportional to the logged portion', () => {
  expect(adjustDish(dish, 250, [{ kind: 'remove', componentId: 'pancetta' }])).toMatchObject({
    grams: 200,
    nutrients: { energy_kcal: 175, protein_g: 22.5 }
  });
});
test('replaces a component using the published nutrients as the baseline', () => {
  expect(
    adjustDish(dish, 250, [{ kind: 'substitute', componentId: 'pancetta', food: peas }])
  ).toMatchObject({
    grams: 250,
    nutrients: { energy_kcal: 215, protein_g: 25 }
  });
});
test('keeps the baseline and adds a note when component data is absent', () => {
  expect(adjustDish({ ...dish, components: [] }, 250, [{ kind: 'add', food: peas }])).toEqual({
    grams: 250,
    nutrients: { energy_kcal: 375, protein_g: 30 },
    notes: [expect.stringContaining('unavailable')]
  });
});
