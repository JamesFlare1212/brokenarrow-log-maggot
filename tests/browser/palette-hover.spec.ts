import { test, expect, type Page } from '@playwright/test';

type Region = { x: number; y: number; width: number; height: number };
type PaintWindow = Window & { palettePointerEntry?: number; palettePointerExit?: number };

async function pixelDifferences(
  page: Page,
  before: Buffer,
  after: Buffer,
  regions: Record<string, Region>,
) {
  return page.evaluate(
    async ({ before, after, regions }) => {
      const pixels = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [a, b] = await Promise.all([pixels(before), pixels(after)]);
      if (a.width !== b.width || a.height !== b.height)
        throw new Error('Palette capture dimensions changed');
      return Object.fromEntries(
        Object.entries(regions).map(([name, region]) => {
          if (
            region.x < 0 ||
            region.y < 0 ||
            region.x + region.width > a.width ||
            region.y + region.height > a.height
          )
            throw new Error(`Palette region outside the captured viewport: ${name}`);
          let changed = 0,
            maximum = 0;
          for (let y = region.y; y < region.y + region.height; y++) {
            for (let x = region.x; x < region.x + region.width; x++) {
              const i = (y * a.width + x) * 4;
              const delta = Math.max(
                Math.abs(a.data[i]! - b.data[i]!),
                Math.abs(a.data[i + 1]! - b.data[i + 1]!),
                Math.abs(a.data[i + 2]! - b.data[i + 2]!),
              );
              maximum = Math.max(maximum, delta);
              if (delta > 2) changed++;
            }
          }
          return [name, { changed, maximum, pixels: region.width * region.height }];
        }),
      );
    },
    { before: before.toString('base64'), after: after.toString('base64'), regions },
  );
}

async function paintState(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.appearance-theme-grid')!;
    const tooltip = document.querySelector<HTMLElement>('[data-slot=tooltip-content]');
    const style = tooltip && getComputedStyle(tooltip);
    return {
      at: performance.now(),
      entry: (window as PaintWindow).palettePointerEntry ?? null,
      exit: (window as PaintWindow).palettePointerExit ?? null,
      scroll: grid.closest('.settings-content')!.scrollTop,
      grid: grid.getBoundingClientRect().toJSON() as Region,
      hint: tooltip
        ? {
            id: tooltip.id,
            state: tooltip.dataset.state,
            animation: style!.animationName,
            opacity: style!.opacity,
            transform: style!.transform,
            rect: tooltip.getBoundingClientRect().toJSON() as Region,
          }
        : null,
    };
  });
}

for (const dpr of [1, 1.5]) {
  test.describe(`palette paint at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width: 1280, height: 800 } });
    for (const mode of ['light', 'dark'] as const) {
      for (const opacity of [40, 50, 100]) {
        test(`${mode}, ${opacity}% stays intact from pointer entry through hint dismissal`, async ({
          page,
        }, testInfo) => {
          const rendererErrors: string[] = [];
          page.on('pageerror', (error) => rendererErrors.push(error.message));
          await page.route('**/__fixtures/rpc', async (route) => {
            if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
            const response = await route.fetch();
            const body = await response.json();
            Object.assign(body.value.config, {
              lang: 'en',
              themeMode: mode,
              lightTheme: 'dark',
              darkTheme: 'dark',
              glassOpacity: opacity,
            });
            await route.fulfill({ response, json: body });
          });
          await page.goto('/#settings/appearance');
          const grid = page.locator('.appearance-theme-grid');
          await expect(grid).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
          await expect
            .poll(() =>
              page.evaluate(() =>
                document.documentElement.style.getPropertyValue('--glass-opacity'),
              ),
            )
            .toBe(`${opacity}%`);
          expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr);
          await page.evaluate(() => document.fonts.ready);
          await grid.evaluate((node) =>
            node.scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
          await page.evaluate(() => {
            document.addEventListener(
              'pointerover',
              (event) => {
                const swatch = (event.target as Element).closest('.appearance-theme-swatch');
                if (swatch && !swatch.contains(event.relatedTarget as Node | null))
                  (window as PaintWindow).palettePointerEntry = performance.now();
              },
              true,
            );
            document.addEventListener(
              'pointerout',
              (event) => {
                const swatch = (event.target as Element).closest('.appearance-theme-swatch');
                if (swatch && !swatch.contains(event.relatedTarget as Node | null))
                  (window as PaintWindow).palettePointerExit = performance.now();
              },
              true,
            );
          });
          const camera = await paintState(page);
          const out = { x: camera.grid.x + 10, y: camera.grid.y - 30 };
          const tooltip = page.locator('[data-slot=tooltip-content]');
          await page.mouse.move(out.x, out.y);
          await expect(tooltip).toHaveCount(0);
          const first = (await page.locator('[data-theme-library-card=violet]').boundingBox())!;
          const last = (await page.locator('[data-theme-library-card=ocean]').boundingBox())!;
          const lowerRow = {
            x: Math.floor(first.x),
            y: Math.floor(first.y) - 16,
            width: Math.ceil(last.x + last.width) - Math.floor(first.x),
            height: Math.ceil(last.y + last.height) - Math.floor(first.y) + 16,
          };
          const screenshot = () => page.screenshot({ scale: 'css', animations: 'allow' });
          const baseline = await screenshot();
          await testInfo.attach('idle', { body: baseline, contentType: 'image/png' });
          const records = [];
          let leftAt = 0;
          for (const [interaction, scheme, index] of [
            ['ordinary-entry', 'cyan', 0],
            ['rapid-reentry', 'cyan', 0],
            ['direct-same-card', 'cyan', 1],
            ['direct-next-card', 'orange', 1],
            ['direct-selected-card', 'dark', 0],
          ] as const) {
            if (interaction === 'ordinary-entry') await page.waitForTimeout(350);
            const card = page.locator(`[data-theme-library-card=${scheme}]`);
            const box = (await card.boundingBox())!;
            const swatch = (await card
              .locator('.appearance-theme-swatch')
              .nth(index)
              .boundingBox())!;
            const interior = {
              x: Math.ceil(box.x + 8),
              y: Math.ceil(box.y + 8),
              width: Math.floor(box.width - 16),
              height: Math.floor(box.height - 16),
            };
            // Measure before leaving so host round trips do not consume the re-entry window.
            if (interaction === 'rapid-reentry') {
              await page.mouse.move(out.x, out.y, { steps: 2 });
              // Leave Radix's hover grace area before waiting for dismissal.
              await page.mouse.move(out.x + 1, out.y - 1);
              await expect(tooltip).toHaveCount(0);
            }
            // Coordinates avoid locator hover's automatic scrolling during a paint trial.
            await page.mouse.move(swatch.x + swatch.width / 2, swatch.y + swatch.height / 2);
            const entered = await paintState(page);
            expect(entered.entry).not.toBeNull();
            if (interaction === 'rapid-reentry') {
              expect(entered.exit).not.toBeNull();
              leftAt = entered.exit!;
              expect(entered.entry!).toBeGreaterThan(leftAt);
              expect(entered.entry! - leftAt).toBeLessThan(300);
            }
            const frames = [];
            let savedVisible = false;
            for (const offset of [0, 80, 200, 380, 520, 720]) {
              const now = await page.evaluate(() => performance.now());
              if (entered.entry! + offset > now)
                await page.waitForTimeout(entered.entry! + offset - now);
              const before = await paintState(page);
              const frame = await screenshot();
              const after = await paintState(page);
              const differences = await pixelDifferences(page, baseline, frame, {
                neighbors: lowerRow,
                content: interior,
              });
              frames.push({
                offset,
                elapsed: before.at - entered.entry!,
                before,
                after,
                differences,
              });
              if (offset === 0 || offset === 720 || (!savedVisible && after.hint))
                await testInfo.attach(`${interaction}-${offset}`, {
                  body: frame,
                  contentType: 'image/png',
                });
              savedVisible ||= !!after.hint;
              for (const state of [before, after]) {
                expect(state.scroll).toBe(camera.scroll);
                expect(state.grid).toEqual(camera.grid);
                if (state.hint) {
                  expect(state.hint.animation).toBe('none');
                  expect(state.hint.opacity).toBe('1');
                  expect(state.hint.transform).toBe('none');
                }
              }
              for (const difference of Object.values(differences))
                expect(difference.changed, JSON.stringify(frames.at(-1))).toBe(0);
            }
            // Capture latency depends on the runner; verify the observed interaction phases.
            expect(
              frames.every(
                (frame) =>
                  frame.before.entry === entered.entry && frame.after.entry === entered.entry,
              ),
            ).toBe(true);
            if (interaction === 'ordinary-entry')
              expect(frames.some((frame) => !frame.after.hint)).toBe(true);
            await expect(tooltip).toBeVisible();
            expect(frames.at(-1)!.after.hint?.id).toBe(await tooltip.getAttribute('id'));
            const hints = frames.flatMap((frame) =>
              [frame.before.hint, frame.after.hint].flatMap((hint) => (hint ? [hint] : [])),
            );
            expect(hints.length).toBeGreaterThan(0);
            // Direct movement may sample the previous hint before the new root commits.
            for (const hint of hints)
              expect(hint.rect).toEqual(hints.find((other) => other.id === hint.id)!.rect);
            await expect(card.locator('.appearance-theme-swatch').nth(index)).toHaveAttribute(
              'aria-describedby',
              (await tooltip.getAttribute('id')) as string,
            );
            records.push({
              interaction,
              scheme,
              index,
              reentryGap: entered.entry! - leftAt,
              frames,
            });
          }
          await page.mouse.move(out.x, out.y, { steps: 2 });
          await page.mouse.move(out.x + 1, out.y - 1);
          await expect(tooltip).toHaveCount(0);
          const exit = await pixelDifferences(page, baseline, await screenshot(), {
            neighbors: lowerRow,
          });
          expect(exit.neighbors!.changed).toBe(0);
          expect(rendererErrors).toEqual([]);
          await testInfo.attach('palette-repaint', {
            body: Buffer.from(
              JSON.stringify(
                {
                  mode,
                  opacity,
                  dpr,
                  camera,
                  applied: await page.evaluate(() => ({
                    mode: document.documentElement.dataset.mode,
                    opacity: document.documentElement.style.getPropertyValue('--glass-opacity'),
                    dpr: devicePixelRatio,
                  })),
                  regions: { lowerRow },
                  rendererErrors,
                  records,
                  exit,
                },
                null,
                2,
              ),
            ),
            contentType: 'application/json',
          });
        });
      }
    }
  });
}
