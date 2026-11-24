import { normalizeSearch } from './source.ts';

const spellingAliases: Readonly<Record<string, readonly string[]>> = {
  barebells: ['barbell', 'barbells', 'barbell bar', 'barebells bar', 'barebells proteinbar'],
  njie: ['njie', 'njie protein'],
  arla: ['arla'],
  nocco: ['nocco']
};

export function brandAliases(brands: string | null | undefined) {
  return (brands ?? '').split(',').flatMap((brand) => {
    const key = normalizeSearch(brand);
    return Object.hasOwn(spellingAliases, key)
      ? (spellingAliases[key] ?? []).map((alias) => ({ alias }))
      : [];
  });
}
