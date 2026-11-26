import { expect, test } from '@playwright/test';

test('encounter totals align with the table text on desktop and narrow screens', async ({
  page,
}) => {
  await page.goto('/#radar');
  await page.locator('.session-actions button').first().click();
  await page.getByRole('button', { name: '9神来啦', exact: true }).click();
  const dialog = page.locator('.profile-dialog');
  await dialog.getByRole('tab', { name: /相遇记录|Encounters/ }).click();
  const items = dialog.locator('.profile-encounter-summary > div');
  await expect(items).toHaveCount(4);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    for (const item of await items.all())
      await expect(item).toHaveCSS('padding-inline-start', '16px');
    const first = await items.first().locator('dt').boundingBox();
    const head = dialog.locator('.profile-encounters-table th').first();
    const textStart = await head.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    });
    expect(Math.abs(first!.x - textStart)).toBeLessThanOrEqual(1);
  }
});
