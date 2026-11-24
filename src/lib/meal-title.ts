import type { AgentProposal, CatalogSelection, ProposedItem } from './server/agent/proposal';

export type MealTitleItem = { label: string; nameEn?: string | null; grams?: number };
export const maxMealTitleLength = 100;

const adjustmentKeys = ['kind', 'component', 'food', 'foodId', 'quantity', 'unit'];

export function sameMealItem(
  a: ProposedItem,
  b: AgentProposal['items'][number] | CatalogSelection
) {
  switch (a.kind) {
    case 'food':
      return b.kind === 'food' && a.foodId === b.foodId;
    case 'recipe':
      return (
        b.kind === 'recipe' &&
        a.recipeId === b.recipeId &&
        JSON.stringify(a.adjustments, adjustmentKeys) ===
          JSON.stringify('adjustments' in b ? b.adjustments : [], adjustmentKeys)
      );
    case 'dish_adjustment':
      return (
        b.kind === 'dish_adjustment' &&
        a.foodId === b.foodId &&
        JSON.stringify(a.adjustments, adjustmentKeys) ===
          JSON.stringify(b.adjustments, adjustmentKeys)
      );
    case 'estimate':
      return b.kind === 'estimate' && a.label === b.label;
    case 'clarify':
      return a === b;
  }
}

function shortName({ label, nameEn }: MealTitleItem) {
  const name = (nameEn?.trim() || label.trim())
    .replace(/\s+/gu, ' ')
    .replace(/^rice,.*$/iu, 'Rice')
    .replace(/^beef,\s*ground\b.*$/iu, 'Minced beef')
    .replace(/^blandfärs\b.*$/iu, 'Minced meat')
    .replace(/^kokosmjölk(?:\s+[\d.,–%-]+)?$/iu, 'Coconut milk')
    .replace(/^(?:large\s+)?yakiniku\b.*$/iu, 'Yakiniku')
    .replace(/^fast foods, crispy chicken in tortilla\b.*$/iu, 'Crispy chicken wrap')
    .replace(/^fast foods, crispy chicken filet sandwich\b.*$/iu, 'Crispy chicken sandwich')
    .replace(/^mcdonald's,\s*/iu, 'McDonald’s ')
    .replace(/\s+(?:app\.\s+)?\d+(?:[.,-]\d+)?%\s+(?:fat|fibre|fiber)\b.*$/iu, '')
    .replace(/\s+(?:w\/|m\.)\s+(?:skin|skal)$/iu, '')
    .replace(/^coffee brewed$/iu, 'Coffee')
    .replace(/^crisp bread(?: wholegrain rye)?$/iu, 'Crispbread');
  return generatedMealTitle(name);
}

export function generatedMealTitle(value?: string) {
  const title = value
    ?.trim()
    .replace(/^#+\s*/u, '')
    .replace(/\s+/gu, ' ');
  if (!title || title.length > 64 || /…|\.{3}|,.*,/u.test(title)) return undefined;
  return title;
}

export function mealTitle(items: readonly MealTitleItem[], fallback = 'Meal') {
  const names = new Map<string, string>();
  for (const item of items) {
    const name = shortName(item);
    if (!name) return fallback;
    names.set(name.toLocaleLowerCase('en'), name);
  }
  return names.size === 1 ? (names.values().next().value ?? fallback) : fallback;
}
