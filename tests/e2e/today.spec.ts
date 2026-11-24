import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_DATABASE_URL, 'Requires an isolated Playwright database.');

test('opens a saved chat for each date and updates that day’s totals after confirmation', async ({
  page,
  request,
  baseURL
}) => {
  const date = '2199-10-17';
  const nextDate = '2199-10-18';
  const headers = { Origin: baseURL! };
  const { profile } = await (await request.get('/api/settings')).json();
  expect(
    (await request.patch('/api/settings', { headers, data: { autoCommit: false } })).ok()
  ).toBeTruthy();
  try {
    await page.goto(`/today?date=${date}`);
    const composer = page.getByRole('textbox', { name: 'Describe your meal' });
    const log = page.getByRole('button', { name: 'Log', exact: true });
    await expect(composer).toBeHidden();
    await log.click();
    await composer.fill('150 g cooked rice');
    await composer.press('Enter');
    const confirm = page.getByRole('button', { name: 'Confirm and log' });
    await expect(confirm).toBeVisible();

    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.getByLabel('Log date')).toHaveValue(nextDate);
    await expect(composer).toBeEnabled();
    await expect(confirm).toBeHidden();
    await expect(page.getByText('150 g cooked rice', { exact: true })).toBeHidden();

    await page.getByRole('button', { name: 'Previous day' }).click();
    await page.reload();
    await expect(page.getByLabel('Log date')).toHaveValue(date);
    await confirm.click();
    await expect(page.getByTestId('energy_kcal')).toHaveText('180 kcal');
    await expect(page.getByRole('article', { name: 'Meal entry' })).toHaveCount(1);
    const { entries } = await (await request.get(`/api/entries?date=${nextDate}`)).json();
    expect(entries).toHaveLength(0);
    const { threads } = await (await request.get(`/api/threads?date=${date}`)).json();
    expect(threads).toEqual([expect.objectContaining({ date })]);
    const repeated = await request.post('/api/threads', { headers, data: { date } });
    expect(await repeated.json()).toMatchObject({ thread: { id: threads[0].id, date } });
  } finally {
    await request.patch('/api/settings', { headers, data: { autoCommit: profile.autoCommit } });
  }
});

test('adds, edits, replaces and deletes food on a selected day', async ({ page }) => {
  await page.goto('/today?date=2199-10-10');
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add food manually' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Add food' });
  await expect(dialog.getByRole('searchbox')).toBeFocused();
  await dialog.getByRole('searchbox').fill('Peas');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await dialog.getByRole('button', { name: /Peas/u }).click();
  await dialog.getByRole('button', { name: 'Replace Peas' }).click();
  await expect(dialog.getByRole('searchbox')).toBeFocused();
  await dialog.getByRole('searchbox').fill('Cooked rice');
  await dialog.getByRole('searchbox').press('Enter');
  await dialog.getByRole('button', { name: /Cooked rice/u }).click();
  await dialog.getByRole('spinbutton', { name: 'Grams' }).fill('150');
  await dialog.getByLabel('Meal').selectOption('snack');
  await dialog.getByRole('button', { name: 'Log entry' }).click();
  await expect(add).toBeFocused();
  await expect(page.getByTestId('energy_kcal')).toHaveText('180 kcal');
  const groups = page.getByRole('region', { name: 'Food groups' });
  await groups.getByText('Food groups', { exact: true }).click();
  await expect(groups.getByText('45 g', { exact: true })).toBeVisible();
  await expect(groups.getByText('None', { exact: true })).toBeVisible();
  const entry = page.getByRole('article', { name: 'Meal entry' });
  await expect(page.getByRole('heading', { name: 'Snack', exact: true })).toBeVisible();
  await expect(entry.getByRole('heading', { name: 'Cooked rice', exact: true })).toBeVisible();
  await expect(entry.locator('time')).toBeVisible();
  await expect(entry.getByText(/confidence/u)).toHaveCount(0);
  await entry.getByRole('button', { name: 'Edit portion for Cooked rice' }).click();
  await entry.getByRole('spinbutton', { name: 'Grams' }).fill('200');
  await entry.getByRole('button', { name: 'Save portion' }).click();
  await expect(page.getByTestId('energy_kcal')).toHaveText('240 kcal');
  await expect(groups.getByText('60 g', { exact: true })).toBeVisible();
  await entry.getByRole('button', { name: 'Replace Cooked rice' }).click();
  const replacement = page.getByRole('dialog', { name: 'Replace item' });
  await expect(replacement.getByRole('searchbox')).toBeFocused();
  await replacement.getByRole('searchbox').fill('Peas');
  await replacement.getByRole('searchbox').press('Enter');
  await replacement.getByRole('button', { name: /Peas/u }).click();
  await expect(replacement.getByRole('spinbutton', { name: 'Grams' })).toHaveValue('200');
  await replacement.getByRole('button', { name: 'Replace item' }).click();
  await expect(entry.getByRole('button', { name: 'Replace Peas' })).toBeFocused();
  await expect(entry.getByRole('button', { name: 'Replace Cooked rice' })).toHaveCount(0);
  await expect(page.getByTestId('energy_kcal')).toHaveText('160 kcal');
  await page.reload();
  await expect(entry.getByRole('button', { name: 'Replace Peas' })).toBeVisible();
  await expect(entry.getByRole('heading', { name: 'Peas', exact: true })).toBeVisible();
  await expect(page.getByTestId('energy_kcal')).toHaveText('160 kcal');
  await entry.getByLabel('Entry actions').click();
  await entry.getByLabel('Meal name').fill('Afternoon peas');
  await entry.getByRole('button', { name: 'Save name' }).click();
  await expect(entry.getByRole('heading', { name: 'Afternoon peas', exact: true })).toBeVisible();
  await page.reload();
  await expect(entry.getByRole('heading', { name: 'Afternoon peas', exact: true })).toBeVisible();
  await expect(page.getByTestId('energy_kcal')).toHaveText('160 kcal');
  await entry.getByLabel('Entry actions').click();
  await entry.getByLabel('Move to meal').selectOption('dinner');
  await expect(page.getByRole('heading', { name: 'Dinner', exact: true })).toBeVisible();
  await entry.getByLabel('Entry actions').click();
  await entry.getByRole('button', { name: 'Delete entry' }).click();
  await expect(page.getByRole('heading', { name: 'No entries for this day' })).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByLabel('Log date')).toHaveValue('2199-10-11');
});

test('logs a grouped message as separate named meals', async ({ page }) => {
  await page.goto('/today?date=2199-10-19');
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Describe your meal' });
  await composer.fill('Dinner: 100 g peas\n\nBreakfast\n150 g cooked rice\n\nLunch\n150 g pasta');
  await composer.press('Enter');
  const meals = page.getByRole('region', { name: 'Meals' });
  await expect(meals.getByRole('article', { name: 'Meal entry' })).toHaveCount(3);
  for (const meal of ['Breakfast', 'Lunch', 'Dinner']) {
    await expect(meals.getByRole('heading', { name: meal, exact: true })).toBeVisible();
  }
  await expect(meals.getByRole('heading', { name: 'Other', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('article', { name: 'Logged meal' })).toHaveCount(3);
});

test('shows snapshot contributors and clears stale meals when a date fails', async ({
  page,
  request,
  baseURL
}) => {
  const date = '2199-11-10';
  const headers = { Origin: baseURL! };
  const items = [];
  for (const food of [
    {
      name: 'Vitamin fixture',
      per100g: {
        energy_kcal: 100,
        vitamin_d_ug: 6.4,
        iron_mg: 0,
        sodium_mg: 2500,
        omega3_epa_mg: 200
      }
    },
    { name: 'Label fixture', per100g: { energy_kcal: 200 } }
  ]) {
    const result = await request.post('/api/foods', { headers, data: food });
    expect(result.status()).toBe(201);
    const { food: created } = await result.json();
    items.push({ kind: 'food', foodId: created.id, quantity: 100, unit: 'g', confidence: 1 });
  }
  const result = await request.post('/api/entries', {
    headers,
    data: { date, meal: 'lunch', items }
  });
  expect(result.status()).toBe(201);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/today?date=${date}`);
  await expect(page.getByTestId('energy_kcal')).toHaveText('300 kcal');
  const nutrients = page.getByRole('region', { name: 'All nutrients' });
  const vitamin = nutrients.getByRole('button', { name: /^Vitamin D/u });
  await expect(nutrients.getByRole('button', { name: /^Sodium/u })).toContainText('Over limit');
  const lists = nutrients.getByRole('list');
  await expect(lists.locator('.track')).toHaveCount(await lists.getByRole('button').count());
  await expect(vitamin.locator('.fill')).toHaveAttribute('style', /width: 64%/u);
  await expect(vitamin).toContainText('6.4 µg');
  await expect(vitamin).toContainText('Target 10 µg');
  await expect(vitamin).toContainText('64% of target');
  await expect(vitamin).toContainText('1 of 2 items');
  await expect(vitamin).not.toContainText(/at least|≥/iu);
  await vitamin.click();
  const detail = page.getByRole('dialog', { name: 'Vitamin D' });
  await expect(detail.getByText('Data for 1 of 2 logged items')).toBeVisible();
  await expect(detail.getByText('Vitamin fixture')).toBeVisible();
  await expect(detail.getByText('Label fixture')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(vitamin).toBeFocused();
  const iron = nutrients.getByRole('button', { name: /^Iron/u });
  await expect(iron).toContainText('0 mg');
  await expect(iron).toContainText('1 of 2 items');
  await expect(iron.locator('.fill')).toHaveAttribute('style', /width: 0%/u);
  const epa = nutrients.getByRole('button', { name: /^Omega-3 EPA/u });
  await expect(epa).toContainText('200 mg');
  await expect(epa).toContainText('No numeric target');
  await expect(epa.locator('.track')).toHaveClass(/unavailable/u);
  const nutrientSearch = nutrients.getByRole('searchbox', { name: 'Find a nutrient' });
  await nutrientSearch.fill('trans');
  const transFat = nutrients.getByRole('button', { name: /^Trans fat/u });
  await expect(transFat).toContainText('No data');
  await expect(transFat.locator('.track')).toHaveClass(/unavailable/u);
  await transFat.click();
  const transFatDetail = page.getByRole('dialog', { name: 'Trans fat' });
  await expect(transFatDetail.getByText('Its amount is unknown.', { exact: false })).toBeVisible();
  await expect(transFatDetail.getByText('Keep intake as low as possible.')).toBeVisible();
  await page.keyboard.press('Escape');
  await nutrientSearch.clear();
  await nutrients.getByRole('button', { name: /^Energy/u }).click();
  await expect(page.getByRole('dialog', { name: 'Energy' }).getByText('300 kcal')).toBeVisible();
  await page.keyboard.press('Escape');

  const nextDay = '**/api/totals/day?date=2199-11-11';
  await page.route(nextDay, (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'DAY_UNAVAILABLE', message: 'Could not load the day.' } }
    })
  );
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load the day.');
  await expect(page.getByLabel('Log date')).toHaveValue('2199-11-11');
  await expect(page.getByTestId('energy_kcal')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Meal entry' })).toHaveCount(0);
  await page.unroute(nextDay);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'No entries for this day' })).toBeVisible();
});
