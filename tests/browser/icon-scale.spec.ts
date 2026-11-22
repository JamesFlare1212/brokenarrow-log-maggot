import { expect, test } from '@playwright/test';

for (const width of [1200, 390]) {
  test(`overview icons follow their surrounding UI at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/#current');
    const title = page.locator('.recent-card [data-slot="card-title"]');
    const glyph = title.locator('svg');
    await expect(glyph).toBeVisible();
    await expect(glyph).toHaveCSS(
      'width',
      await title.evaluate((el) => getComputedStyle(el).fontSize),
    );
    const compact = page.locator('.quick-tools button[data-size="icon-sm"]').first();
    await expect(compact.locator('svg')).toHaveCSS('width', '14px');
    expect((await compact.boundingBox())!.width).toBeGreaterThan(24);
    const media = page.locator('.dashboard [data-slot="empty-icon"]').first();
    await expect(media).toHaveCSS('width', '48px');
    await expect(media.locator('svg')).toHaveCSS('width', '20px');
  });
}
