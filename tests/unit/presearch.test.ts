import { expect, test, vi } from 'vitest';
import { preSearch } from '../../src/lib/server/agent/presearch';
import type { Database } from '../../src/lib/server/db/client';

vi.mock('../../src/lib/server/services/catalog', () => ({
  searchFoods: () => Promise.resolve([])
}));
vi.mock('../../src/lib/server/services/recipes', () => ({
  searchRecipes: () => Promise.resolve([])
}));

test('strips supported measurements from catalog queries while retaining the original amounts', async () => {
  const matches = await preSearch(
    {} as Database,
    '3x omega 3 elixir tabs\n5x saffransgifflar\ncoke vanilla 50cl\n1 1/2 cups of flour\nsyrup 2 fl. oz.\n2 hg cheese'
  );
  expect(matches.map(({ query }) => query)).toEqual([
    'omega 3 elixir',
    'saffransgifflar',
    'coke vanilla',
    'flour',
    'syrup',
    'cheese'
  ]);
  expect(matches[2]?.mention).toBe('coke vanilla 50cl');
});
