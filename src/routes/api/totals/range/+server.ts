import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, queryObject } from '#lib/server/http/api.ts';
import { rangeTotals } from '#lib/server/services/totals.ts';
const query = z.object({ from: z.iso.date(), to: z.iso.date() });
export const GET = endpoint(async ({ url }) => {
  const { from, to } = query.parse(queryObject(url));
  return json({ days: await rangeTotals(getDatabase(), from, to) });
});
