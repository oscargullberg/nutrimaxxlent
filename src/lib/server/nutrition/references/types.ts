import type { NutrientId } from '../../../nutrition-reference.ts';

export type IntakeReference =
  | { kind: 'range'; min: number; max: number }
  | {
      kind: 'personal' | 'estimate' | 'recommended' | 'adequate' | 'minimum' | 'limit' | 'below';
      amount: number;
    };

export type IntakeReferences = Partial<Record<NutrientId, IntakeReference>>;

export type IntakeReferenceSource = {
  id: string;
  name: string;
  revision: string;
  population: string;
  url: string;
  guidance?: Partial<Record<NutrientId, string>>;
  values: (plannedKcal: number | null) => IntakeReferences;
};
