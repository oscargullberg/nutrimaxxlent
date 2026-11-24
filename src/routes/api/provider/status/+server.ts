import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint } from '#lib/server/http/api.ts';
import { getProfile } from '#lib/server/services/totals.ts';
import { createProvider, providerConfig } from '#lib/server/services/settings.ts';
export const GET = endpoint(async () =>
  json(await createProvider(providerConfig(await getProfile(getDatabase()))).status())
);
