import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, found, pathId, readBody } from '#lib/server/http/api.ts';
import { editLogItem, itemEdit, removeLogItem } from '#lib/server/services/entries.ts';
export const PATCH = endpoint(async ({ params, request }) =>
  json({
    entry: found(
      await editLogItem(
        getDatabase(),
        pathId(params),
        pathId(params, 'itemId'),
        await readBody(request, itemEdit)
      ),
      'Entry item'
    )
  })
);
export const DELETE = endpoint(async ({ params }) =>
  json({
    entry: found(
      await removeLogItem(getDatabase(), pathId(params), pathId(params, 'itemId')),
      'Entry item'
    )
  })
);
