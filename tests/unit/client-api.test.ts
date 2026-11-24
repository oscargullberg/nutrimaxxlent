import { expect, test } from 'vitest';
import { parseSse } from '../../src/lib/client/api';

function stream(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += size)
        controller.enqueue(bytes.slice(offset, offset + size));
      controller.close();
    }
  });
}

test('parses chunked UTF-8, CRLF and multiline data', async () => {
  const result = await Array.fromAsync(
    parseSse(
      stream(
        ': heartbeat\r\nevent: text\r\ndata: {\r\ndata: "delta":"gröna ärtor"}\r\n\r\nevent: done\ndata: {"threadId":"id"}\n\n',
        1
      )
    )
  );
  expect(result).toEqual([
    { type: 'text', data: { delta: 'gröna ärtor' } },
    { type: 'done', data: { threadId: 'id' } }
  ]);
});

test('preserves structured streamed errors and rejects malformed JSON', async () => {
  expect(
    await Array.fromAsync(
      parseSse(
        stream(
          'event: error\ndata: {"error":{"code":"INVALID_PROPOSAL","message":"Invalid"}}\n\n',
          8
        )
      )
    )
  ).toMatchObject([{ type: 'error', data: { error: { code: 'INVALID_PROPOSAL' } } }]);
  await expect(
    Array.fromAsync(parseSse(stream('event: text\ndata: bad\n\n', 4)))
  ).rejects.toMatchObject({ code: 'STREAM_INVALID' });
});

test('cancels a pending read when aborted', async () => {
  const controller = new AbortController();
  const pending = Array.fromAsync(parseSse(new ReadableStream<Uint8Array>(), controller.signal));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
