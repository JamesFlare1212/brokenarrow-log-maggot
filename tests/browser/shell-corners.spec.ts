import { expect, test } from '@playwright/test';
import { expectButtonShape } from './button-shape';
import { expectCorners } from './corner-geometry';

for (const [width, height] of [
  [1280, 850],
  [900, 600],
] as const) {
  test(`the account and development launcher use continuous command corners at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#current');
    const account = page.locator('.topbar-actions button:has(> [data-slot=avatar])');
    await account.hover();
    await expectButtonShape(account);
    await expectCorners(account.locator('[data-slot=avatar-fallback]'), '[data-slot=avatar]', [
      'TopRight',
      'BottomRight',
    ]);
    const dock = page.locator('.development-tools-launcher');
    const handle = dock.locator('.development-tools-handle');
    await handle.hover();
    await expect(dock).toHaveCSS('border-radius', '17px');
    await expectButtonShape(handle);
    const trigger = dock.locator('[data-slot=popover-trigger]');
    await trigger.press('Enter');
    await expectButtonShape(trigger);
    await expect(page.locator('.development-tools-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

test('the service badge and full-width check button use the shared button shape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto('/#current');
  const trigger = page.locator('.topbar-health [data-slot=popover-trigger]');
  await trigger.hover();
  await expectButtonShape(trigger);
  await trigger.click();
  await expectButtonShape(trigger);
  const popover = '[data-slot=popover-content]:has(.health-checks)';
  await expect(page.locator(popover)).toHaveCSS('border-radius', '16px');
  const action = page.locator(popover).getByRole('button');
  await expectButtonShape(action);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expectButtonShape(trigger);
});

test.describe('touch layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the large compact archive filter button retains its shape with a trailing badge', async ({
    page,
  }) => {
    await page.goto('/#archive');
    const trigger = page.locator('.archive-compact-actions button:has(> [data-slot=badge])');
    await trigger.tap();
    await expectButtonShape(trigger);
    await expect(trigger.locator('[data-slot=badge]')).toHaveCSS('height', '24px');
    await expect(page.locator('.archive-filter-popover')).toBeVisible();
  });
});
