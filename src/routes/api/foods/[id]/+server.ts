import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, found, pathId, readBody } from '#lib/server/http/api.ts';
import { getFood } from '#lib/server/services/catalog.ts';
import { foodSettings, updateFoodSettings } from '#lib/server/services/custom-food.ts';
export const GET = endpoint(async ({ params }) =>
  json({ food: found(await getFood(getDatabase(), pathId(params)), 'Food') })
);
export const PATCH = endpoint(async ({ params, request }) =>
  json({
    food: found(
      await updateFoodSettings(
        getDatabase(),
        pathId(params),
        await readBody(request, foodSettings)
      ),
      'Food'
    )
  })
);
