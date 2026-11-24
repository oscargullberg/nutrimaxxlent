import type { NutrientAmounts } from './amounts.ts';
import { canonicalNutrients, type NutrientId } from '../../nutrition-reference.ts';

export type NutrientSnapshot = {
  nutrientId: NutrientId;
  amount: number | null;
  unit: string;
  isEstimate: boolean;
};

export function createNutrientSnapshots(
  amounts: NutrientAmounts,
  isEstimate: boolean,
  estimatedNutrients: readonly NutrientId[] = []
) {
  return canonicalNutrients.flatMap(({ id, unit }) => {
    const amount = amounts[id];
    return amount === undefined
      ? []
      : [
          {
            nutrientId: id,
            amount,
            unit,
            isEstimate: isEstimate || estimatedNutrients.includes(id)
          }
        ];
  });
}

type DailyEntry = {
  loggedAt: Date;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
  status: 'active' | 'undone' | 'deleted';
  snapshots: readonly NutrientSnapshot[];
};

function dayFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

export function localDate(instant: Date, timeZone: string) {
  return dayFormatter(timeZone).format(instant);
}

function addSnapshot(totals: NutrientAmounts, snapshot: NutrientSnapshot) {
  const current = totals[snapshot.nutrientId];
  totals[snapshot.nutrientId] =
    snapshot.amount === null ? (current ?? null) : (current ?? 0) + snapshot.amount;
}

export function aggregateDaily<T extends DailyEntry>(
  entries: readonly T[],
  date: string,
  timeZone: string
) {
  const formatter = dayFormatter(timeZone);
  const totals: NutrientAmounts = {};
  const meals: Partial<Record<DailyEntry['meal'], { entries: T[]; totals: NutrientAmounts }>> = {};
  for (const entry of entries) {
    if (entry.status !== 'active' || formatter.format(entry.loggedAt) !== date) continue;
    const group = (meals[entry.meal] ??= { entries: [], totals: {} });
    group.entries.push(entry);
    for (const snapshot of entry.snapshots) {
      addSnapshot(group.totals, snapshot);
      addSnapshot(totals, snapshot);
    }
  }
  return { date, totals, meals };
}
