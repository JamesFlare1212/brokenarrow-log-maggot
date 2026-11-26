import { expect, test } from '@playwright/test';

test('category toggle previews seven categories until the report supplies its count', async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/__fixtures/rpc', async (route) => {
    if (route.request().postDataJSON().method !== 'players.report') return route.continue();
    const response = await route.fetch();
    const json = await response.json();
    json.value.categories = json.value.categories.slice(0, 4);
    await pending;
    await route.fulfill({ response, json });
  });
  try {
    await page.goto('/#radar');
    await page.locator('.session-actions button').first().click();
    await page.getByRole('button', { name: 'JamesFlare', exact: true }).click();
    const card = page.locator('.profile-dialog .profile-preferences');
    const toggle = card.getByRole('button', { name: '展开全部 7 个类别' });
    const rows = card.locator('.profile-category-list li');
    await expect(toggle).toBeVisible();
    await expect(rows).toHaveCount(3);
    await toggle.click();
    await expect(rows).toHaveCount(7);
    release();
    await expect(rows).toHaveCount(4);
    await card.getByRole('button', { name: '收起' }).click();
    await expect(card.getByRole('button', { name: '展开全部 4 个类别' })).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
