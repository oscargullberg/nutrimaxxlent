import {
  agentPortionSource,
  householdPortionUnits,
  standardUnits,
  type NutrientId
} from '../../nutrition-reference.ts';

export type NutrientAmounts = Partial<Record<NutrientId, number | null>>;
export type Portion = {
  label: string;
  unit: string;
  grams: number;
  isDefault: boolean;
  source?: string;
};
export const researchedPortionSource = 'web';

export function isLearnedPortion(source?: string) {
  return source === agentPortionSource || source === researchedPortionSource;
}

const unitAliases: Readonly<Record<string, string>> = {
  grams: 'g',
  gram: 'g',
  kilograms: 'kg',
  kilogram: 'kg',
  milliliters: 'ml',
  millilitres: 'ml',
  milliliter: 'ml',
  millilitre: 'ml',
  deciliters: 'dl',
  decilitres: 'dl',
  deciliter: 'dl',
  decilitre: 'dl',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  msk: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsk: 'tsp',
  cups: 'cup',
  glas: 'glass',
  glasses: 'glass',
  slices: 'slice',
  skiva: 'slice',
  skivor: 'slice',
  bowls: 'bowl',
  skål: 'bowl',
  skålar: 'bowl',
  mugs: 'mug',
  mugg: 'mug',
  bottles: 'bottle',
  flaska: 'bottle',
  cans: 'can',
  burk: 'can',
  scoops: 'scoop',
  skopa: 'scoop',
  handfuls: 'handful',
  näve: 'handful',
  portions: 'portion',
  serving: 'portion',
  servings: 'portion',
  portioner: 'portion',
  stycken: 'st',
  styck: 'st',
  capsule: 'st',
  capsules: 'st',
  kapsel: 'st',
  kapslar: 'st',
  tablet: 'st',
  tablets: 'st',
  tablett: 'st',
  tabletter: 'st',
  tab: 'st',
  tabs: 'st',
  pieces: 'st',
  piece: 'st'
};

export function normalizeUnit(unit: string) {
  const key = unit.trim().toLowerCase().replace(/\.$/, '');
  return Object.hasOwn(unitAliases, key) ? unitAliases[key]! : key;
}

const metricVolumeUnits = new Set(['ml', 'dl', 'l']);

export function lookupPortionUnit(unit: string) {
  const key = normalizeUnit(unit);
  if (metricVolumeUnits.has(key)) return 'ml';
  if (Object.hasOwn(householdPortionUnits, key)) return key;
  return standardUnits.find(
    (candidate) => candidate.unit === key && candidate.dimension === 'volume'
  )?.unit;
}

export function matchingPortion<T extends Portion>(unit: string, portions: readonly T[]) {
  const key = normalizeUnit(unit);
  const matching = portions.filter((portion) =>
    key === 'portion'
      ? portion.isDefault
      : normalizeUnit(portion.unit) === key || normalizeUnit(portion.label) === key
  );
  const local = matching.filter(({ source }) => !isLearnedPortion(source));
  const researched =
    matching.find((row) => isLearnedPortion(row.source) && normalizeUnit(row.unit) === key) ??
    matching.find(({ source }) => isLearnedPortion(source));
  const userServing =
    key === 'st' && researched?.isDefault
      ? portions.find(({ source, isDefault }) => source === 'user' && isDefault)
      : undefined;
  return (
    local.find(({ source }) => source === 'user') ??
    local.find(({ isDefault }) => isDefault) ??
    (local.length === 1 ? local[0] : undefined) ??
    userServing ??
    researched
  );
}

export function resolveMeasuredAmount<T extends Portion>(
  quantity: number,
  unit: string,
  food: { densityGPerMl?: number | null; portions?: readonly T[] } = {}
): { grams: number | null; portion?: T } {
  if (!Number.isFinite(quantity) || quantity <= 0) return { grams: null };
  const key = normalizeUnit(unit);
  const standard = standardUnits.find((candidate) => candidate.unit === key);
  if (standard?.dimension === 'mass') return { grams: quantity * standard.factorToBase };

  const portion = matchingPortion(key, food.portions ?? []);
  const milliliter =
    key !== 'ml' && standard && metricVolumeUnits.has(key)
      ? matchingPortion('ml', food.portions ?? [])
      : undefined;
  if (standard && milliliter?.source === 'user' && milliliter.grams > 0)
    return { grams: quantity * standard.factorToBase * milliliter.grams, portion: milliliter };
  if (portion && portion.grams > 0 && !isLearnedPortion(portion.source))
    return { grams: quantity * portion.grams, portion };

  const density = food.densityGPerMl;
  if (standard?.dimension === 'volume' && density && Number.isFinite(density) && density > 0) {
    return { grams: quantity * standard.factorToBase * density };
  }
  if (portion && portion.grams > 0) return { grams: quantity * portion.grams, portion };
  if (standard && milliliter && milliliter.grams > 0)
    return { grams: quantity * standard.factorToBase * milliliter.grams, portion: milliliter };
  return { grams: null };
}

export function resolveGrams(
  quantity: number,
  unit: string,
  food: { densityGPerMl?: number | null; portions?: readonly Portion[] } = {}
) {
  return resolveMeasuredAmount(quantity, unit, food).grams;
}

export function scaleNutrients(per100g: NutrientAmounts, grams: number): NutrientAmounts {
  if (!Number.isFinite(grams) || grams < 0)
    throw new RangeError('Grams must be finite and nonnegative.');
  return Object.fromEntries(
    Object.entries(per100g).map(([id, amount]) => [
      id,
      amount === null ? null : amount * (grams / 100)
    ])
  );
}
