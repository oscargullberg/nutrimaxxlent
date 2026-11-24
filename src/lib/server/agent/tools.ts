import { jsonSchema, tool } from 'ai';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { getFood, searchFoods } from '../services/catalog.ts';
import { getRecipe, searchRecipes } from '../services/recipes.ts';
import { dayTotals, getProfile, recentMeals } from '../services/totals.ts';
import { agentProposalInputSchema } from './proposal.ts';
import { normalizeSearch } from '../importers/source.ts';
import { swedishDefault } from './swedish-defaults.ts';

const query = z.string().trim().min(1).max(200);
const id = z.object({ id: z.uuid() });

export function createTools(db: Database, profile?: { id: number; timezone: string }) {
  return {
    search_foods: tool({
      description: 'Search local foods by name, alias or barcode.',
      inputSchema: z.object({ query, source: z.string().max(50).optional() }),
      execute: ({ query, source }) =>
        searchFoods(db, query, {
          source,
          limit: 8,
          preferredSlvId: swedishDefault(normalizeSearch(query))?.id
        })
    }),
    search_foods_batch: tool({
      description: 'Search up to eight distinct unmatched foods in one call.',
      inputSchema: z.object({ queries: z.array(query).min(1).max(8) }),
      execute: ({ queries }) =>
        Promise.all(
          [...new Set(queries.map(normalizeSearch))].map(async (query) => ({
            query,
            foods: await searchFoods(db, query, {
              limit: 5,
              preferredSlvId: swedishDefault(query)?.id
            })
          }))
        )
    }),
    get_food: tool({
      description:
        'Get food nutrients per 100 g, portions and the component tree with component IDs.',
      inputSchema: id,
      execute: async ({ id }) => {
        const food = await getFood(db, id);
        if (!food) return null;
        const { name, nutrients, components, portions, category, densityGPerMl } = food;
        return { id, name, nutrients, components, portions, category, densityGPerMl };
      }
    }),
    search_recipes: tool({
      description: 'Search personal recipes from the local catalog.',
      inputSchema: z.object({ query }),
      execute: ({ query }) => searchRecipes(db, query, 8)
    }),
    get_recipe: tool({
      description: 'Get a personal recipe, ingredient IDs and per-serving nutrients.',
      inputSchema: id,
      execute: ({ id }) => getRecipe(db, id)
    }),
    get_recent_entries: tool({
      description:
        'Read whole recent meals with food and recipe IDs. Use date for a specific profile-local day.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(30).optional(),
        date: z.iso.date().optional()
      }),
      execute: async (window) => recentMeals(db, profile ?? (await getProfile(db)), window)
    }),
    get_day_totals: tool({
      description: 'Read recorded nutrient totals for one profile-local date, using YYYY-MM-DD.',
      inputSchema: z.object({ date: z.iso.date() }),
      execute: async ({ date }) => {
        const { totals, goals } = await dayTotals(db, date);
        return { date, totals, goals };
      }
    }),
    submit_proposal: tool({
      description:
        'Submit exactly one final proposal for server validation and nutrient computation.',
      inputSchema: jsonSchema(agentProposalInputSchema)
    })
  };
}
