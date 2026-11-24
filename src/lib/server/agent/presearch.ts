import type { Database } from '../db/client.ts';
import { normalizeSearch } from '../importers/source.ts';
import { searchFoods } from '../services/catalog.ts';
import { searchRecipes } from '../services/recipes.ts';
import { swedishDefault } from './swedish-defaults.ts';

function mentions(text: string) {
  return normalizeSearch(text.replace(/\r?\n/gu, ';'))
    .replace(/(\d),(\d)/gu, '$1.$2')
    .replace(/^(?:and|och|plus)\s+/u, '')
    .replace(/\s+(?=\d+\s*[x×]\s*[a-z])/gu, ';')
    .replace(/\b(glas|mugg|skal|flaska)\s+med\s+/gu, '$1 ')
    .replace(
      /^(?:(?:today|yesterday|idag|igar)\s*)?(?:(?:breakfast|lunch|dinner|snack|frukost|middag|mellanmal)\s*:\s*)?/u,
      ''
    )
    .split(/[,;]|\s+w\/\s*|\s+(?:and|och|with|med|plus|w)\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function searchPhrase(mention: string) {
  return mention
    .replace(
      /^(?:(?:i ate|i had|at|log|add|extra|no|without|utan|lagg till|avg\.?|average|normal)\s+)+/u,
      ''
    )
    .replace(
      /^(?:\d+(?:\.\d+)?\s*(?:[x×]\s*|(?:kg|g|ml|dl|l|tbsp|tsp|msk|tsk|st)\s+)?|a\s+|en\s+|ett\s+)/u,
      ''
    )
    .replace(
      /^(?:(?:slices?|portions?|servings?|pieces?|glass(?:es)?|bowls?|mugs?|bottles?|cans?|scoops?|handfuls?)\s+of\s+|(?:portion(?:er)?|bit(?:ar)?|skiv(?:a|or))\s+av\s+|(?:cups?(?:\s+of)?|glas|skal|mugg|flaska)\s+)/u,
      ''
    )
    .replace(
      /\s+(?:portion(?:er|s)?|servings?|tabs?|tablets?|tablett(?:er)?|capsules?|kaps(?:el|lar)?)$/u,
      ''
    )
    .trim();
}

export async function preSearch(db: Database, text: string) {
  return Promise.all(
    mentions(text)
      .flatMap((mention) => {
        const words = searchPhrase(mention).split(/\s+/u);
        return words.length > 1 && words.every(swedishDefault) ? words : [mention];
      })
      .slice(0, 16)
      .map(async (mention) => {
        const query = searchPhrase(mention)
          .replace(/\s+\d+(?:\.\d+)?\s*(?:kg|g|ml|dl|l)\b/gu, '')
          .replace(/^vattenglas$/u, 'vatten');
        if (!query) return { mention, query, foods: [], recipes: [] };
        const standard = swedishDefault(query);
        const [foods, recipes] = await Promise.all([
          searchFoods(db, query, { limit: 5, preferredSlvId: standard?.id }),
          searchRecipes(db, query, 3)
        ]);
        return { mention, query, foods, recipes, standard };
      })
  );
}
