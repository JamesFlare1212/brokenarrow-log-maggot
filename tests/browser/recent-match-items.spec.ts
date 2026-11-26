import { expect, test } from '@playwright/test';

test('recent match items open the dialog from the whole row and restore keyboard focus', async ({
  page,
}) => {
  await page.goto('/#current');
  const recent = page.locator('.recent-matches');
  const rows = recent.locator('tbody tr');
  const first = rows.first().getByRole('button');
  await expect(recent.getByRole('columnheader')).toHaveText(['模式', '地图', 'ELO 变化']);
  await expect(rows).toHaveCount(3);
  await expect(rows.first().getByRole('cell')).toHaveText(['排位', 'River', '+35.76']);
  const modeBadge = rows.first().locator('[data-slot=badge]');
  await expect(modeBadge).toHaveCSS('height', '20px');
  await expect(modeBadge).toHaveCSS('border-radius', '8px');
  await expect(modeBadge).toHaveCSS('corner-shape', 'superellipse(2)');
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await recent.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (width === 1200) await rows.first().getByRole('cell').last().click();
    else {
      await first.focus();
      await first.press('Enter');
    }
    const dialog = page.locator('.match-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click();
    if (width === 390) await expect(first).toBeFocused();
  }
});

for (const width of [1120, 390]) {
  test(`recent matches retain card and row heights in loading preview at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/#current');
    const card = page.locator('.recent-card');
    await expect(card.getByRole('button', { name: 'River' })).toBeVisible();
    const heights = () =>
      page
        .locator('.recent-card, .recent-matches tbody tr')
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().height),
        );
    const loaded = await heights();
    await page.getByRole('button', { name: '开发工具', exact: true }).click();
    const toggle = page.getByRole('switch', { name: '加载状态' });
    await toggle.click();
    await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(9);
    expect(await heights()).toEqual(loaded);
    await toggle.click();
    await expect(card.getByRole('button', { name: 'River' })).toBeVisible();
    expect(await heights()).toEqual(loaded);
  });
}

test('archive map hover keeps the entire underline visible and opens its match', async ({
  page,
}) => {
  await page.goto('/#archive');
  const map = page.locator('.archive-card-map[data-match-open="9485454"]');
  await map.hover();
  await expect(map).toHaveCSS('text-decoration-line', 'underline');
  await expect(map).toHaveCSS('overflow', 'visible');
  await expect(map).toHaveCSS('overflow-wrap', 'anywhere');
  await map.focus();
  await map.press('Enter');
  await expect(page).toHaveURL(/#archive\/match\/9485454$/);
});

test('archive player hover keeps the rounded focus target from clipping the underline', async ({
  page,
}) => {
  await page.goto('/#archive');
  const player = page.locator('.archive-card-player').filter({ hasText: 'AksodFlare' }).first();
  await player.hover();
  await expect(player).toHaveCSS('text-decoration-line', 'underline');
  await expect(player).toHaveCSS('overflow', 'visible');
  await expect(player.locator('span')).toHaveCSS('text-overflow', 'ellipsis');
  await player.click();
  await expect(page.locator('.profile-dialog')).toBeVisible();
  await expect(page.locator('.match-dialog')).toHaveCount(0);
});
