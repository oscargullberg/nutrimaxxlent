import { tool } from 'ai';
import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { FakeProvider } from '../../src/lib/server/agent/fake';
import { runToolLoop } from '../../src/lib/server/agent/loop';
import type { LlmProvider } from '../../src/lib/server/agent/provider';

const messages = [{ role: 'user', content: 'Rice' }] as const;
const proposal = {
  reply: 'How much rice?',
  needsClarification: true,
  items: [{ kind: 'clarify', question: 'How much rice?', options: [] }]
};
const oversizedBatch = Array.from({ length: 13 }, (_, index) => ({
  id: String(index),
  name: 'search_foods',
  input: { query: 'rice' }
}));

test('runs an available read-only tool and returns the terminal proposal', async () => {
  const execute = vi.fn<({ query }: { query: string }) => Promise<string[]>>(
    ({ query }: { query: string }) => Promise.resolve([query])
  );
  const provider = new FakeProvider({
    rice: [
      { text: '', toolCalls: [{ id: '1', name: 'search_foods', input: { query: 'rice' } }] },
      { text: '', toolCalls: [{ id: '2', name: 'submit_proposal', input: proposal }] }
    ]
  });
  await expect(
    runToolLoop(provider, {
      system: '',
      messages: [...messages],
      tools: { search_foods: tool({ inputSchema: z.object({ query: z.string() }), execute }) }
    })
  ).resolves.toMatchObject({ proposal, trace: { toolCalls: ['search_foods', 'submit_proposal'] } });
  expect(execute).toHaveBeenCalledWith({ query: 'rice' }, expect.any(Object));
});

test('retries an oversized batch without executing its calls', async () => {
  const execute = vi.fn<() => Promise<string[]>>(() => Promise.resolve(['rice']));
  const onOversizedBatch = vi.fn<(batch: unknown) => void>();
  const provider = new FakeProvider();
  const step = vi
    .spyOn(provider, 'step')
    .mockResolvedValueOnce({
      text: '',
      toolCalls: [...oversizedBatch.slice(0, 12), { id: '12', name: 'unavailable', input: {} }],
      tokens: { input: 8, output: 5 }
    })
    .mockResolvedValueOnce({
      text: '',
      toolCalls: [{ id: 'final', name: 'submit_proposal', input: proposal }],
      tokens: { input: 9, output: 2 }
    });
  await expect(
    runToolLoop(provider, {
      system: '',
      messages: [...messages],
      tools: { search_foods: tool({ inputSchema: z.object({ query: z.string() }), execute }) },
      maxSteps: 2,
      onOversizedBatch
    })
  ).resolves.toMatchObject({
    proposal,
    trace: { toolCalls: ['submit_proposal'], inputTokens: 17, outputTokens: 7 }
  });
  expect(step).toHaveBeenCalledTimes(2);
  expect(step.mock.calls[1]?.[0]).toMatchObject({
    system: expect.stringContaining('requested 13 tool calls'),
    messages: [...messages]
  });
  expect(onOversizedBatch).toHaveBeenCalledExactlyOnceWith({
    count: 13,
    step: 1,
    toolCounts: { search_foods: 12 }
  });
  expect(execute).not.toHaveBeenCalled();
});

test('runs mixed lookups and requests a fresh proposal in a terminal-only step', async () => {
  const execute = vi.fn<() => Promise<string[]>>(() => Promise.resolve(['rice']));
  const provider = new FakeProvider({
    rice: [
      {
        text: '',
        toolCalls: [
          { id: '1', name: 'search_foods', input: { query: 'rice' } },
          { id: 'discard', name: 'submit_proposal', input: proposal }
        ]
      },
      { text: '', toolCalls: [{ id: '2', name: 'submit_proposal', input: proposal }] }
    ]
  });
  const step = vi.spyOn(provider, 'step');
  await expect(
    runToolLoop(provider, {
      system: '',
      messages: [...messages],
      tools: {
        search_foods: tool({ inputSchema: z.object({ query: z.string() }), execute }),
        submit_proposal: tool({ inputSchema: z.object({}) })
      }
    })
  ).resolves.toMatchObject({ proposal });
  expect(execute).toHaveBeenCalledOnce();
  expect(Object.keys(step.mock.calls[1]![0].tools)).toEqual(['submit_proposal']);
  expect(step.mock.calls[1]![0]).toMatchObject({ toolChoice: 'required' });
  expect(step.mock.calls[1]![0].messages.at(-1)).toMatchObject({ role: 'tool' });
});

test.each([
  { maxSteps: 1, attempts: 1 },
  { maxSteps: 6, attempts: 2 }
])(
  'stops after $attempts oversized batches with a $maxSteps-step budget',
  async ({ maxSteps, attempts }) => {
    const provider = new FakeProvider(() => ({ text: '', toolCalls: oversizedBatch }));
    const step = vi.spyOn(provider, 'step');
    await expect(
      runToolLoop(provider, { system: '', messages: [...messages], tools: {}, maxSteps })
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_LIMIT' });
    expect(step).toHaveBeenCalledTimes(attempts);
  }
);

test('stops at the configured step limit', async () => {
  const provider = new FakeProvider(() => ({ text: 'Checking', toolCalls: [] }));
  await expect(
    runToolLoop(provider, { system: '', messages: [...messages], tools: {}, maxSteps: 2 })
  ).rejects.toMatchObject({ code: 'AGENT_STEP_LIMIT' });
});

test('times out even if an underlying provider never resolves', async () => {
  const provider = new FakeProvider();
  const status = provider.status.bind(provider);
  const stalled: LlmProvider = {
    name: provider.name,
    model: provider.model,
    status,
    step: () => new Promise<never>(() => {})
  };
  await expect(
    runToolLoop(stalled, { system: '', messages: [...messages], tools: {}, timeoutMs: 20 })
  ).rejects.toMatchObject({ code: 'AGENT_TIMEOUT' });
});
