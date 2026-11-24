import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, readBody } from '#lib/server/http/api.ts';
import {
  providerConfig,
  readSettings,
  settingsInput,
  updateSettings
} from '#lib/server/services/settings.ts';
export const GET = endpoint(async () => {
  const settings = await readSettings(getDatabase());
  return json({ ...settings, runtime: providerConfig(settings.profile) });
});
export const PATCH = endpoint(async ({ request }) => {
  const settings = await updateSettings(getDatabase(), await readBody(request, settingsInput));
  return json({ ...settings, runtime: providerConfig(settings.profile) });
});
