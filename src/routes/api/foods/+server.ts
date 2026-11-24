import { json } from '@sveltejs/kit';
import { count } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { foods } from '#lib/server/db/schema.ts';
import { endpoint, queryObject, readBody } from '#lib/server/http/api.ts';
import { searchFoods } from '#lib/server/services/catalog.ts';
import { addCustomFood, newFoodInput } from '#lib/server/services/custom-food.ts';
const query = z.object({
  q: z.string().trim().max(200).default(''),
  source: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
export const GET = endpoint(async ({ url }) => {
  const db = getDatabase();
  const { q, source, limit } = query.parse(queryObject(url));
  const [[total], matches] = await Promise.all([
    db.select({ count: count() }).from(foods),
    searchFoods(db, q, { source, limit })
  ]);
  return json({ foods: matches, count: total?.count ?? 0 });
});
export const POST = endpoint(async ({ request }) =>
  json(
    { food: await addCustomFood(getDatabase(), await readBody(request, newFoodInput)) },
    { status: 201 }
  )
);
