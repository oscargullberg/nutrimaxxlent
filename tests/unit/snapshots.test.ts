import { expect, test } from 'vitest';
import { aggregateDaily, createNutrientSnapshots } from '../../src/lib/server/nutrition/snapshots';

test('a catalog item can mix declared nutrients and estimates', () => {
  expect(
    createNutrientSnapshots({ protein_g: 20, magnesium_mg: 40 }, false, ['magnesium_mg'])
  ).toEqual([
    { nutrientId: 'protein_g', amount: 20, unit: 'g', isEstimate: false },
    { nutrientId: 'magnesium_mg', amount: 40, unit: 'mg', isEstimate: true }
  ]);
});

test('captures numeric and explicitly missing nutrients with their canonical units', () => {
  expect(createNutrientSnapshots({ energy_kcal: 0, protein_g: null }, true)).toEqual([
    { nutrientId: 'energy_kcal', amount: 0, unit: 'kcal', isEstimate: true },
    { nutrientId: 'protein_g', amount: null, unit: 'g', isEstimate: true }
  ]);
});

test('groups active snapshots using the profile day across the daylight-saving transition', () => {
  const entries = [
    {
      loggedAt: new Date('2026-03-28T22:59:59Z'),
      meal: 'dinner',
      status: 'active',
      snapshots: createNutrientSnapshots({ energy_kcal: 10 }, false)
    },
    {
      loggedAt: new Date('2026-03-28T23:00:00Z'),
      meal: 'breakfast',
      status: 'active',
      snapshots: createNutrientSnapshots({ energy_kcal: 100, protein_g: null }, false)
    },
    {
      loggedAt: new Date('2026-03-29T21:59:59Z'),
      meal: 'dinner',
      status: 'active',
      snapshots: createNutrientSnapshots({ energy_kcal: 200, fiber_g: null }, false)
    },
    {
      loggedAt: new Date('2026-03-29T22:00:00Z'),
      meal: 'dinner',
      status: 'active',
      snapshots: createNutrientSnapshots({ energy_kcal: 20 }, false)
    },
    {
      loggedAt: new Date('2026-03-29T10:00:00Z'),
      meal: 'breakfast',
      status: 'undone',
      snapshots: createNutrientSnapshots({ energy_kcal: 40 }, false)
    }
  ] as const;
  const day = aggregateDaily(entries, '2026-03-29', 'Europe/Stockholm');
  expect(day.totals).toEqual({ energy_kcal: 300, protein_g: null, fiber_g: null });
  expect(day.meals.breakfast?.totals).toEqual({ energy_kcal: 100, protein_g: null });
  expect(day.meals.dinner?.entries).toHaveLength(1);
});
