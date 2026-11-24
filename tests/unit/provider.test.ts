import { expect, expectTypeOf, test } from 'vitest';
import type { LlmProvider, ProviderStatus } from '../../src/lib/server/agent/provider';

test('accepts providers with model status and a single step', async () => {
  const fake = {
    name: 'fake',
    model: 'fixture',
    status: () => Promise.resolve({ provider: 'fake', model: 'fixture', connected: true }),
    step: () => Promise.resolve({ text: '', toolCalls: [] })
  } satisfies LlmProvider;
  expectTypeOf(fake).toMatchTypeOf<LlmProvider>();
  expectTypeOf(await fake.status()).toMatchTypeOf<ProviderStatus>();
  await expect(fake.status()).resolves.toMatchObject({ connected: true });
});

test('fake provider replays tool calls and proposals without storing turn state', async () => {
  const { FakeProvider } = await import('../../src/lib/server/agent/fake');
  const proposal = { reply: 'Logged rice', items: [] };
  const provider = new FakeProvider({
    rice: [
      { text: '', toolCalls: [{ id: 'search', name: 'search_foods', input: { query: 'rice' } }] },
      { text: 'Logged rice', toolCalls: [{ id: 'save', name: 'submit_proposal', input: proposal }] }
    ]
  });
  const request = {
    system: '',
    tools: {},
    signal: new AbortController().signal,
    messages: [{ role: 'user' as const, content: ' RICE ' }]
  };
  const first = await provider.step(request);
  expect(first.toolCalls[0]?.name).toBe('search_foods');
  expect(await provider.step(request)).toEqual(first);
  expect(
    await provider.step({
      ...request,
      messages: [...request.messages, { role: 'assistant', content: '' }]
    })
  ).toMatchObject({ toolCalls: [{ name: 'submit_proposal', input: proposal }] });
});
