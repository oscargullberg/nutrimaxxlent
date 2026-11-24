import { nnr2023 } from './nnr-2023.ts';
import type { IntakeReferenceSource, IntakeReferences } from './types.ts';

const sources = new Map([nnr2023].map((source) => [source.id, source]));

type PersonalGoals = {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
};

export function dailyIntakeReferences(
  goals: PersonalGoals | null,
  sourceId = process.env.NUTRITION_REFERENCE_SOURCE?.trim() || nnr2023.id
) {
  const source = sources.get(sourceId);
  if (!source) throw new Error(`Unknown NUTRITION_REFERENCE_SOURCE: ${sourceId}`);
  const { values, ...metadata }: IntakeReferenceSource = source;
  const plannedKcal = goals?.kcal && goals.kcal > 0 ? goals.kcal : null;
  const published = values(plannedKcal);
  const personal: IntakeReferences = {};
  const overrides = {
    energy_kcal: goals?.kcal,
    protein_g: goals?.proteinG,
    carbs_g: goals?.carbsG,
    fat_g: goals?.fatG,
    fiber_g: goals?.fiberG
  } as const;
  for (const id of Object.keys(overrides) as (keyof typeof overrides)[]) {
    const amount = overrides[id];
    if (amount != null) personal[id] = { kind: 'personal', amount };
  }

  return { source: metadata, published, targets: { ...published, ...personal } };
}
