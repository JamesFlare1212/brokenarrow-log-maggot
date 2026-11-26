import { expect, test } from '@playwright/test';

test('radar player statistics scroll inside the rounded report frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto('/#radar');
  await page.locator('.session-actions button').first().click();
  await page.locator('.player-card-trigger').first().click();
  const frame = page.locator('.report-match-table');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveCSS('border-radius', '36px');
  await expect(frame).toHaveCSS('corner-shape', 'superellipse(2)');
  await expect(frame.locator('tbody button').first()).toBeVisible();
  const firstColumn = [frame.locator('thead th').first(), frame.locator('tbody td').first()];
  for (const cell of firstColumn) await expect(cell).toHaveCSS('padding-inline-start', '20px');
  await page.setViewportSize({ width: 390, height: 720 });
  for (const cell of firstColumn) await expect(cell).toHaveCSS('padding-inline-start', '16px');
  await frame.focus();
  await frame.press('ArrowRight');
  await expect.poll(() => frame.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});
