import type { NutrientId } from '../nutrition-reference';
import type { IntakeReference } from '../server/nutrition/references/types';
import type { Day } from './types';

type DailyIntake = Pick<Day, 'totals' | 'coverage' | 'estimatedTotals' | 'intake'>;

export function dailyNutrient(day: DailyIntake, id: NutrientId) {
  const known = day.coverage.knownItems[id] ?? 0;
  return {
    amount: day.totals[id] ?? null,
    known,
    partial: known > 0 && known < day.coverage.items,
    estimated: day.estimatedTotals[id] !== undefined,
    reference: day.intake.targets[id]
  };
}

export function isIntakeLimit(
  reference: IntakeReference
): reference is { kind: 'limit' | 'below'; amount: number } {
  return reference.kind === 'limit' || reference.kind === 'below';
}

export function intakeFraction(amount: number, reference: IntakeReference) {
  const scale = reference.kind === 'range' ? reference.max : reference.amount;
  return scale > 0 ? amount / scale : null;
}

export function intakePercent(fraction: number, locale: string) {
  // Keep anything below the target visibly below 100%, even after rounding.
  return new Intl.NumberFormat(locale, { style: 'percent' }).format(
    fraction < 1 ? Math.min(fraction, 0.99) : fraction
  );
}

export function intakeComparison(
  amount: number,
  reference: IntakeReference,
  locale: string,
  partial: boolean
) {
  if (reference.kind === 'range') {
    if (amount > reference.max) return 'Above range';
    if (amount >= reference.min) return partial ? 'Within range so far' : 'In range';
    return partial ? 'Below range so far' : 'Below range';
  }
  const fraction = intakeFraction(amount, reference);
  if (fraction === null) return '';
  if (isIntakeLimit(reference)) {
    const status = fraction > 1 ? 'Over limit · ' : fraction === 1 ? 'At limit · ' : '';
    return `${status}${intakePercent(fraction, locale)} of limit`;
  }
  const suffix = reference.kind === 'estimate' ? 'of estimate' : 'of target';
  return `${intakePercent(fraction, locale)} ${suffix}`;
}
