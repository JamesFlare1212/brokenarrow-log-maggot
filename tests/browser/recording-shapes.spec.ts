import { expect, test } from '@playwright/test';

for (const width of [1024, 390]) {
  test(`content panels share a continuous contour at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route('**/__fixtures/rpc', async (route) => {
      if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      Object.assign(body.value.config, {
        lang: 'zh',
        themeMode: 'dark',
        analyticsChoiceSaved: true,
      });
      await route.fulfill({ response, json: body });
    });
    for (const [name, route, selector, count] of [
      ['recording', 'settings/recording', '.recording-settings > [data-slot=card]', 4],
      ['metrics', 'current', '.dashboard .metrics-grid > [data-slot=card]', 4],
      ['teams', 'archive/match/9485454', '[data-match-team]', 2],
    ] as const) {
      await page.goto('/#' + route);
      const panels = page.locator(selector);
      await expect(panels).toHaveCount(count);
      if (name === 'teams')
        await expect(panels.last().locator('.match-player-cell').first()).toBeVisible();
      for (const panel of await panels.all()) {
        await expect(panel).toHaveCSS('border-radius', '36px');
        await expect(panel).toHaveCSS('corner-shape', 'superellipse(2)');
      }
      if (width === 1024) {
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({
          content: '[data-development-layer] { visibility: hidden !important }',
        });
        const sample =
          name === 'metrics' ? page.locator('.dashboard .metrics-grid') : panels.last();
        await sample.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
        if (name === 'recording') {
          await panels
            .first()
            .screenshot({ path: info.outputPath('behavior.png'), animations: 'disabled' });
        }
      }
    }
  });
}
