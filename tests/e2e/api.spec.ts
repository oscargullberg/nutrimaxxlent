import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_DATABASE_URL, 'Requires an isolated Playwright database.');

test('serves validated JSON routes and stable error envelopes', async ({ request, baseURL }) => {
  const headers = { Origin: baseURL! };
  const created = await request.post('/api/threads', {
    headers,
    data: { title: 'API fixture thread' }
  });
  expect(created.status()).toBe(201);
  const { thread } = await created.json();
  const stored = await request.get(`/api/threads/${thread.id}/messages`);
  expect(await stored.json()).toMatchObject({ thread: { id: thread.id }, messages: [] });
  const archived = await request.delete(`/api/threads/${thread.id}`, { headers });
  expect((await archived.json()).thread.archivedAt).toBeTruthy();

  const settings = await request.get('/api/settings');
  expect(await settings.json()).toMatchObject({
    profile: { timezone: expect.any(String) },
    runtime: { provider: 'fake' }
  });
  const status = await request.get('/api/provider/status');
  expect(await status.json()).toMatchObject({ provider: 'fake', connected: true });
  const sources = await request.get('/api/meta/sources');
  expect(await sources.json()).toMatchObject({ sources: expect.any(Array) });

  const invalid = await request.post('/api/entries', { headers, data: { items: [] } });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toMatchObject({
    error: { code: 'INVALID_INPUT', message: expect.any(String) }
  });

  const missing = await request.get('/api/foods/ca164e4a-fe3c-45f6-a1ee-472244b8e73e');
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
});

test('streams ordered chat events and saves the resolved nutrients', async ({
  request,
  baseURL
}) => {
  const headers = { Origin: baseURL! };
  const label = `Ssefixture${crypto.randomUUID().slice(0, 8)} rice`;
  const food = await request.post('/api/foods', {
    headers,
    data: { name: label, per100g: { energy_kcal: 120 } }
  });
  expect(food.status()).toBe(201);
  const thread = (await (await request.post('/api/threads', { headers, data: {} })).json()).thread;
  const response = await request.post(`/api/threads/${thread.id}/messages`, {
    headers,
    data: { kind: 'message', messageId: crypto.randomUUID(), text: `150 g ${label}` }
  });
  expect(response.headers()['content-type']).toContain('text/event-stream');
  const events = (await response.text())
    .trim()
    .split('\n\n')
    .map((block) => {
      const [event, data] = block.split('\n');
      return { event: event!.slice(7), data: JSON.parse(data!.slice(6)) };
    });
  expect(events.map(({ event }) => event)).toEqual([
    'message',
    'text',
    'tool',
    'proposal',
    'message',
    'committed',
    'done'
  ]);
  const entry = events.find(({ event }) => event === 'committed')!.data.entry;
  expect(entry.items).toMatchObject([{ grams: 150, nutrients: { energy_kcal: 180 } }]);
  const deleted = await request.delete(`/api/threads/${thread.id}?permanent=true`, { headers });
  expect(deleted.ok()).toBeTruthy();
  expect((await request.get(`/api/threads/${thread.id}`)).status()).toBe(404);
  const saved = await request.get(`/api/entries/${entry.id}`);
  expect(await saved.json()).toMatchObject({ entry: { id: entry.id, status: 'active' } });
  await request.post(`/api/entries/${entry.id}/undo`, { headers });
});

test('rejects foreign origins and returns a request ID', async ({ request }) => {
  const rejected = await request.post('/api/threads', {
    headers: { Origin: 'https://example.test' },
    data: {}
  });
  expect(rejected.status()).toBe(403);
  const requestId = rejected.headers()['x-request-id'];
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(await rejected.json()).toMatchObject({ error: { code: 'INVALID_ORIGIN', requestId } });
});
