import { mealLabels, type MealType } from './meal-types.ts';

const mealAliases: Record<string, MealType> = {
  breakfast: 'breakfast',
  frukost: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  supper: 'dinner',
  middag: 'dinner',
  snack: 'snack',
  mellanmål: 'snack'
};
const descriptor = /^[\p{L}][\p{L}\p{N} '’&-]{0,47}$/u;
const detailHeading =
  /^(?:ingredients?|ingredienser|nutrition(?: facts)?|näringsvärde|servings?|portion(?: size)?|calories|energy|kcal|protein|fat|fett|carb(?:s|ohydrates)?|kolhydrater|fibre|fiber|sugar|salt|sodium|vitamin.*|ingredients list|brand|product|notes?)$/iu;

export type MealSection = { meal?: MealType; title?: string; text: string };

function heading(line: string, paragraphStart: boolean) {
  const cleaned = line
    .replace(/^#{1,6}\s+|^[-*]\s+/u, '')
    .replaceAll('**', '')
    .trim();
  const field = /^(.+?)(?::\s*|\s+[–—-]\s+)(.*)$/u.exec(cleaned);
  const label = field?.[1]?.trim() ?? cleaned;
  const words = label.toLowerCase().split(/\s+/u);
  const meal = Object.hasOwn(mealAliases, words[0]!)
    ? mealAliases[words[0]!]
    : Object.hasOwn(mealAliases, words.at(-1)!)
      ? mealAliases[words.at(-1)!]
      : undefined;
  if (meal && (field || words.length === 1)) {
    const name = words.length > 1 ? label : undefined;
    return {
      meal,
      title: name?.replace(/^mcd\s+dinner$/iu, 'McD meal'),
      firstLine: field?.[2] ?? ''
    };
  }
  if (paragraphStart && field && descriptor.test(label) && !detailHeading.test(label)) {
    return { meal: undefined, title: label, firstLine: field[2] ?? '' };
  }
  return null;
}

export function mealSections(input: string): MealSection[] {
  const sections: MealSection[] = [];
  let current: MealSection = { text: '' };
  let paragraphStart = true;
  const lines = input.split(
    /\r?\n|;\s*(?=(?:breakfast|frukost|lunch|dinner|supper|middag|snack|mellanmål)\s*:)/iu
  );
  for (const line of lines) {
    const label = heading(line, paragraphStart);
    if (label) {
      if (current.text.trim()) sections.push({ ...current, text: current.text.trim() });
      current = { meal: label.meal, title: label.title, text: label.firstLine };
    } else {
      current.text += `\n${line}`;
    }
    paragraphStart = !line.trim();
  }
  if (current.text.trim()) sections.push({ ...current, text: current.text.trim() });
  const explicit = sections.filter(({ meal, title }) => meal || title);
  if (sections.length === 1 && explicit[0]?.meal) return sections;
  if (explicit.length > 1) {
    const preamble = /^(?:today i ate|what i ate today|meal log|dagens mat)[.!:]?$/iu;
    return sections.filter(
      (section) => section.meal || section.title || !preamble.test(section.text)
    );
  }

  const category =
    /\bfor\s+(breakfast|lunch|dinner|supper|snack)\b|\btill\s+(frukost|lunch|middag|mellanmål)\b/giu;
  const matches = new Set(
    Array.from(
      input.matchAll(category),
      ([, english, swedish]) => mealAliases[(english ?? swedish)!.toLowerCase()]
    )
  );
  return [{ meal: matches.size === 1 ? matches.values().next().value : undefined, text: input }];
}

export function sectionLabel(section: MealSection) {
  return section.title ?? (section.meal ? mealLabels[section.meal] : 'Meal');
}
