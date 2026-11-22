import { expect, test } from '@playwright/test';

test('recent match items open the dialog from the whole row and restore keyboard focus', async ({
  page,
}) => {
  await page.goto('/#current');
  const recent = page.locator('.recent-matches');
  const first = recent.getByRole('listitem').first().getByRole('button');
  await expect(first).toHaveAttribute('data-slot', 'item');
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 850 });
    const box = (await first.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(68);
    if (width === 1200) await first.click({ position: { x: box.width - 5, y: box.height / 2 } });
    else {
      await first.focus();
      await first.press('Enter');
    }
    const dialog = page.locator('.match-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click();
    await expect(first).toBeFocused();
  }
});

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
