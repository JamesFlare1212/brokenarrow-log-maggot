import { expect, test, type Locator } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./table-fixture.tsx', import.meta.url)).replaceAll(
  '\\',
  '/',
);

async function pixels(locator: Locator) {
  const screenshot = await locator.screenshot({ animations: 'disabled' });
  return locator.page().evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, image.width, image.height).data);
  }, screenshot.toString('base64'));
}

for (const scale of [1, 1.5]) {
  test.describe(`native display scale ${scale}`, () => {
    for (const mode of ['light', 'dark'] as const) {
      test(`${mode} tables stay transparent and readable through scrolling and refresh`, async ({
        playwright,
        baseURL,
      }) => {
        // Native scaling also exercises Chromium's border snapping, unlike DPR emulation.
        const browser = await playwright.chromium.launch({
          channel: process.env.BA_BROWSER_CHANNEL || undefined,
          args: [`--force-device-scale-factor=${scale}`],
        });
        const page = await browser.newPage({ viewport: null, baseURL });
        try {
          await page.route('**/__fixtures/rpc', async (route) => {
            if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
            const response = await route.fetch();
            const body = await response.json();
            Object.assign(body.value.config, {
              themeMode: mode,
              glassOpacity: 50,
              analyticsEnabled: false,
              analyticsChoiceSaved: true,
            });
            await route.fulfill({ response, json: body });
          });
          await page.goto('/');
          await expect(page.locator('[data-ready=true]')).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
          await page.evaluate(
            async (url) => (await import(/* @vite-ignore */ url)).mountTableFixture(),
            `/@fs/${fixturePath}`,
          );
          const viewport = page.getByRole('region', { name: 'Transparent records' });
          const table = viewport.getByRole('table');
          const identity = table.locator('tbody tr').first().locator('td').first();
          const header = table.getByRole('columnheader', { name: 'Match ID' });
          await expect(identity.getByRole('button')).toHaveText('#9565049');
          await page.mouse.move(0, 0);
          const identityBefore = await pixels(identity);
          const headerBefore = await pixels(header);
          const identityLeft = (await identity.boundingBox())!.x;
          await viewport.evaluate((node) => (node.scrollLeft = 220));
          await expect
            .poll(async () => (await identity.boundingBox())!.x)
            .toBeCloseTo(identityLeft);
          expect(await pixels(identity)).toEqual(identityBefore);
          await viewport.evaluate((node) => (node.scrollTop = 157));
          expect(await pixels(header)).toEqual(headerBefore);

          await viewport.evaluate((node) => (node.scrollTop = 0));
          await identity.getByRole('button').click();
          await expect(page.getByText('Opened: 1')).toBeVisible();
          const hover = await identity.evaluate((cell) => {
            const row = cell.parentElement!;
            return {
              row: getComputedStyle(row).backgroundColor,
              cells: Array.from(row.children, (node) => getComputedStyle(node).backgroundColor),
            };
          });
          expect(hover.row).not.toBe('rgba(0, 0, 0, 0)');
          expect(hover.cells.every((color) => color === 'rgba(0, 0, 0, 0)')).toBe(true);
          await page.getByRole('button', { name: 'Toggle loading' }).click();
          await expect(identity.getByRole('button')).toHaveText('Loading');
          await page.getByRole('button', { name: 'Toggle loading' }).click();
          await expect(identity.getByRole('button')).toHaveText('#9565049');
          await page.mouse.move(0, 0);
          expect(await pixels(identity)).toEqual(identityBefore);

          const surfaces = await table.evaluate((node) =>
            [node, ...node.querySelectorAll('thead, tbody, tr, th, td')].map(
              (element) => getComputedStyle(element).backgroundColor,
            ),
          );
          expect(surfaces.every((color) => color === 'rgba(0, 0, 0, 0)')).toBe(true);
          const lines = await page.getByRole('list', { name: 'Name history' }).evaluate((node) => ({
            dpr: devicePixelRatio,
            dividers: Array.from(
              node.querySelectorAll<HTMLElement>('[data-slot=item-separator]'),
              (element) => element.getBoundingClientRect().height * devicePixelRatio,
            ),
            row:
              parseFloat(getComputedStyle(document.querySelector('tbody tr')!).borderBottomWidth) *
              devicePixelRatio,
          }));
          expect(lines.dpr).toBe(scale);
          expect(lines.row).toBeCloseTo(1);
          for (const thickness of lines.dividers) expect(thickness).toBeCloseTo(lines.row);
        } finally {
          await browser.close();
        }
      });
    }
  });
}
