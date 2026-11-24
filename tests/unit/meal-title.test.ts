import { expect, test } from 'vitest';
import { generatedMealTitle, mealTitle } from '../../src/lib/meal-title';

test('uses the meal category when several different foods have no natural title', () => {
  expect(
    mealTitle(
      [
        { label: 'Påläggskorv salami rökt', nameEn: 'Salami sausage smoked 34-44% fat', grams: 6 },
        { label: 'Äpple m. skal', nameEn: 'Apple w/ skin', grams: 150 },
        {
          label: 'Hårt bröd fullkorn råg fibrer ca 14% typ normalgräddat',
          nameEn: 'Crisp bread wholegrain rye app. 14% fibre e.g. Normalgräddat',
          grams: 24
        },
        { label: 'Smör fett 80%', nameEn: 'Butter 80% fat', grams: 8 },
        { label: 'Kaffe bryggt', nameEn: 'Coffee brewed', grams: 120 },
        { label: 'Ost hårdost fett 28%', nameEn: 'Cheese hard 28% fat', grams: 20 }
      ],
      'Breakfast'
    )
  ).toBe('Breakfast');
});

test('combines repeated foods and falls back to original names', () => {
  expect(
    mealTitle([
      { label: 'Äpple m. skal', grams: 40 },
      { label: 'Äpple', grams: 40 }
    ])
  ).toBe('Äpple');
  expect(mealTitle([{ label: 'Pasta with black olives and sun-dried tomatoes' }])).toBe(
    'Pasta with black olives and sun-dried tomatoes'
  );
});

test('uses everyday ingredient names for verbose catalog labels', () => {
  expect(mealTitle([{ label: 'Large yakiniku beef and rice bowl' }])).toBe('Yakiniku');
  expect(mealTitle([{ label: 'Blandfärs stekt m. salt' }])).toBe('Minced meat');
  expect(generatedMealTitle('### McD meal')).toBe('McD meal');
  expect(
    generatedMealTitle('Large yakiniku beef and rice…, Fast Foods, crispy chicken…')
  ).toBeUndefined();
});
