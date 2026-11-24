import type { IntakeReferences, IntakeReferenceSource } from './types.ts';

export const nnr2023: IntakeReferenceSource = {
  id: 'nnr-2023',
  name: 'Nordic Nutrition Recommendations 2023',
  revision: 'February 2025 tables',
  population: 'Men ages 25–50',
  url: 'https://pub.norden.org/nord2023-003/recommendations.html',
  guidance: { trans_fat_g: 'Keep intake as low as possible.' },
  values(plannedKcal) {
    // Table 8: 11.3 MJ for the reference group at PAL 1.6.
    const estimatedKcal = 2700;
    const kcal = plannedKcal ?? estimatedKcal;
    const fromEnergy = (percent: number, kcalPerGram: number) =>
      (kcal * percent) / 100 / kcalPerGram;

    return {
      energy_kcal: { kind: 'estimate', amount: estimatedKcal },
      protein_g: { kind: 'recommended', amount: 62 },
      carbs_g: { kind: 'range', min: fromEnergy(45, 4), max: fromEnergy(60, 4) },
      fat_g: { kind: 'range', min: fromEnergy(25, 9), max: fromEnergy(40, 9) },
      fiber_g: { kind: 'minimum', amount: plannedKcal == null ? 35 : kcal * 0.004184 * 3 },
      saturated_fat_g: { kind: 'below', amount: fromEnergy(10, 9) },
      added_sugars_g: { kind: 'below', amount: fromEnergy(10, 4) },
      monounsaturated_fat_g: { kind: 'range', min: fromEnergy(10, 9), max: fromEnergy(20, 9) },
      polyunsaturated_fat_g: { kind: 'range', min: fromEnergy(5, 9), max: fromEnergy(10, 9) },
      omega3_ala_g: { kind: 'minimum', amount: fromEnergy(0.5, 9) },
      sodium_mg: { kind: 'limit', amount: 2300 },
      salt_g: { kind: 'limit', amount: 5.75 },
      // Tables 12–15 and 22. Compare only quantities with matching nutrient definitions.
      vitamin_d_ug: { kind: 'recommended', amount: 10 },
      vitamin_k_ug: { kind: 'adequate', amount: 75 },
      vitamin_b1_mg: { kind: 'recommended', amount: 1.1 },
      vitamin_b2_mg: { kind: 'recommended', amount: 1.6 },
      vitamin_b5_mg: { kind: 'adequate', amount: 5 },
      vitamin_b6_mg: { kind: 'recommended', amount: 1.8 },
      vitamin_b7_ug: { kind: 'adequate', amount: 40 },
      vitamin_b9_ug: { kind: 'recommended', amount: 330 },
      vitamin_b12_ug: { kind: 'adequate', amount: 4 },
      vitamin_c_mg: { kind: 'recommended', amount: 110 },
      calcium_mg: { kind: 'recommended', amount: 950 },
      phosphorus_mg: { kind: 'adequate', amount: 520 },
      magnesium_mg: { kind: 'adequate', amount: 350 },
      potassium_mg: { kind: 'adequate', amount: 3500 },
      iron_mg: { kind: 'recommended', amount: 9 },
      zinc_mg: { kind: 'recommended', amount: 12.7 },
      iodine_ug: { kind: 'adequate', amount: 150 },
      selenium_ug: { kind: 'adequate', amount: 90 },
      copper_mg: { kind: 'recommended', amount: 0.9 },
      manganese_mg: { kind: 'adequate', amount: 3 }
    } satisfies IntakeReferences;
  }
};
