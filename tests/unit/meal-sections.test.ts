import { expect, test } from 'vitest';
import { mealSections } from '../../src/lib/meal-sections.ts';

test('preserves the three meals from a single message with mixed heading styles', () => {
  expect(
    mealSections(
      'Mcd dinner:\nchicken supreme burger\nmcwrap chili chicken\ndouble cheese\n\nbreakfast\nmaybe..100g mixed mince\n\nlunch\nbig yakiniku bowl'
    )
  ).toEqual([
    {
      meal: 'dinner',
      title: 'McD meal',
      text: 'chicken supreme burger\nmcwrap chili chicken\ndouble cheese'
    },
    { meal: 'breakfast', text: 'maybe..100g mixed mince' },
    { meal: 'lunch', text: 'big yakiniku bowl' }
  ]);
});

test('recognizes Swedish meal headings and explicitly named groups', () => {
  expect(mealSections('## Frukost: gröt\n\nYakiniku: beef and rice')).toEqual([
    { meal: 'breakfast', text: 'gröt' },
    { title: 'Yakiniku', text: 'beef and rice' }
  ]);
  expect(mealSections('An apple till mellanmål')).toEqual([
    { meal: 'snack', text: 'An apple till mellanmål' }
  ]);
});

test('keeps plain food descriptions and label data in one meal', () => {
  const text = 'Breakfast sausage, half pack\n\nProtein: 18 g\n\nIngredients: pork, salt';
  expect(mealSections(text)).toEqual([{ text }]);
});

test('uses explicit meal headings in a semicolon-separated line', () => {
  expect(mealSections('Breakfast: eggs; Lunch: chili; Dinner: soup')).toEqual([
    { meal: 'breakfast', text: 'eggs' },
    { meal: 'lunch', text: 'chili' },
    { meal: 'dinner', text: 'soup' }
  ]);
});
