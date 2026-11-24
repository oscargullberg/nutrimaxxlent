import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, found, pathId, readBody } from '#lib/server/http/api.ts';
import { deleteRecipe, getRecipe, recipeInput, saveRecipe } from '#lib/server/services/recipes.ts';
export const GET = endpoint(async ({ params }) =>
  json({ recipe: found(await getRecipe(getDatabase(), pathId(params)), 'Recipe') })
);
export const PATCH = endpoint(async ({ params, request }) => {
  const db = getDatabase();
  const id = pathId(params);
  found(await getRecipe(db, id), 'Recipe');
  return json({ recipe: await saveRecipe(db, await readBody(request, recipeInput), id) });
});
export const DELETE = endpoint(async ({ params }) => {
  found(await deleteRecipe(getDatabase(), pathId(params)), 'Recipe');
  return new Response(null, { status: 204 });
});
