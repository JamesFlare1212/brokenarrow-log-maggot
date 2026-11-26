import { expect, test } from '@playwright/test';

test('the player disclosure fills its cell without capturing awards or stats', async ({ page }) => {
  await page.goto('/#archive/match/9484902');
  const details = page.locator('.match-detail-page');
  const cell = details
    .getByRole('cell')
    .filter({ has: page.getByRole('button', { name: 'AksodFlare', exact: true }) });
  const toggle = cell.getByRole('button', { name: 'AksodFlare', exact: true });
  for (const width of [1800, 900]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(toggle).toBeVisible();
    await cell.scrollIntoViewIfNeeded();
    const bounds = (await cell.boundingBox())!;
    const button = (await toggle.boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(button[key] - bounds[key])).toBeLessThanOrEqual(1);
    }
    const name = cell.locator('.match-player-name');
    await toggle.hover({ position: { x: 32, y: 14 } });
    await expect(name).not.toHaveAttribute('data-slot', 'tooltip-trigger');
    await toggle.click({ button: 'right', position: { x: 32, y: 14 } });
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('#');
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await toggle.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await cell.click({ position: { x: bounds.width - 3, y: 3 } });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = details.locator('.match-player-details');
    await expect(panel.getByRole('button')).toHaveCount(0);
    await cell.click({ position: { x: 3, y: bounds.height - 3 } });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  await toggle.focus();
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await cell.locator('xpath=following-sibling::td[1]').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  const award = details.locator('.match-player-cell .match-award-button').first();
  await award.hover();
  const hint = page.locator('[data-slot="tooltip-content"]');
  await expect(hint).toHaveCSS('border-radius', '36px');
  await expect(hint).toHaveCSS('corner-shape', 'superellipse(2)');
  await award.click();
  const pinned = page.locator('[data-slot="popover-content"]');
  await expect(pinned).toHaveCSS('border-radius', '36px');
  await expect(pinned).toHaveCSS('corner-shape', 'superellipse(2)');
  await expect(award).toHaveAttribute('aria-expanded', 'true');
  await expect(details.locator('.match-player-expanded')).toHaveCount(0);
});

for (const scale of [1, 1.5]) {
  test(`the last player stays in place when details open and close at ${scale}x`, async ({
    playwright,
    baseURL,
  }) => {
    const browser = await playwright.chromium.launch({
      channel: process.env.BA_BROWSER_CHANNEL || undefined,
      args: [`--force-device-scale-factor=${scale}`],
    });
    try {
      const page = await browser.newPage({
        baseURL,
        viewport: { width: 1010, height: 825 },
        deviceScaleFactor: scale,
      });
      await page.goto('/#archive/match/9484902');
      const toggle = page.getByRole('button', { name: 'KAMI', exact: true });
      await expect(toggle).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const row = toggle.locator('xpath=ancestor::tr');
      await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const geometry = () =>
        row.evaluate((el) => {
          const rect = (r: DOMRect) => [r.x, r.y, r.width, r.height];
          return {
            name: rect(el.querySelector('.match-player-name')!.getBoundingClientRect()),
            badges: Array.from(el.querySelectorAll('.match-award-button'), (badge) =>
              rect(badge.getBoundingClientRect()),
            ),
            stats: Array.from(el.querySelectorAll('td:not(:first-child)'), (cell) => {
              const range = document.createRange();
              range.selectNodeContents(cell);
              return rect(range.getBoundingClientRect());
            }),
            hitbox: rect(el.querySelector('button')!.getBoundingClientRect()),
          };
        });
      const baseline = await geometry();
      expect(baseline.badges.length).toBeGreaterThan(0);
      for (const open of [true, false]) {
        await toggle.click({ position: { x: 16, y: 16 } });
        await expect(toggle).toHaveAttribute('aria-expanded', String(open));
        expect(await geometry()).toEqual(baseline);
      }
    } finally {
      await browser.close();
    }
  });
}

for (const themeMode of ['light', 'dark'] as const) {
  test(`the hovered player cell uses the same row fill as its stats (${themeMode})`, async ({
    page,
  }) => {
    await page.route('**/__fixtures/rpc', async (route) => {
      if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      Object.assign(body.value.config, { themeMode, analyticsChoiceSaved: true });
      await route.fulfill({ response, json: body });
    });
    await page.goto('/#archive/match/9484902');
    await expect(page.locator('html')).toHaveAttribute('data-mode', themeMode);
    for (const name of ['bennet', 'JamesFlare']) {
      const toggle = page.locator('.match-team-table').getByRole('button', { name, exact: true });
      await toggle.hover({ position: { x: 8, y: 8 } });
      const row = toggle.locator('xpath=ancestor::tr');
      await expect(row).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const cell = (await row.getByRole('cell').first().boundingBox())!;
      const edge = Math.round(cell.x + cell.width);
      const clip = { y: Math.round(cell.y) + 5, width: 3, height: 3 };
      const sample = (x: number) =>
        page.screenshot({ clip: { ...clip, x }, scale: 'css', animations: 'disabled' });
      expect(await sample(edge - 6)).toEqual(await sample(edge + 3));
    }
  });
}
