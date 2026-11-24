import type { ApiProblem, ChatEvent, ChatInput } from './types.ts';

export class ApiClientError extends Error {
  readonly code: string;
  readonly requestId?: string;
  constructor(
    problem: ApiProblem,
    readonly status?: number
  ) {
    super(problem.message);
    this.name = 'ApiClientError';
    this.code = problem.code;
    this.requestId = problem.requestId;
  }
}

export function problemMessage(error: unknown) {
  return error instanceof ApiClientError
    ? `${error.message} (${error.code})`
    : error instanceof Error
      ? error.message
      : 'The request failed.';
}

async function responseError(response: Response) {
  try {
    const content = (await response.json()) as { error?: ApiProblem };
    if (content.error) return new ApiClientError(content.error, response.status);
  } catch {
    // A server or proxy may return a non-JSON response.
  }
  return new ApiClientError(
    { code: 'REQUEST_FAILED', message: `Request failed with HTTP ${response.status}.` },
    response.status
  );
}

async function request(
  path: string,
  options: { method?: string; data?: unknown; signal?: AbortSignal } = {}
) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method,
      signal: options.signal,
      ...(options.data === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(options.data)
          })
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiClientError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the local app. Try again.'
    });
  }
  if (!response.ok) throw await responseError(response);
  return response;
}

export async function api<T = void>(
  path: string,
  options?: { method?: string; data?: unknown; signal?: AbortSignal }
): Promise<T> {
  const response = await request(path, options);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const eventNames = new Set([
  'message',
  'text',
  'tool',
  'proposal',
  'clarification',
  'draft',
  'committed',
  'done',
  'error'
]);

export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let event = '';
  let lines: string[] = [];
  let buffer = '';
  let ended = false;
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });

  function consume(line: string) {
    if (line === '') {
      let output: ChatEvent | undefined;
      if (lines.length && eventNames.has(event)) {
        try {
          output = { type: event, data: JSON.parse(lines.join('\n')) } as ChatEvent;
        } catch {
          throw new ApiClientError({
            code: 'STREAM_INVALID',
            message: 'The chat stream could not be read. Try again.'
          });
        }
      }
      lines = [];
      event = '';
      return output;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /u, '');
    if (field === 'event') event = value;
    else if (field === 'data') lines.push(value);
    return undefined;
  }

  try {
    signal?.throwIfAborted();
    while (!ended) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      ended = chunk.done;
      for (;;) {
        const match = /\r\n|\n|\r/u.exec(buffer);
        if (!match || (match[0] === '\r' && match.index === buffer.length - 1 && !ended)) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const output = consume(line);
        if (output) yield output;
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function* chatStream(threadId: string, input: ChatInput, signal?: AbortSignal) {
  const response = await request(`/api/threads/${threadId}/messages`, {
    method: 'POST',
    data: input,
    signal
  });
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new ApiClientError({
      code: 'STREAM_INVALID',
      message: 'The server did not return a chat stream.'
    });
  }
  for await (const event of parseSse(response.body, signal)) {
    if (event.type === 'error') throw new ApiClientError(event.data.error);
    yield event;
    if (event.type === 'done') return;
  }
  throw new ApiClientError({
    code: 'STREAM_INTERRUPTED',
    message: 'The chat stream ended before finishing. Reload the thread.'
  });
}
