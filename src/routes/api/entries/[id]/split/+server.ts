import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, found, pathId, readBody } from '#lib/server/http/api.ts';
import { entrySplit, splitEntry } from '#lib/server/services/entries.ts';

export const POST = endpoint(async ({ params, request }) =>
  json({
    entry: found(
      await splitEntry(getDatabase(), pathId(params), await readBody(request, entrySplit)),
      'Entry'
    )
  })
);
