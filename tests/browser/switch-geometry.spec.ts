import { expect, test, type Locator } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./switch-fixture.tsx', import.meta.url)).replaceAll(
  '\\',
  '/',
);

async function geometry(control: Locator) {
  return control.evaluate((node) => {
    const thumb = node.querySelector('[data-slot=switch-thumb]')!;
    const trackBounds = node.getBoundingClientRect();
    const thumbBounds = thumb.getBoundingClientRect();
    return {
      checked: node.getAttribute('aria-checked') === 'true',
      width: trackBounds.width,
      height: trackBounds.height,
      thumb: thumbBounds.width,
      left: thumbBounds.left - trackBounds.left,
      right: trackBounds.right - thumbBounds.right,
      top: thumbBounds.top - trackBounds.top,
      bottom: trackBounds.bottom - thumbBounds.bottom,
    };
  });
}

function expectCentered(result: Awaited<ReturnType<typeof geometry>>) {
  expect((result.height - result.thumb) / 2).toBeCloseTo(2, 2);
  for (const gap of [result.checked ? result.right : result.left, result.top, result.bottom]) {
    expect(Math.abs(gap - 2), JSON.stringify(result)).toBeLessThan(0.04);
  }
}

for (const scale of [1, 1.25, 1.5, 2]) {
  for (const mode of ['light', 'dark'] as const) {
    test(`native scale ${scale} ${mode} keeps 2px insets at both Switch endpoints`, async ({
      playwright,
      baseURL,
    }, testInfo) => {
      // Native scaling exercises border snapping; emulated DPR alone does not.
      const browser = await playwright.chromium.launch({
        channel: process.env.BA_BROWSER_CHANNEL || undefined,
        args: [`--force-device-scale-factor=${scale}`, '--window-size=1600,1400'],
      });
      const page = await browser.newPage({ viewport: null, baseURL });
      try {
        await page.route('**/__fixtures/rpc', async (route) => {
          if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
          const response = await route.fetch();
          const body = await response.json();
          Object.assign(body.value.config, {
            themeMode: mode,
            lightTheme: 'dark',
            darkTheme: 'dark',
            analyticsEnabled: false,
            analyticsChoiceSaved: true,
          });
          await route.fulfill({ response, json: body });
        });
        await page.goto('/');
        await expect(page.locator('[data-ready=true]')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
        await page.evaluate(
          async (url) => (await import(/* @vite-ignore */ url)).mountSwitchFixture(),
          `/@fs/${fixturePath}`,
        );
        const fixture = page.locator('#switch-fixture');
        await expect(fixture).toBeVisible();
        await fixture.screenshot({
          path: testInfo.outputPath('switches.png'),
          animations: 'disabled',
        });
        const measured: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
        for (const size of ['default', 'sm']) {
          for (const state of ['unchecked', 'checked', 'disabled-off', 'disabled-on', 'invalid']) {
            const control = page.locator(`#switch-${size}-${state}`);
            measured[`${size}-${state}`] = await geometry(control);
            if (state === 'unchecked' || state === 'checked') {
              await control.screenshot({
                path: testInfo.outputPath(`${size}-${state}.png`),
                animations: 'disabled',
              });
            }
          }
        }
        await testInfo.attach('geometry', {
          body: JSON.stringify({ scale, mode, measured }, null, 2),
          contentType: 'application/json',
        });
        for (const [id, result] of Object.entries(measured)) {
          expect(result.width).toBe(id.startsWith('default') ? 32 : 24);
          expect(result.height).toBeCloseTo(id.startsWith('default') ? 20 : 16, 2);
          expect(result.thumb).toBe(id.startsWith('default') ? 16 : 12);
          expectCentered(result);
        }
        for (const size of ['default', 'sm']) {
          const control = page.locator(`#switch-${size}-unchecked`);
          const bounds = await control.boundingBox();
          await control.press('Space');
          await expect(control).toBeChecked();
          await expect.poll(() => geometry(control)).toMatchObject({ checked: true });
          await control.evaluate(async (node) => {
            await Promise.all(
              node.getAnimations({ subtree: true }).map((animation) => animation.finished),
            );
          });
          expectCentered(await geometry(control));
          expect(await control.boundingBox()).toEqual(bounds);
          expect(await control.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
          await control.click();
          await expect(control).not.toBeChecked();
          await control.evaluate(async (node) => {
            await Promise.all(
              node.getAnimations({ subtree: true }).map((animation) => animation.finished),
            );
          });
          expectCentered(await geometry(control));
          await page.locator(`label[for=switch-${size}-unchecked]`).click();
          await expect(control).toBeChecked();
          for (const state of ['disabled-off', 'disabled-on']) {
            const disabled = page.locator(`#switch-${size}-${state}`);
            await expect(disabled).toBeDisabled();
            // Bypass Playwright's disabled-label guard, not the browser's native disabled behavior.
            await page.locator(`label[for=switch-${size}-${state}]`).click({ force: true });
            await expect(disabled).toHaveAttribute('aria-checked', String(state === 'disabled-on'));
          }
        }
        await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
        for (const control of await fixture.getByRole('switch').all()) {
          expectCentered(await geometry(control));
        }
      } finally {
        await browser.close();
      }
    });
  }
}
