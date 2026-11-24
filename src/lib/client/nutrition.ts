import type { NutrientId } from '../nutrition-reference';
import type { IntakeReference } from '../server/nutrition/references/types';

export const coreNutrients = [
  { id: 'energy_kcal', label: 'Energy', unit: 'kcal' },
  { id: 'protein_g', label: 'Protein', unit: 'g' },
  { id: 'carbs_g', label: 'Carbs', unit: 'g' },
  { id: 'fat_g', label: 'Fat', unit: 'g' },
  { id: 'fiber_g', label: 'Fiber', unit: 'g' }
] as const;

export function nutrientLabel(id: NutrientId, name: string) {
  return coreNutrients.find((nutrient) => nutrient.id === id)?.label ?? name;
}

export function nutrientFormatter(locale?: string, lowerBound = false) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    maximumSignificantDigits: 2,
    roundingPriority: 'morePrecision',
    roundingMode: lowerBound ? 'floor' : 'halfExpand'
  });
}

export function loggedNutrient(
  amount: number | null | undefined,
  unit: string,
  number: Intl.NumberFormat
) {
  return amount == null ? 'No data' : `${number.format(amount)} ${unit}`;
}

const referenceLabels = {
  personal: 'Personal goal',
  estimate: 'Estimated energy need',
  recommended: 'Recommended intake',
  adequate: 'Adequate intake',
  minimum: 'Daily target',
  limit: 'Daily limit',
  below: 'Daily limit',
  range: 'Recommended range'
};

export function intakeReferenceLabel(reference: IntakeReference) {
  return referenceLabels[reference.kind];
}

export function intakeReferenceValue(
  reference: IntakeReference,
  unit: string,
  format: Intl.NumberFormat
) {
  if (reference.kind === 'range') {
    return `${format.format(reference.min)}–${format.format(reference.max)} ${unit}`;
  }
  return `${format.format(reference.amount)} ${unit}`;
}

export function dietaryGroupValue(
  amount: { grams: number; partial?: true } | undefined,
  groupsKnown: boolean | undefined,
  number: Intl.NumberFormat,
  lowerBound: Intl.NumberFormat = number
) {
  if (!amount) return groupsKnown ? 'None' : 'Not classified';
  if (amount.partial) {
    return amount.grams > 0 ? `${lowerBound.format(amount.grams)} g` : 'Not classified';
  }
  return amount.grams > 0 ? `${number.format(amount.grams)} g` : 'None';
}

export function novaValue(
  grams: number,
  unknownGrams: number,
  number: Intl.NumberFormat,
  lowerBound: Intl.NumberFormat = number
) {
  if (unknownGrams > 0) {
    return grams > 0 ? `${lowerBound.format(grams)} g` : 'Not classified';
  }
  return grams > 0 ? `${number.format(grams)} g` : 'None';
}
