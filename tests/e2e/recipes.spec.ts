import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_DATABASE_URL, 'Requires an isolated Playwright database.');

test('creates a recipe from a catalog ingredient and logs a serving', async ({ page, request }) => {
  await page.goto('/recipes');
  await page.getByRole('button', { name: 'New recipe' }).click();
  const name = `Rice bowl ${crypto.randomUUID().slice(0, 5)}`;
  await page.getByRole('textbox', { name: 'Recipe name' }).fill(name);
  const picker = page.getByRole('searchbox', { name: 'Find an ingredient' });
  await picker.fill('Cooked rice');
  await picker.press('Enter');
  await page.getByRole('button', { name: /Cooked rice/u }).click();
  await page.getByRole('spinbutton', { name: 'Quantity' }).fill('400');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  const detail = page.getByRole('article', { name: 'Recipe details' });
  await expect(detail.getByRole('heading', { name })).toBeVisible();
  await expect(detail.getByText('240 kcal')).toBeVisible();
  await detail.getByRole('button', { name: 'Log recipe' }).click();
  await expect(detail.getByText('Logged in Today.')).toBeVisible();
  const result = await (await request.get('/api/entries')).json();
  expect(result.entries.flatMap((entry: { items: unknown[] }) => entry.items)).toMatchObject(
    expect.arrayContaining([
      expect.objectContaining({ label: name, provenance: 'recipe', grams: 200 })
    ])
  );
});
