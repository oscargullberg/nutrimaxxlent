import { scaleNutrients, type NutrientAmounts } from './amounts.ts';
import { canonicalNutrients } from '../../nutrition-reference.ts';

type AddedFood = { grams: number; per100g: NutrientAmounts };
export type DishAdjustment =
  | { kind: 'add'; food: AddedFood }
  | { kind: 'remove'; componentId: string }
  | { kind: 'substitute'; componentId: string; food: AddedFood };

type DishComponent = { id: string; cookedGrams: number; per100g: NutrientAmounts };

export function adjustDish(
  dish: {
    per100g: NutrientAmounts;
    cookedGrams: number | null;
    components: readonly DishComponent[];
  },
  grams: number,
  adjustments: readonly DishAdjustment[]
) {
  const nutrients = scaleNutrients(dish.per100g, grams);
  if (!adjustments.length) return { grams, nutrients, notes: [] };
  if (!dish.components.length) {
    return {
      grams,
      nutrients,
      notes: ['Component data is unavailable. Adjustments are recorded as notes.']
    };
  }
  if (dish.cookedGrams === null || !Number.isFinite(dish.cookedGrams) || dish.cookedGrams <= 0) {
    throw new Error('Dish cooked weight is required to adjust component quantities.');
  }

  const removed = new Set<string>();
  const changes: Array<{ grams: number; amounts: NutrientAmounts }> = [];
  for (const adjustment of adjustments) {
    if (adjustment.kind !== 'add') {
      const component = dish.components.find((item) => item.id === adjustment.componentId);
      if (!component || removed.has(component.id))
        throw new Error('Invalid dish component adjustment.');
      removed.add(component.id);
      const weight = component.cookedGrams * (grams / dish.cookedGrams);
      if (weight > 0)
        changes.push({ grams: -weight, amounts: scaleNutrients(component.per100g, weight) });
    }
    if (adjustment.kind !== 'remove') {
      const food = adjustment.food;
      if (!Number.isFinite(food.grams) || food.grams <= 0)
        throw new Error('Added grams must be positive.');
      changes.push({ grams: food.grams, amounts: scaleNutrients(food.per100g, food.grams) });
    }
  }

  const adjustedGrams = changes.reduce((total, change) => total + change.grams, grams);
  if (adjustedGrams <= 0) throw new Error('Adjusted dish must have positive weight.');
  const notes: string[] = [];
  for (const { id } of canonicalNutrients) {
    const base = nutrients[id];
    if (typeof base !== 'number') continue;
    let total = base;
    for (const change of changes) {
      const amount = change.amounts[id];
      if (typeof amount !== 'number') {
        nutrients[id] = null;
        break;
      }
      total += Math.sign(change.grams) * amount;
    }
    if (nutrients[id] === null) continue;
    if (total < 0)
      notes.push(
        `Component amounts exceed the source total for ${id}. The result was set to zero.`
      );
    nutrients[id] = Math.max(0, total);
  }
  return { grams: adjustedGrams, nutrients, notes };
}
