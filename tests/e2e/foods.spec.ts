import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_DATABASE_URL, 'Requires an isolated Playwright database.');

test('filters foods and logs a dish and a branded product', async ({ page, request }) => {
  await page.goto('/foods');
  const search = page.getByRole('searchbox', { name: 'Search foods' });
  await search.fill('Carbonara');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^Carbonara/u }).click();
  await expect(page.getByRole('heading', { name: 'Components' })).toBeVisible();
  await expect(page.getByText('Pancetta', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log food' }).click();
  await expect(page.getByText('Logged in Today.')).toBeVisible();

  await search.fill('0000000000501');
  await search.press('Enter');
  await page.getByRole('button', { name: /^Barebells Chocolate/u }).click();
  await expect(page.getByText('Barcode 0000000000501')).toBeVisible();
  await page.getByRole('button', { name: 'Log food' }).click();
  await expect(page.getByText('Logged in Today.')).toBeVisible();
  const stored = await (await request.get('/api/entries')).json();
  expect(stored.entries.flatMap((entry: { items: unknown[] }) => entry.items)).toMatchObject(
    expect.arrayContaining([
      expect.objectContaining({ label: 'Carbonara', grams: 100 }),
      expect.objectContaining({ label: 'Barebells Chocolate', grams: 55 })
    ])
  );
});
