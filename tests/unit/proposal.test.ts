import { expect, test } from 'vitest';
import { validateProposal, type ProposalCatalog } from '../../src/lib/server/agent/proposal';

const id = 'f7594e40-5df5-4705-b918-5bcac4105ad4';
const unknown = 'f9dc4c1a-11de-428b-a0fb-c164605f1fa6';
const catalog: ProposalCatalog = {
  foodUnits: (food) => Promise.resolve(food === id ? ['bowl'] : null),
  foodComponents: (food) => Promise.resolve(food === id ? ['bacon-id'] : null),
  recipeIngredients: () => Promise.resolve(null)
};
const meal = { reply: 'Logged', needsClarification: false };
const food = { kind: 'food', foodId: id, quantity: 1, unit: 'bowl', confidence: 0.95 };

test('accepts a valid catalog portion', async () => {
  await expect(validateProposal({ ...meal, items: [food] }, catalog)).resolves.toMatchObject({
    items: [food]
  });
});

test('accepts a meal with tablets, pieces, and centiliters', async () => {
  const items = [
    { ...food, quantity: 3, unit: 'tabs' },
    { ...food, quantity: 5, unit: 'pieces' },
    { ...food, quantity: 50, unit: 'cl' }
  ];
  await expect(validateProposal({ ...meal, items }, catalog)).resolves.toMatchObject({ items });
});

test('keeps a valid meal title and ignores an invalid name without rejecting the meal', async () => {
  const input = { ...meal, items: [food] };
  const title = 'Curry with rice and minced meat';
  await expect(validateProposal({ ...input, title: ` ${title} ` }, catalog)).resolves.toMatchObject(
    {
      title
    }
  );
  await expect(validateProposal({ ...input, title: 'Rice\nBeef' }, catalog)).resolves.toMatchObject(
    {
      title: undefined,
      items: [food]
    }
  );
});

test.each([
  { ...food, foodId: unknown },
  { ...food, unit: 'wrong-unit' },
  { ...food, quantity: -1 },
  {
    kind: 'dish_adjustment',
    foodId: id,
    grams: 100,
    confidence: 0.95,
    adjustments: [{ kind: 'substitute', component: 'bacon-id' }]
  },
  {
    kind: 'dish_adjustment',
    foodId: id,
    grams: 100,
    confidence: 0.95,
    adjustments: [{ kind: 'remove', component: 'wrong-id' }]
  }
])('rejects an invalid proposed item %#', async (item) => {
  await expect(validateProposal({ ...meal, items: [item] }, catalog)).rejects.toMatchObject({
    code: 'INVALID_PROPOSAL'
  });
});
