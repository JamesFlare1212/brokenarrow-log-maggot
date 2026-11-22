import { expect, test } from '@playwright/test';

for (const [route, sidebar] of [
  ['current', 'workspace-sidebar'],
  ['settings/appearance', 'settings-sidebar'],
] as const) {
  test(`${route} leaves no desktop gutter after sidebar collapse`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/#' + route);
    const toggle = page.locator(`button[aria-controls="${sidebar}"][aria-expanded]`);
    const inset = toggle.locator('xpath=ancestor::main[1]');
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    await expect.poll(async () => (await inset.boundingBox())?.x).toBeGreaterThan(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await inset.boundingBox())?.x).toBe(0);
    await expect.poll(async () => (await inset.boundingBox())?.width).toBe(1200);
  });
}
