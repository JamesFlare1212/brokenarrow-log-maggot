import { expect, test } from '@playwright/test';
import { expectCorners } from './corner-geometry';

for (const [width, height] of [
  [1280, 850],
  [900, 600],
] as const) {
  test(`the account and development launcher keep their nested corners at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#current');
    const account = page.locator('.topbar-actions button:has(> [data-slot=avatar])');
    await account.hover();
    await expectCorners(account.locator('[data-slot=avatar]'), 'button', ['TopLeft', 'BottomLeft']);
    await expectCorners(account.locator('[data-slot=avatar-fallback]'), '[data-slot=avatar]', [
      'TopRight',
      'BottomRight',
    ]);
    const dock = page.locator('.development-tools-launcher');
    const handle = dock.locator('.development-tools-handle');
    await handle.hover();
    await expect(dock).toHaveCSS('border-radius', '17px');
    await expect(handle).toHaveCSS('border-radius', '12px');
    await expectCorners(handle, '.development-tools-launcher', ['TopLeft', 'BottomLeft']);
    const trigger = dock.locator('[data-slot=popover-trigger]');
    await trigger.press('Enter');
    await expect(trigger).toHaveCSS('border-radius', '12px');
    await expect(page.locator('.development-tools-panel')).toBeVisible();
    await expectCorners(trigger, '.development-tools-launcher', ['TopRight', 'BottomRight']);
    await expectCorners(trigger.locator('[data-slot=badge]'), 'button', [
      'TopRight',
      'BottomRight',
    ]);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

test('the service badge and full-width check button follow the painted end corners', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto('/#current');
  const trigger = page.locator('.topbar-health [data-slot=popover-trigger]');
  await trigger.hover();
  await expect(trigger).toHaveCSS('border-radius', '12px');
  await trigger.click();
  await expect(trigger).toHaveCSS('border-radius', '12px');
  await expectCorners(trigger.locator('[data-slot=badge]'), 'button', ['TopRight', 'BottomRight']);
  const popover = '[data-slot=popover-content]:has(.health-checks)';
  await expect(page.locator(popover)).toHaveCSS('border-radius', '16px');
  const action = page.locator(popover).getByRole('button');
  await expectCorners(action, popover, ['BottomLeft', 'BottomRight']);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('border-radius', '12px');
});

test.describe('touch layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the large compact archive filter button follows the trailing badge', async ({ page }) => {
    await page.goto('/#archive');
    const trigger = page.locator('.archive-compact-actions button:has(> [data-slot=badge])');
    await trigger.tap();
    await expect(trigger).toHaveCSS('border-radius', '16px');
    await expect(trigger.locator('[data-slot=badge]')).toHaveCSS('height', '24px');
    await expect(page.locator('.archive-filter-popover')).toBeVisible();
    await expectCorners(trigger.locator('[data-slot=badge]'), 'button', [
      'TopRight',
      'BottomRight',
    ]);
  });
});
