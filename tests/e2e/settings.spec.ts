import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_DATABASE_URL, 'Requires an isolated Playwright database.');

test('shows connected and disconnected provider states and searches thread history', async ({
  page
}) => {
  await page.goto('/settings');
  const provider = page.getByRole('region', { name: 'Provider settings' });
  await expect(provider.getByText('Connected', { exact: true })).toBeVisible();
  await provider.getByRole('button', { name: 'Test connection' }).click();
  await expect(provider.getByText('Connection test passed.')).toBeVisible();
  await provider.getByRole('combobox', { name: 'Provider' }).selectOption('codex');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(provider.getByText('Disconnected', { exact: true })).toBeVisible();
  await expect(provider.getByText('npx @openai/codex login', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await page.getByRole('link', { name: 'Chat history' }).click();
  await expect(page.getByRole('heading', { name: 'Chat history', level: 1 })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Describe your meal' });
  await input.fill('Check provider with cooked rice');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('PROVIDER_NOT_CONNECTED');
  const history = page.getByRole('searchbox', { name: 'Search history' });
  await history.fill('cooked rice');
  await history.press('Enter');
  await expect(
    page.getByRole('button', { name: /Check provider with cooked rice/u }).first()
  ).toBeVisible();

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await provider.getByRole('combobox', { name: 'Provider' }).selectOption('default');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(provider.getByText('Connected', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export my data' }).click();
  expect((await download).suggestedFilename()).toBe('nutrimaxxlent-export.json');
});

test('shows an actionable empty catalog state', async ({ page }) => {
  await page.route('**/api/foods?*', (route) => route.fulfill({ json: { foods: [], count: 0 } }));
  await page.goto('/foods');
  await expect(page.getByRole('heading', { name: 'The food catalog is empty' })).toBeVisible();
  await expect(page.getByText('pnpm data:refresh slv', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add custom food' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Food name' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add custom food' })).toBeFocused();
});
