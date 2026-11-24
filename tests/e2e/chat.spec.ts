import { expect, test } from '@playwright/test';
import postgres from 'postgres';

test.skip(!process.env.E2E_DATABASE_URL, 'Requires an isolated Playwright database.');

test('leaving Chat detaches the stream and returning follows the same turn', async ({
  page,
  request,
  baseURL
}) => {
  const headers = { Origin: baseURL! };
  const { thread } = await (
    await request.post('/api/threads', { headers, data: { title: 'Resume after navigation' } })
  ).json();
  const messagesPath = `/api/threads/${thread.id}/messages`;
  await page.goto(`/chat-history?thread=${thread.id}`);
  const database = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await database.begin(async (tx) => {
      await tx`LOCK TABLE foods IN ACCESS EXCLUSIVE MODE`;
      const composer = page.getByRole('textbox', { name: 'Describe your meal' });
      await composer.fill('150 g pasta');
      await composer.press('Enter');
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
      await page.getByRole('link', { name: 'Today', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
      const inProgress = await (await request.get(messagesPath)).json();
      expect(inProgress).toMatchObject({
        activeTurnId: expect.any(String),
        messages: [{ role: 'user', content: '150 g pasta' }]
      });

      const duplicate = await request.post(messagesPath, {
        headers,
        data: { kind: 'message', messageId: inProgress.activeTurnId, text: '150 g pasta' }
      });
      expect(await duplicate.text()).toContain('CHAT_BUSY');
      await page.getByRole('button', { name: 'Log', exact: true }).click();
      await page.getByRole('link', { name: 'Chat history' }).click();
      await expect(page.getByText('Resolving your message…')).toBeVisible();
      await page.reload();
      await expect(page.getByText('Resolving your message…')).toBeVisible();
    });
  } finally {
    await database.end();
  }
  await expect(page.getByRole('article', { name: 'Logged meal' })).toHaveCount(1);
  const completed = await (await request.get(messagesPath)).json();
  expect(completed).toMatchObject({
    activeTurnId: null,
    interruptedTurnId: null,
    messages: [{ role: 'user' }, { role: 'assistant' }]
  });
});

test('Stop ends the accepted turn on the server and allows retry', async ({ page, request }) => {
  await page.goto('/chat-history');

  const database = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await database.begin(async (tx) => {
      await tx`LOCK TABLE foods IN ACCESS EXCLUSIVE MODE`;
      const composer = page.getByRole('textbox', { name: 'Describe your meal' });
      await composer.fill('175 g peas');
      await composer.press('Enter');
      const stop = page.getByRole('button', { name: 'Stop', exact: true });
      await expect(stop).toBeEnabled();
      const stopped = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' && response.url().includes('/messages?turn=')
      );
      await stop.click();
      expect((await stopped).status()).toBe(204);
    });
  } finally {
    await database.end();
  }
  await expect(page.getByText('Stopped processing this message.')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Logged meal' })).toHaveCount(0);
  const id = new URL(page.url()).searchParams.get('thread');
  expect(await (await request.get(`/api/threads/${id}/messages`)).json()).toMatchObject({
    activeTurnId: null,
    messages: [
      { role: 'user' },
      {
        role: 'assistant',
        parts: expect.arrayContaining([{ type: 'error', code: 'CHAT_STOPPED' }])
      }
    ]
  });
  await page.getByRole('button', { name: 'Retry message' }).click();
  await expect(page.getByRole('article', { name: 'Logged meal' })).toHaveCount(1);
});

test('logs carbonara, edits its portion, and undoes it', async ({ page }) => {
  await page.goto('/chat-history');
  await page.getByRole('button', { name: 'avg carbonara serving' }).click();
  await page.getByRole('textbox', { name: 'Describe your meal' }).press('Enter');
  const card = page.getByRole('article', { name: 'Logged meal' });
  await expect(card.getByText('450 kcal')).toBeVisible();
  await card.getByRole('button', { name: 'Edit portion for Carbonara' }).click();
  await card.getByRole('spinbutton', { name: 'Grams' }).fill('300');
  await card.getByRole('button', { name: 'Save portion' }).click();
  await expect(card.getByText('540 kcal')).toBeVisible();
  const chat = page.url();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(
    page
      .getByRole('article', { name: 'Meal entry' })
      .getByRole('button', { name: 'Replace Carbonara' })
  ).toBeVisible();
  await expect(page.getByTestId('energy_kcal')).toContainText('kcal');
  await page.goto(chat);
  await expect(card.getByText('540 kcal')).toBeVisible();
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByText('Log undone')).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(
    page.getByRole('article', { name: 'Meal entry' }).filter({ hasText: 'Carbonara' })
  ).toHaveCount(0);
});

test('selects a branded clarification and reuses the learned alias', async ({ page }) => {
  await page.goto('/chat-history');
  const composer = page.getByRole('textbox', { name: 'Describe your meal' });
  await composer.fill('barbell bar');
  await composer.press('Enter');
  const choices = page.getByRole('region', { name: 'Clarification choices' });
  const vanilla = choices.getByRole('button', { name: /Barebells Vanilla/u });
  await expect(vanilla).toContainText('225.5 kcal');
  await vanilla.click();
  const cards = page.getByRole('article', { name: 'Logged meal' });
  await expect(
    cards.first().getByRole('button', { name: 'Replace Barebells Vanilla' })
  ).toBeVisible();
  await composer.fill('barbell bar');
  await composer.press('Enter');
  await expect(cards).toHaveCount(2);
  await expect(
    cards.last().getByRole('button', { name: 'Replace Barebells Vanilla' })
  ).toBeVisible();
  await expect(choices).toHaveCount(0);
});

test('follow-up messages keep the pending meal available for logging', async ({
  page,
  request,
  baseURL
}) => {
  const headers = { Origin: baseURL! };
  const { profile } = await (await request.get('/api/settings')).json();
  expect(
    (await request.patch('/api/settings', { headers, data: { autoCommit: false } })).ok()
  ).toBeTruthy();
  try {
    await page.goto('/chat-history');
    const composer = page.getByRole('textbox', { name: 'Describe your meal' });
    await composer.fill('1.5x carbonara, no pancetta, add peas');
    await composer.press('Enter');
    const review = page.getByRole('region', { name: 'Meal preview' });
    const title = 'Carbonara with peas';
    await expect(review.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const confirm = review.getByRole('button', { name: 'Confirm and log' });
    await expect(confirm).toBeEnabled();
    const threadId = new URL(page.url()).searchParams.get('thread');
    const path = `/api/threads/${threadId}/messages`;
    const { pendingMessageId } = await (await request.get(path)).json();
    expect(pendingMessageId).toBeTruthy();
    const status = page.getByText('Your meal is still in review.', { exact: false });

    for (const [index, text] of ['Was this not logged?', 'Find it out.'].entries()) {
      await composer.fill(text);
      await composer.press('Enter');
      await expect(status).toHaveCount(index + 1);
      await expect(confirm).toBeEnabled();
      expect((await (await request.get(path)).json()).pendingMessageId).toBe(pendingMessageId);
    }
    await page.reload();
    await expect(page.getByRole('article', { name: 'Logged meal' })).toHaveCount(0);
    await expect(review.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await confirm.click();
    const card = page.getByRole('article', { name: 'Logged meal' });
    await expect(card.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect((await (await request.get(path)).json()).pendingMessageId).toBeNull();
  } finally {
    await request.patch('/api/settings', { headers, data: { autoCommit: profile.autoCommit } });
  }
});

test('persists adjusted carbonara nutrients', async ({ page, request }) => {
  await page.goto('/chat-history');
  const composer = page.getByRole('textbox', { name: 'Describe your meal' });
  await composer.fill('1.5x carbonara, no pancetta, add peas');
  await composer.press('Enter');
  const card = page.getByRole('article', { name: 'Logged meal' });
  await expect(card.getByRole('heading', { name: 'Carbonara with peas' })).toBeVisible();
  await expect(card.getByText('415 kcal')).toBeVisible();
  await expect(card.getByText(/350 g/u)).toBeVisible();
  const result = await (await request.get('/api/entries')).json();
  expect(result.entries).toMatchObject(
    expect.arrayContaining([
      expect.objectContaining({
        title: 'Carbonara with peas',
        items: [
          expect.objectContaining({
            kind: 'dish_adjustment',
            grams: 350,
            nutrients: { energy_kcal: 415, protein_g: 25 }
          })
        ]
      })
    ])
  );
});

test('confirmation keeps the reviewed nutrient values after a catalog change', async ({
  page,
  request,
  baseURL
}) => {
  const { connectDatabase } = await import('../../src/lib/server/db/client');
  const { foodNutrients, foods } = await import('../../src/lib/server/db/schema');
  const { and, eq } = await import('drizzle-orm');
  const { db, close } = connectDatabase(process.env.E2E_DATABASE_URL!);
  const headers = { Origin: baseURL! };
  const { profile } = await (await request.get('/api/settings')).json();
  try {
    const [rice] = await db
      .select({ id: foods.id })
      .from(foods)
      .where(and(eq(foods.sourceId, 'fixture'), eq(foods.sourceFoodId, 'rice')));
    const energy = and(
      eq(foodNutrients.foodId, rice!.id),
      eq(foodNutrients.nutrientId, 'energy_kcal')
    );
    const [original] = await db
      .select({ amount: foodNutrients.amount })
      .from(foodNutrients)
      .where(energy);
    await request.patch('/api/settings', { headers, data: { autoCommit: false } });
    try {
      await page.goto('/chat-history');
      const composer = page.getByRole('textbox', { name: 'Describe your meal' });
      await composer.fill('150 g cooked rice');
      await composer.press('Enter');
      const preview = page.getByRole('region', { name: 'Meal preview' });
      await expect(preview.getByText('180 kcal')).toBeVisible();
      await db.update(foodNutrients).set({ amount: 200 }).where(energy);
      await preview.getByRole('button', { name: 'Confirm and log' }).click();
      await expect(
        page.getByRole('article', { name: 'Logged meal' }).getByText('180 kcal')
      ).toBeVisible();
    } finally {
      await db.update(foodNutrients).set({ amount: original!.amount }).where(energy);
      await request.patch('/api/settings', { headers, data: { autoCommit: profile.autoCommit } });
    }
  } finally {
    await close();
  }
});

test('logs a clear meal and shows it on the Today page', async ({ page }) => {
  await page.goto('/chat-history');
  await page.getByRole('button', { name: '150 g cooked rice' }).click();
  await page.getByRole('textbox', { name: 'Describe your meal' }).press('Enter');
  await expect(
    page.getByRole('article', { name: 'Logged meal' }).getByText('180 kcal')
  ).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(
    page
      .getByRole('article', { name: 'Meal entry' })
      .getByRole('button', { name: 'Replace Cooked rice' })
  ).toBeVisible();
  await expect(page.getByTestId('energy_kcal')).toContainText('kcal');
});

test('replaces a draft item with a saved recipe before confirming', async ({
  page,
  request,
  baseURL
}) => {
  const headers = { Origin: baseURL! };
  const { foods } = await (await request.get('/api/foods?q=Peas')).json();
  const created = await request.post('/api/recipes', {
    headers,
    data: {
      name: 'Pea snack',
      servings: 1,
      ingredients: [{ kind: 'food', foodId: foods[0].id, quantity: 100, unit: 'g' }]
    }
  });
  expect(created.ok()).toBeTruthy();
  const settings = await (await request.get('/api/settings')).json();
  expect(
    (await request.patch('/api/settings', { headers, data: { autoCommit: false } })).ok()
  ).toBeTruthy();
  try {
    await page.goto('/chat-history');
    const composer = page.getByRole('textbox', { name: 'Describe your meal' });
    await composer.fill('150 g cooked rice');
    await composer.press('Enter');
    const review = page.getByRole('region', { name: 'Meal preview' });
    await expect(review.getByRole('heading', { name: 'Cooked rice', exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Replace Cooked rice' }).click();
    const replacement = page.getByRole('dialog', { name: 'Replace item' });
    await replacement.getByRole('searchbox').fill('Pea snack');
    await replacement.getByRole('searchbox').press('Enter');
    await replacement.getByRole('button', { name: /Pea snack/u }).click();
    await replacement.getByRole('spinbutton', { name: 'Servings' }).fill('2');
    await replacement.getByRole('button', { name: 'Replace item' }).click();
    await expect(review.getByRole('button', { name: 'Replace Pea snack' })).toBeFocused();
    await expect(review.getByRole('heading', { name: 'Pea snack', exact: true })).toBeVisible();
    await expect(review.getByText('2 servings', { exact: true })).toBeVisible();
    await expect(review.getByText('180 kcal')).toHaveCount(0);
    await review.getByRole('button', { name: 'Confirm and log' }).click();
    const card = page.getByRole('article', { name: 'Logged meal' });
    await expect(card.getByRole('button', { name: 'Replace Pea snack' })).toBeVisible();
    await expect(card.getByText('160 kcal')).toBeVisible();
  } finally {
    await request.patch('/api/settings', {
      headers,
      data: { autoCommit: settings.profile.autoCommit }
    });
  }
});

test('restores an interrupted meal review and replaces one item before logging', async ({
  page,
  request,
  baseURL
}) => {
  const { connectDatabase } = await import('../../src/lib/server/db/client');
  const { chatMessages, foods } = await import('../../src/lib/server/db/schema');
  const { eq } = await import('drizzle-orm');
  const { db, close } = connectDatabase(process.env.E2E_DATABASE_URL!);
  let threadId: string;
  try {
    const headers = { Origin: baseURL! };
    const response = await request.post('/api/threads', {
      headers,
      data: { title: 'Restaurant review' }
    });
    threadId = (await response.json()).thread.id;
    const catalog = await db.select().from(foods).where(eq(foods.sourceId, 'fixture'));
    const items = [
      { id: 'carbonara', confidence: 0.76 },
      { id: 'fries', confidence: 0.72 },
      { id: 'dip', confidence: 0.88 }
    ].map(({ id, confidence }) => ({
      kind: 'food',
      foodId: catalog.find(({ sourceFoodId }) => sourceFoodId === id)!.id,
      quantity: 1,
      unit: 'portion',
      confidence,
      assumptions: []
    }));
    const [prompt] = await db
      .insert(chatMessages)
      .values({
        threadId,
        role: 'assistant',
        content: 'Older single-item question',
        parts: [
          {
            type: 'pending',
            rawText: 'Restaurant review',
            confirmed: [],
            items: [],
            proposal: {
              reply: 'I found three matches.',
              title: 'Carbonara with fries and dip',
              needsClarification: false,
              meal: 'snack',
              items
            },
            clarification: {
              code: 'LOW_CONFIDENCE',
              question: 'Review the first item?',
              itemIndex: 0,
              options: []
            }
          }
        ]
      })
      .returning({ id: chatMessages.id });
    await db.insert(chatMessages).values({
      threadId,
      role: 'user',
      content: 'Confirmed meal review',
      parts: [{ type: 'turn', replyTo: prompt!.id }]
    });
  } finally {
    await close();
  }
  await page.goto('/chat-history?thread=' + threadId);
  const review = page.getByRole('region', { name: 'Clarification choices' });
  await expect(page.getByText('This turn was interrupted before a reply was saved.')).toBeVisible();
  await expect(review.getByText('Carbonara', { exact: true })).toBeVisible();
  await expect(review.getByText('French fries', { exact: true })).toBeVisible();
  await expect(review.getByText('145 g', { exact: true })).toBeVisible();
  await expect(review.getByText('Chipotle dip', { exact: true })).toBeVisible();
  await expect(review.getByText('Needs confirmation')).toHaveCount(2);
  await expect(review.getByRole('heading', { name: 'Carbonara with fries and dip' })).toBeVisible();
  await review.getByRole('button', { name: 'Replace Carbonara' }).click();
  const replacement = page.getByRole('dialog', { name: 'Replace item' });
  await replacement.getByRole('searchbox').fill('Peas');
  await replacement.getByRole('searchbox').press('Enter');
  await replacement.getByRole('button', { name: /Peas/u }).click();
  await replacement.getByRole('spinbutton', { name: 'Grams' }).fill('100');
  await replacement.getByRole('button', { name: 'Replace item' }).click();
  await expect(review.getByRole('button', { name: 'Replace Peas' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Logged meal' })).toHaveCount(0);
  await review.getByRole('spinbutton', { name: 'Grams for French fries' }).fill('160');
  await review.getByRole('button', { name: 'Confirm meal' }).click();
  const entry = page.getByRole('article', { name: 'Logged meal' });
  await expect(
    entry.getByRole('heading', { name: 'French fries, Peas, & Chipotle dip' })
  ).toBeVisible();
  await expect(entry.getByRole('button', { name: 'Replace Peas' })).toBeVisible();
  await expect(entry.getByRole('button', { name: 'Replace Carbonara' })).toHaveCount(0);
  await expect(entry.getByText(/160 g/u)).toBeVisible();
  await expect(entry.getByText('Chipotle dip', { exact: true })).toBeVisible();
  await expect(review).toHaveCount(0);
});

test('uses an estimated piece weight for fresh and pending chokladboll logs', async ({
  page,
  request,
  baseURL
}) => {
  const headers = { Origin: baseURL! };
  const { thread } = await (
    await request.post('/api/threads', { headers, data: { title: 'Chokladboll review' } })
  ).json();
  const database = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  const loggedAt = '2026-11-21T12:00:00+01:00';
  const rawText =
    'One standard-size chokladboll for 21 November, in addition to the earlier items.';
  try {
    await database`INSERT INTO food_sources (id, name, license, attribution, homepage)
      VALUES ('slv', 'Livsmedelsverket', 'CC0', 'Fixture', 'https://example.test')`;
    const [food] = await database`
      INSERT INTO foods (source_id, source_food_id, name, search_text, kind, category, source_version)
      VALUES ('slv', '1657', 'Chokladboll', 'chokladboll', 'generic', 'Choklad eller chokladprodukt', 'fixture')
      RETURNING id
    `;
    await database`INSERT INTO food_nutrients (food_id, nutrient_id, amount, unit)
      VALUES (${food!.id}, 'energy_kcal', 450, 'kcal')`;
    await database`INSERT INTO portions (food_id, label, unit, grams, is_default, source, source_url)
      VALUES (${food!.id}, 'Typical piece', 'st', 40, true, 'web', 'https://www.delicato.se/example')`;
    const parts = [
      {
        type: 'pending',
        rawText,
        confirmed: [],
        items: [],
        proposal: {
          reply: rawText,
          loggedAt,
          needsClarification: false,
          items: [
            { kind: 'food', foodId: food!.id, quantity: 1, unit: 'portion', confidence: 0.95 }
          ]
        },
        clarification: {
          code: 'UNIT_UNRESOLVED',
          question: 'How many grams of Chokladboll did you have?',
          itemIndex: 0,
          options: [],
          additional: []
        }
      }
    ];
    await database`INSERT INTO chat_messages (thread_id, role, content, parts)
      VALUES (${thread.id}, 'assistant', ${rawText}, ${JSON.stringify(parts)}::jsonb)`;
  } finally {
    await database.end();
  }

  await page.goto(`/chat-history?thread=${thread.id}`);
  await expect(page.getByText('Estimated weight: 40 g per piece (www.delicato.se).')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and log' }).click();
  const entries = page.getByRole('article', { name: 'Logged meal' });
  await expect(entries.first().getByText('180 kcal')).toBeVisible();
  const result = await (await request.get('/api/entries?date=2026-11-21')).json();
  expect(result.entries).toContainEqual(
    expect.objectContaining({
      loggedAt: new Date(loggedAt).toISOString(),
      items: [expect.objectContaining({ label: 'Chokladboll', grams: 40 })]
    })
  );

  const composer = page.getByRole('textbox', { name: 'Describe your meal' });
  await composer.fill('2 chokladboll');
  await composer.press('Enter');
  await expect(entries).toHaveCount(2);
  await expect(entries.last().getByText('360 kcal', { exact: true })).toBeVisible();
  await expect(entries.last().getByText(/80 g\s*· catalog/u)).toBeVisible();
});
