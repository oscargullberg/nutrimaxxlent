import type { Database } from '../../src/lib/server/db/client.ts';
import { runImport, type SourceFood } from '../../src/lib/server/importers/source.ts';

const kcal = (amount: number) => ({ nutrientId: 'energy_kcal' as const, unit: 'kcal', amount });
const protein = (amount: number) => ({ nutrientId: 'protein_g' as const, unit: 'g', amount });
const products: SourceFood[] = [
  {
    id: 'fries',
    name: 'French fries',
    kind: 'generic',
    nutrients: [kcal(312)],
    portions: [
      { label: "1 kids' meal order", unit: 'kids order', grams: 70, isDefault: true },
      { label: '1 medium fast food order', unit: 'medium order', grams: 145, isDefault: false }
    ]
  },
  {
    id: 'dip',
    name: 'Chipotle dip',
    kind: 'generic',
    nutrients: [kcal(426)],
    portions: [{ label: '1 tablespoon', unit: 'tbsp', grams: 15, isDefault: true }]
  },

  {
    id: 'carbonara',
    name: 'Carbonara',
    nameEn: 'Carbonara',
    kind: 'dish',
    category: 'Main dish',
    nutrients: [kcal(180), protein(10)],
    components: [
      { foodId: 'pancetta', name: 'Pancetta', depth: 0, amountG: 200, rawAmountG: 220 },
      { foodId: 'pasta', name: 'Pasta', depth: 0, amountG: 800, rawAmountG: 800 }
    ]
  },
  { id: 'pancetta', name: 'Pancetta', kind: 'generic', nutrients: [kcal(400), protein(20)] },
  { id: 'pasta', name: 'Pasta', kind: 'generic', nutrients: [kcal(125), protein(6)] },
  { id: 'peas', name: 'Peas', kind: 'generic', nutrients: [kcal(80), protein(5)] },
  {
    id: 'rice',
    name: 'Cooked rice',
    kind: 'generic',
    nutrients: [kcal(120), protein(3)],
    classification: {
      dietary: {
        groups: { wholeGrains: { grams: 30 } },
        novaGrams: { 1: 100 },
        unknownNovaG: 0,
        novaSources: ['Test Catalog']
      }
    }
  },
  {
    id: 'bar-chocolate',
    name: 'Barebells Chocolate',
    brand: 'Barebells',
    kind: 'branded',
    barcode: '0000000000501',
    nutrients: [kcal(360), protein(36)],
    aliases: [{ alias: 'barbell bar' }],
    portions: [{ label: 'Bar', unit: 'portion', grams: 55, isDefault: true }]
  },
  {
    id: 'bar-vanilla',
    name: 'Barebells Vanilla',
    brand: 'Barebells',
    kind: 'branded',
    barcode: '0000000000502',
    nutrients: [kcal(410), protein(27)],
    aliases: [{ alias: 'barbell bar' }],
    portions: [{ label: 'Bar', unit: 'portion', grams: 55, isDefault: true }]
  }
];

export async function seedBrowserCatalog(db: Database) {
  return runImport(db, {
    source: {
      id: 'fixture',
      name: 'Test Catalog',
      license: 'CC0',
      attribution: 'Synthetic Playwright fixtures',
      homepage: 'https://example.test'
    },
    version: 'e2e-1',
    async *records() {
      await Promise.resolve();
      yield* products;
    }
  });
}
