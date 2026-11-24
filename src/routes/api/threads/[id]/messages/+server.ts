import {
  chatInput,
  chatMessagesForView,
  stopChatTurn,
  streamChat
} from '#lib/server/services/chat.ts';
import { json } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/db/runtime.ts';
import { ApiError, endpoint, errorDetails, found, pathId, readBody } from '#lib/server/http/api.ts';
import { getThread } from '#lib/server/services/threads.ts';
export const GET = endpoint(async ({ params }) => {
  const db = getDatabase();
  const id = pathId(params);
  const thread = found(await getThread(db, id), 'Thread');
  return json(
    { thread, ...(await chatMessagesForView(db, id)) },
    {
      headers: { 'cache-control': 'no-store' }
    }
  );
});

export const DELETE = endpoint(async ({ params, url }) => {
  stopChatTurn(pathId(params), pathId({ turn: url.searchParams.get('turn') ?? undefined }, 'turn'));
  return new Response(null, { status: 204 });
});

export const POST = endpoint(async ({ request, params, locals }) => {
  const db = getDatabase();
  const threadId = pathId(params);
  const input = await readBody(request, chatInput);
  const thread = found(await getThread(db, threadId), 'Thread');
  if (thread.archivedAt)
    throw new ApiError(409, 'CHAT_CONFLICT', 'Restore this thread before sending a message.');

  const encoder = new TextEncoder();
  let listening = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (name: string, data: unknown) => {
        if (!listening || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          listening = false;
        }
      };
      void streamChat(db, threadId, input, emit)
        .catch((error: unknown) => {
          const { code, message, status } = errorDetails(error);
          if (status === 500)
            console.error('Chat request failed', {
              requestId: locals.requestId,
              kind: error instanceof Error ? error.name : typeof error
            });
          emit('error', { error: { code, message, requestId: locals.requestId } });
        })
        .finally(() => {
          if (listening) controller.close();
        });
    },
    cancel() {
      listening = false;
    }
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' }
  });
});
