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
  hektogram: 'hg',
  hectogram: 'hg',
  hectograms: 'hg',
  milligram: 'mg',
  milligrams: 'mg',
  μg: 'µg',
  ug: 'µg',
  mcg: 'µg',
  microgram: 'µg',
  micrograms: 'µg',
  mikrogram: 'µg',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ounce: 'oz',
  ounces: 'oz',
  milliliters: 'ml',
  millilitres: 'ml',
  milliliter: 'ml',
  millilitre: 'ml',
  centiliters: 'cl',
  centilitres: 'cl',
  centiliter: 'cl',
  centilitre: 'cl',
  deciliters: 'dl',
  decilitres: 'dl',
  deciliter: 'dl',
  decilitre: 'dl',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  floz: 'fl oz',
  'fl. oz': 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
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
  pc: 'st',
  pcs: 'st',
  x: 'st',
  '×': 'st',
  pieces: 'st',
  piece: 'st'
};

export function normalizeUnit(unit: string) {
  const key = unit.trim().toLowerCase().replace(/\s+/gu, ' ').replace(/\.$/u, '');
  return Object.hasOwn(unitAliases, key) ? unitAliases[key]! : key;
}

const standardByUnit = new Map<string, (typeof standardUnits)[number]>(
  standardUnits.map((definition) => [definition.unit, definition])
);
const householdVolumeUnits = new Set(['tbsp', 'tsp', 'cup']);

export const standardUnitNames = [
  ...standardByUnit.keys(),
  ...Object.keys(unitAliases).filter((unit) => standardByUnit.has(unitAliases[unit]!))
];

function positiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && value > 0 && Number.isFinite(value);
}

export function convertMeasurement(quantity: number, from: string, to: string) {
  if (!positiveFinite(quantity)) return null;
  const source = normalizeUnit(from);
  const target = normalizeUnit(to);
  if (source === target) return quantity;
  const sourceUnit = standardByUnit.get(source);
  const targetUnit = standardByUnit.get(target);
  if (!sourceUnit || !targetUnit || sourceUnit.dimension !== targetUnit.dimension) return null;
  const converted = quantity * (sourceUnit.factorToBase / targetUnit.factorToBase);
  return positiveFinite(converted) ? converted : null;
}

export function lookupPortionUnit(unit: string) {
  const key = normalizeUnit(unit);
  if (Object.hasOwn(householdPortionUnits, key) || householdVolumeUnits.has(key)) return key;
  return standardByUnit.get(key)?.dimension === 'volume' ? 'ml' : undefined;
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
  if (!positiveFinite(quantity)) return { grams: null };
  const key = normalizeUnit(unit);
  const standard = standardByUnit.get(key);
  if (standard?.dimension === 'mass') return { grams: convertMeasurement(quantity, key, 'g') };

  const portions = food.portions?.filter(({ grams }) => positiveFinite(grams)) ?? [];
  const portion = matchingPortion(key, portions);
  const exactGrams = portion && quantity * portion.grams;
  const exact = positiveFinite(exactGrams) ? { grams: exactGrams, portion } : undefined;
  if (!standard || exact?.portion?.source === 'user') return exact ?? { grams: null };

  const volume = convertMeasurement(quantity, key, 'ml');
  if (volume === null) return exact ?? { grams: null };
  const otherWeights = standardUnits.flatMap((definition) => {
    if (definition.dimension !== 'volume' || definition.unit === key) return [];
    const equivalent = matchingPortion(
      definition.unit,
      portions.filter((row) => normalizeUnit(row.unit) === definition.unit)
    );
    if (!equivalent) return [];
    const grams = (volume / definition.factorToBase) * equivalent.grams;
    return positiveFinite(grams) ? [{ grams, portion: equivalent }] : [];
  });
  const personal = otherWeights.find(({ portion }) => portion.source === 'user');
  if (personal) return personal;
  if (exact && !isLearnedPortion(exact.portion?.source)) return exact;

  const density = food.densityGPerMl;
  const densityGrams = positiveFinite(density) ? volume * density : null;
  if (positiveFinite(densityGrams)) return { grams: densityGrams };
  return (
    otherWeights.find(({ portion }) => !isLearnedPortion(portion.source)) ??
    exact ??
    otherWeights[0] ?? { grams: null }
  );
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
