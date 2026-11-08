import { expect, test } from '@playwright/test';
import type { PublicConfig } from '../../packages/contracts/src/index';

function luminance(color: string) {
  const [red, green, blue] = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number)
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

for (const [theme, scheme] of [
  ['dark', 'light'],
  ['light', 'dark'],
] as const) {
  test.describe(`${theme} application with ${scheme} contrast colors`, () => {
    test.use({ forcedColors: 'active', colorScheme: scheme, deviceScaleFactor: 1.5 });

    test('keeps Switch state and keyboard focus visible', async ({ page }) => {
      let config: PublicConfig | undefined;
      await page.route('**/__fixtures/rpc', async (route) => {
        const request = route.request().postDataJSON();
        if (request.method === 'app.bootstrap') {
          const response = await route.fetch();
          const body: { value: { config: PublicConfig } } = await response.json();
          Object.assign(body.value.config, {
            lang: 'en',
            themeMode: theme,
            analyticsEnabled: false,
            analyticsChoiceSaved: true,
          });
          config = body.value.config;
          return route.fulfill({ response, json: body });
        }
        if (request.method === 'config.update') {
          if (!config) throw new Error('Config update before bootstrap');
          expect(Object.keys(request.input)).toEqual(['hiddenPanels']);
          Object.assign(config, request.input);
          return route.fulfill({ json: { value: config } });
        }
        if (request.method === 'diagnostics.report')
          return route.fulfill({ json: { value: null } });
        return route.continue();
      });

      await page.goto('/#settings/navigation');
      const control = page.locator('#navigation-visible-radar');
      await expect(control).toBeVisible();
      const initial = await control.isChecked();
      const originalHidden = [...config!.hiddenPanels];
      for (const checked of [!initial, initial]) {
        await control.press('Space');
        await expect(control).toHaveAttribute('aria-checked', String(checked));
        const colors = await control.evaluate((node) => {
          const root = getComputedStyle(node);
          const thumb = getComputedStyle(node.querySelector('[data-slot=switch-thumb]')!);
          return {
            track: root.backgroundColor,
            thumb: thumb.backgroundColor,
            outline: root.outlineStyle,
            width: parseFloat(root.outlineWidth),
            offset: parseFloat(root.outlineOffset),
            focus: node.matches(':focus-visible'),
          };
        });
        const track = luminance(colors.track),
          thumb = luminance(colors.thumb);
        expect(
          (Math.max(track, thumb) + 0.05) / (Math.min(track, thumb) + 0.05),
        ).toBeGreaterThanOrEqual(3);
        expect(colors.focus).toBe(true);
        expect(colors.outline).toBe('solid');
        expect(colors.width).toBeGreaterThanOrEqual(2);
        expect(colors.offset).toBeGreaterThanOrEqual(2);
      }
      await expect.poll(() => config!.hiddenPanels).toEqual(originalHidden);
    });
  });
}
