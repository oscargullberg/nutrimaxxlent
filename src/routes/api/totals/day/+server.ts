import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint } from '#lib/server/http/api.ts';
import { localDate } from '#lib/server/nutrition/snapshots.ts';
import { dayTotals, getProfile } from '#lib/server/services/totals.ts';
export const GET = endpoint(async ({ url }) => {
  const db = getDatabase();
  const date = z.iso
    .date()
    .optional()
    .parse(url.searchParams.get('date') ?? undefined);
  const profile = await getProfile(db);
  return json(await dayTotals(db, date ?? localDate(new Date(), profile.timezone)));
});
