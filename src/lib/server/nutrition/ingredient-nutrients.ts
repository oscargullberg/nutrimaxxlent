import { canonicalNutrients, type NutrientId } from '../../nutrition-reference.ts';
import type { NutrientAmounts } from './amounts.ts';
import { maximize, type LinearLimit } from './linear-bounds.ts';

type Component = { percent: number | null; nutrients: NutrientAmounts };

export function estimateIngredientNutrients(
  label: NutrientAmounts,
  components: readonly Component[],
  orderedByWeight: boolean
) {
  const estimates: NutrientAmounts = {};
  if (!components.length) return estimates;
  const limits: LinearLimit[] = [];
  const ones = components.map(() => 1);
  // Variables are ingredient shares of the finished product, from zero to one.
  function bound(coefficients: number[], min: number, max: number) {
    limits.push({ coefficients, upper: max });
    limits.push({ coefficients: coefficients.map((value) => -value), upper: -min });
  }
  bound(ones, 1, 1);
  let anchors = 0;
  for (const [index, { percent }] of components.entries()) {
    if (percent !== null) {
      const tolerance = Math.min(0.5, percent * 0.05) / 100;
      bound(
        ones.map((_, i) => Number(i === index)),
        percent / 100 - tolerance,
        percent / 100 + tolerance
      );
      anchors++;
    }
    if (orderedByWeight && index > 0) {
      limits.push({
        coefficients: ones.map((_, i) => Number(i === index) - Number(i === index - 1)),
        upper: 0
      });
    }
  }

  function componentValues(id: NutrientId) {
    const values = components.map(({ nutrients }) => nutrients[id]);
    return values.every(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    )
      ? values
      : null;
  }

  // Allow for label rounding and the difference between generic foods and the actual ingredients.
  for (const id of ['protein_g', 'fat_g', 'carbs_g', 'sugars_g', 'fiber_g'] as const) {
    const reported = label[id];
    const values = componentValues(id);
    if (reported == null || !values) continue;
    const tolerance = Math.max(1, reported * 0.15);
    bound(values, Math.max(0, reported - tolerance), reported + tolerance);
    if (values.some((value) => value !== values[0])) anchors++;
  }
  if (!anchors && components.length > 1) return estimates;
  if (
    maximize(
      limits,
      ones.map(() => 0)
    ) === null
  )
    return estimates;

  for (const { id, category } of canonicalNutrients) {
    if (label[id] != null) continue;
    if (category !== 'vitamin' && category !== 'mineral' && category !== 'fat' && id !== 'fiber_g')
      continue;
    if (id === 'salt_g' || id === 'sodium_mg') continue;
    const values = componentValues(id);
    if (!values) continue;
    const largest = Math.max(...values);
    if (largest <= 0) continue;
    const normalized = values.map((value) => value / largest);
    const negativeMin = maximize(
      limits,
      normalized.map((value) => -value)
    );
    const max = maximize(limits, normalized);
    if (negativeMin === null || max === null) continue;
    const min = Math.max(0, -negativeMin);
    // The feasible interval measures uncertainty in proportions. The generic nutrient data
    // itself can vary too, so a narrow interval still produces an explicitly estimated value.
    if (min <= 0 || max < min - 1e-8 || max - min > 0.3 * (max + min)) continue;
    estimates[id] = Number((((min + max) * largest) / 2).toPrecision(2));
  }
  return estimates;
}
