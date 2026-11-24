export const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const;
export type MealType = (typeof mealTypes)[number];

export const mealLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  other: 'Other'
};
