import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { endpoint, readBody } from '#lib/server/http/api.ts';
import { createThread, getOrCreateDailyThread, listThreads } from '#lib/server/services/threads.ts';
const dateInput = z.iso.date().optional();
const input = z.object({ title: z.string().trim().min(1).max(100).optional(), date: dateInput });
export const GET = endpoint(async ({ url }) => {
  const date = dateInput.parse(url.searchParams.get('date') ?? undefined);
  return json({
    threads: await listThreads(getDatabase(), url.searchParams.get('archived') === 'true', date)
  });
});
export const POST = endpoint(async ({ request }) => {
  const { date, title } = await readBody(request, input);
  const db = getDatabase();
  if (date) return json({ thread: await getOrCreateDailyThread(db, date) });
  return json({ thread: await createThread(db, title) }, { status: 201 });
});
