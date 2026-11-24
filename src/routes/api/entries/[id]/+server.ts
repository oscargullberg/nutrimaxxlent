import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, found, pathId, readBody } from '#lib/server/http/api.ts';
import {
  changeEntryStatus,
  entryEdit,
  getEntry,
  updateEntry
} from '#lib/server/services/entries.ts';
export const GET = endpoint(async ({ params }) =>
  json({ entry: found(await getEntry(getDatabase(), pathId(params)), 'Entry') })
);
export const PATCH = endpoint(async ({ params, request }) =>
  json({
    entry: found(
      await updateEntry(getDatabase(), pathId(params), await readBody(request, entryEdit)),
      'Entry'
    )
  })
);
export const DELETE = endpoint(async ({ params }) =>
  json({ entry: found(await changeEntryStatus(getDatabase(), pathId(params), 'deleted'), 'Entry') })
);
