import { expect, test } from 'vitest';
import { loggedNutrient, nutrientFormatter } from '../../src/lib/client/nutrition';
import { dailyNutrient, intakeComparison } from '../../src/lib/client/today-nutrition';
import { dailyIntakeReferences } from '../../src/lib/server/nutrition/references';

const day = {
  totals: { iron_mg: 0 },
  coverage: {
    items: 2,
    knownItems: { iron_mg: 1 }
  },
  estimatedTotals: {},
  intake: dailyIntakeReferences(null, 'nnr-2023')
};

test('distinguishes a recorded zero with partial coverage from an unknown amount', () => {
  const iron = dailyNutrient(day, 'iron_mg');
  const transFat = dailyNutrient(day, 'trans_fat_g');
  const format = nutrientFormatter('en');
  expect(iron).toMatchObject({ amount: 0, known: 1, partial: true });
  expect(loggedNutrient(iron.amount, 'mg', format)).toBe('0 mg');
  expect(transFat).toMatchObject({ amount: null, known: 0 });
  expect(loggedNutrient(transFat.amount, 'g', format)).toBe('No data');
});

test('describes intake limits and ranges differently from recommended amounts', () => {
  expect(intakeComparison(6.4, { kind: 'recommended', amount: 10 }, 'en', true)).toBe(
    '64% of target'
  );
  expect(intakeComparison(15, { kind: 'limit', amount: 10 }, 'en', true)).toBe(
    'Over limit · 150% of limit'
  );
  expect(intakeComparison(6, { kind: 'range', min: 4, max: 8 }, 'en', true)).toBe(
    'Within range so far'
  );
  expect(intakeComparison(9.99, { kind: 'minimum', amount: 10 }, 'en', false)).toBe(
    '99% of target'
  );
});
