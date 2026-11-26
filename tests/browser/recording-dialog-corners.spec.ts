import { expect, test } from '@playwright/test';
import { expectCorners } from './corner-geometry';

for (const width of [1280, 390]) {
  test(`recording settings frame follows the bottom cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto('/#replays');
    await page.getByRole('button', { name: '录像设置', exact: true }).click();
    const dialog = page.locator('.recording-settings-dialog');
    await expect(dialog).toHaveCSS('border-radius', width === 390 ? '52px' : '56px');
    await expect(dialog).toHaveCSS('corner-shape', 'superellipse(2)');
    const preview = dialog.locator('.display-preview-slot');
    await expect(preview).toHaveCSS('border-radius', '28px');
    await expect(preview).toHaveCSS('corner-shape', 'superellipse(2)');
    const body = dialog.locator('.dialog-body');
    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(await body.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const cards = body.locator('.recording-settings > [data-slot=card]');
    await expectCorners(
      cards.nth(width === 390 ? 3 : 2),
      '.recording-settings-dialog',
      ['BottomLeft'],
      0.5,
    );
    await expectCorners(cards.last(), '.recording-settings-dialog', ['BottomRight'], 0.5);
  });
}
