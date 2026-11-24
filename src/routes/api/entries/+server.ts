import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, readBody } from '#lib/server/http/api.ts';
import { addManualEntry, listEntries, manualEntryInput } from '#lib/server/services/entries.ts';
export const GET = endpoint(async ({ url }) => {
  const date = z.iso
    .date()
    .optional()
    .parse(url.searchParams.get('date') ?? undefined);
  return json({ entries: await listEntries(getDatabase(), date) });
});
export const POST = endpoint(async ({ request }) =>
  json(
    { entry: await addManualEntry(getDatabase(), await readBody(request, manualEntryInput)) },
    { status: 201 }
  )
);
