import { expect, test } from 'vitest';
import { classifySlvLeaf } from '../../src/lib/server/importers/slv-dietary';
import {
  adjustedCatalogDietary,
  sumDietary,
  unknownDietary,
  withNova
} from '../../src/lib/server/nutrition/dietary';

test('counts the dry oats and lets cured pork contribute to both meat totals', () => {
  const oats = classifySlvLeaf(
    'Havregryn fullkorn',
    [
      { fasett: 'A Gruppindelning', namn: 'Ris eller annat spannmål' },
      { fasett: 'C Del', namn: 'Hela frön, fullkorn, gryn, bönor' },
      { fasett: 'H Process', namn: 'Ingen industriell process tillämpad' }
    ],
    200,
    35
  );
  const bacon = classifySlvLeaf(
    'Gris bacon rå',
    [
      { fasett: 'A Gruppindelning', namn: 'Konserverat kött' },
      { fasett: 'B Art', namn: 'Gris' }
    ],
    50,
    75
  );
  expect(oats).toMatchObject({ groups: { wholeGrains: { grams: 35 } }, novaGrams: { 1: 200 } });
  expect(sumDietary([oats, bacon, unknownDietary(30)])).toMatchObject({
    groups: {
      wholeGrains: { grams: 35, partial: true },
      redMeat: { grams: 50, partial: true },
      processedMeat: { grams: 50, partial: true }
    },
    unknownNovaG: 80
  });
});

test('removing a nested component excludes all its ingredients and keeps the added product NOVA', () => {
  const veg = classifySlvLeaf(
    'Broccoli',
    [{ fasett: 'A Gruppindelning', namn: 'Grönsaker och svamp' }],
    100,
    100
  );
  const product = withNova(unknownDietary(100), 100, 4, 'Open Food Facts');
  const result = adjustedCatalogDietary(
    {
      dietaryComponents: {
        cookedGrams: 200,
        useComponentNova: true,
        leaves: [
          { sortOrder: 1, dietary: product },
          { sortOrder: 2, dietary: veg }
        ]
      }
    },
    100,
    [
      { id: 'sauce', depth: 0, sortOrder: 0 },
      { id: 'sauce ingredient', depth: 1, sortOrder: 1 },
      { id: 'veg', depth: 0, sortOrder: 2 }
    ],
    new Set(['sauce']),
    [{ grams: 30, dietary: product }],
    80
  );
  expect(result).toMatchObject({
    groups: { vegetables: { grams: 50, partial: true } },
    novaGrams: { 4: 30 },
    unknownNovaG: 50
  });
});
