import { expect, test } from 'vitest';
import { resolveFoodAmount } from '../../src/lib/server/agent/resolve';
import { lookupPortionUnit } from '../../src/lib/server/nutrition/amounts';

const food = {
  sourceId: 'slv',
  sourceFoodId: '1953',
  name: 'Vatten kranvatten',
  kind: 'generic',
  category: null,
  components: [],
  portions: [],
  densityGPerMl: null
} as const satisfies Parameters<typeof resolveFoodAmount>[0];

function storedPortion(unit: string, grams: number, source = 'agent', isDefault = false) {
  return { id: unit, foodId: 'food', unit, grams, source, isDefault, label: unit, sourceUrl: null };
}

test('a learned glass is reused by its aliases and does not supply a default serving', () => {
  expect(resolveFoodAmount(food, 1, 'glass').grams).toBeNull();
  const learned = { ...food, portions: [storedPortion('glass', 225)] };
  expect(resolveFoodAmount(learned, 2, 'glas')).toEqual({
    grams: 450,
    reason: 'Estimated weight: 225 g per glass.'
  });
  expect(resolveFoodAmount(learned, 1, 'serving').grams).toBeNull();
  expect(resolveFoodAmount(learned, 200, 'ml').grams).toBeNull();
  expect(resolveFoodAmount(learned, 175, 'g').grams).toBe(175);
});

test('a learned metric conversion uses the requested volume and yields to catalog density', () => {
  const learned = { ...food, portions: [storedPortion('ml', 0.9)] };
  expect(resolveFoodAmount(learned, 2, 'dl').grams).toBe(180);
  expect(resolveFoodAmount({ ...learned, densityGPerMl: 1 }, 2, 'dl')).toMatchObject({
    grams: 200
  });
  const personal = { ...learned, densityGPerMl: 1, portions: [storedPortion('ml', 1.1, 'user')] };
  expect(resolveFoodAmount(personal, 2, 'dl').grams).toBeCloseTo(220);
  expect(lookupPortionUnit('dl')).toBe('ml');
  expect(lookupPortionUnit('l')).toBe('ml');
  expect(lookupPortionUnit('g')).toBeUndefined();
});

test('user and catalog portions override a learned conversion for the same unit', () => {
  const learned = storedPortion('glass', 225);
  const catalog = storedPortion('glass', 245, 'fdc');
  const personal = storedPortion('glass', 175, 'user');
  expect(resolveFoodAmount({ ...food, portions: [learned, catalog] }, 1, 'glass').grams).toBe(245);
  expect(
    resolveFoodAmount({ ...food, portions: [learned, catalog, personal] }, 1, 'glass').grams
  ).toBe(175);
});
