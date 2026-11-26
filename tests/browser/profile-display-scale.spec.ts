import { expect, test } from '@playwright/test';
import { expectCorners } from './corner-geometry';

test('JamesFlare preferences align at native 150% display scaling', async ({
  playwright,
  baseURL,
}) => {
  const browser = await playwright.chromium.launch({
    channel: process.env.BA_BROWSER_CHANNEL || undefined,
    args: ['--force-device-scale-factor=1.5'],
  });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1056, height: 970 } });
    await page.goto('/#archive/match/9485454');
    const external = page.getByRole('button', { name: '在 BATrace 打开', exact: true });
    await expect(external).toBeVisible();
    await expect(external).not.toHaveAttribute('data-slot', 'tooltip-trigger');
    await external.focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.goto('/#radar');
    await page.locator('.session-actions button').first().click();
    await page.getByRole('button', { name: 'JamesFlare', exact: true }).press('Enter');
    const card = page.locator('.profile-dialog .profile-preferences');
    await expect(card).toHaveAttribute('aria-busy', 'false');
    await expect(card.locator('.profile-category-list')).toBeVisible();
    await expectCorners(card, '.profile-dialog', ['BottomRight'], 0.5);
    const gaps = await card.evaluate((el) => {
      const outer = el.closest('.profile-dialog')!.getBoundingClientRect();
      const inner = el.getBoundingClientRect();
      return { right: outer.right - inner.right, bottom: outer.bottom - inner.bottom };
    });
    expect(Math.abs(gaps.right - gaps.bottom)).toBeLessThan(0.5);
    const next = page.locator('.profile-dialog .profile-analysis-sidebar .maggot-card');
    const body = page.locator('.profile-dialog .dialog-body');
    await expect
      .poll(
        async () =>
          (await next.boundingBox())!.y -
          (await body.boundingBox())!.y -
          (await body.boundingBox())!.height,
      )
      .toBeGreaterThanOrEqual(1);
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
  } finally {
    await browser.close();
  }
});
