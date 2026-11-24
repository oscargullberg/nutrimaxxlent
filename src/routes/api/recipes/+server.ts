import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, readBody } from '#lib/server/http/api.ts';
import { recipeInput, saveRecipe, searchRecipes } from '#lib/server/services/recipes.ts';
export const GET = endpoint(async ({ url }) =>
  json({
    recipes: await searchRecipes(
      getDatabase(),
      z
        .string()
        .trim()
        .max(200)
        .parse(url.searchParams.get('q') ?? '')
    )
  })
);
export const POST = endpoint(async ({ request }) =>
  json(
    { recipe: await saveRecipe(getDatabase(), await readBody(request, recipeInput)) },
    { status: 201 }
  )
);
