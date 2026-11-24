import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { ApiError, endpoint, found, pathId, readBody } from '#lib/server/http/api.ts';
import { activeChatTurn } from '#lib/server/services/chat.ts';
import { deleteThread, getThread, updateThread } from '#lib/server/services/threads.ts';
const input = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  archived: z.boolean().optional()
});
export const GET = endpoint(async ({ params }) =>
  json({ thread: found(await getThread(getDatabase(), pathId(params)), 'Thread') })
);
function requireIdle(id: string) {
  if (activeChatTurn(id))
    throw new ApiError(409, 'CHAT_BUSY', 'Wait for the current message to finish.');
}

export const PATCH = endpoint(async ({ params, request }) => {
  const id = pathId(params);
  const changes = await readBody(request, input);
  if (changes.archived) requireIdle(id);
  return json({ thread: found(await updateThread(getDatabase(), id, changes), 'Thread') });
});
export const DELETE = endpoint(async ({ params, url }) => {
  const id = pathId(params);
  requireIdle(id);
  const db = getDatabase();
  const thread =
    url.searchParams.get('permanent') === 'true'
      ? await deleteThread(db, id)
      : await updateThread(db, id, { archived: true });
  return json({ thread: found(thread, 'Thread') });
});
