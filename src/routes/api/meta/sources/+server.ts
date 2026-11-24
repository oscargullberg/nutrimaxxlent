import { json } from '@sveltejs/kit';
import { asc, isNotNull } from 'drizzle-orm';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint } from '#lib/server/http/api.ts';
import { foodSources } from '#lib/server/db/schema.ts';

export const GET = endpoint(async () => {
  const sources = await getDatabase()
    .select()
    .from(foodSources)
    .where(isNotNull(foodSources.lastImportedAt))
    .orderBy(asc(foodSources.name));
  return json({ sources });
});
