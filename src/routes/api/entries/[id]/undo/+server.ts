import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, found, pathId } from '#lib/server/http/api.ts';
import { changeEntryStatus } from '#lib/server/services/entries.ts';
export const POST = endpoint(async ({ params }) =>
  json({ entry: found(await changeEntryStatus(getDatabase(), pathId(params), 'undone'), 'Entry') })
);
