import { expect, test, type Locator } from '@playwright/test';
import { expectButtonShape } from './button-shape';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./radius-controls-fixture.tsx', import.meta.url)).replaceAll(
  '\\',
  '/',
);
type Corner = 'TopLeft' | 'TopRight' | 'BottomLeft' | 'BottomRight';
const left: Corner[] = ['TopLeft', 'BottomLeft'];
const right: Corner[] = ['TopRight', 'BottomRight'];

async function concentric(outer: Locator, inner: Locator, corners: Corner[]) {
  const child = await inner.elementHandle();
  if (!child) throw new Error('Missing nested control');
  const values = await outer.evaluate(
    (parent, { child, corners }) => {
      const bounds = parent.getBoundingClientRect();
      const innerBounds = child.getBoundingClientRect();
      function radius(node: Element, corner: Corner) {
        const r = node.getBoundingClientRect();
        return Math.min(
          parseFloat(getComputedStyle(node)[`border${corner}Radius`]),
          r.width / 2,
          r.height / 2,
        );
      }
      return corners.map((corner) => ({
        corner,
        x: corner.endsWith('Left')
          ? innerBounds.left - bounds.left
          : bounds.right - innerBounds.right,
        y: corner.startsWith('Top')
          ? innerBounds.top - bounds.top
          : bounds.bottom - innerBounds.bottom,
        delta: radius(parent, corner) - radius(child, corner),
      }));
    },
    { child, corners },
  );
  for (const result of values) {
    expect(result.delta, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.x, JSON.stringify(result)).toBeCloseTo(result.delta, 1);
    expect(result.y, JSON.stringify(result)).toBeCloseTo(result.delta, 1);
  }
}

for (const touch of [false, true]) {
  test.describe(touch ? 'touch control corners' : 'desktop control corners', () => {
    test.use({
      hasTouch: touch,
      viewport: { width: touch ? 390 : 1280, height: 850 },
      reducedMotion: 'reduce',
    });
    test.beforeEach(async ({ page }) => {
      await page.route('**/__fixtures/rpc', async (route) => {
        if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
        const response = await route.fetch();
        const json = await response.json();
        Object.assign(json.value.config, { lang: 'en', analyticsChoiceSaved: true });
        Object.assign(json.value.session, {
          current: null,
          lobbyPlayers: [{ id: '75402', name: 'JamesFlare', teamId: null }],
        });
        await route.fulfill({ response, json });
      });
    });

    test('inline and block actions and active tabs follow their nearest frame corners', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.locator('[data-ready=true]')).toBeVisible();
      await page.evaluate(
        async (path) => (await import(path)).mountRadiusControls(),
        `/@fs/${fixture}`,
      );
      for (const frame of ['default', 'lg']) {
        for (const size of ['xs', 'icon-xs', 'sm', 'icon-sm']) {
          const group = page.locator(`#${frame}-${size}`);
          await expect(group).toHaveCSS(
            'height',
            `${frame === 'default' ? 32 : touch ? 44 : 36}px`,
          );
          for (const action of await group.getByRole('button').all())
            await expectButtonShape(action);
        }
      }
      const media = page.locator('#edge-media');
      await expect(media).toHaveCSS('overflow', 'hidden');
      await expect(media).toHaveCSS('padding-block-end', '0px');
      await expect(media.locator('img')).toHaveCSS('border-radius', '0px');
      const keycap = page.locator('#keycap');
      await concentric(keycap, keycap.locator('kbd'), right);
      const block = page.locator('#mixed-block');
      for (const action of await block.getByRole('button').all()) await expectButtonShape(action);
      for (const axis of ['horizontal', 'vertical']) {
        const list = page.locator(`#tabs-${axis}`).getByRole('tablist');
        const first = list.getByRole('tab').first();
        const last = list.getByRole('tab').last();
        await concentric(list, first, axis === 'horizontal' ? left : ['TopLeft', 'TopRight']);
        await first.press(axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
        await expect(last).toHaveAttribute('aria-selected', 'true');
        await concentric(list, last, axis === 'horizontal' ? right : ['BottomLeft', 'BottomRight']);
      }
    });

    test('room suggestions, search clear, both result hovers and responsive directory actions', async ({
      page,
    }) => {
      await page.goto('/#players');
      const suggestion = page.locator('.suggestion-list button').first();
      await expect(suggestion).toBeVisible();
      await expectButtonShape(suggestion);
      await expect(suggestion.locator('[data-slot=avatar-fallback]')).toHaveCSS(
        'border-radius',
        '8px',
      );
      const search = page.getByRole('searchbox');
      const field = page.locator('.player-search-controls [data-slot=input-group]');
      await expectButtonShape(field);
      await search.fill('JamesFlare');
      await expectButtonShape(field);
      const clear = field.getByRole('button');
      await expectButtonShape(clear);
      await clear.click();
      await expect(search).toHaveValue('');
      await search.fill('JamesFlare');
      await search.press('Enter');
      const row = page.locator('.search-result').first();
      const select = row.locator('.player-result-button');
      await select.click();
      await expect(select).toHaveAttribute('aria-pressed', 'true');
      const actions = row.locator('[data-menu-trigger]');
      for (const button of [select, actions]) {
        await button.hover();
        if (!touch) await expect(button).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expectButtonShape(button);
      }
      await actions.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await page.goto('/#settings/connection');
      const directory = page.locator('[data-slot=input-group]:has(#settings-log)');
      await expectButtonShape(directory);
      const buttons = directory.getByRole('button');
      await expect(buttons.first()).toBeVisible();
      for (const action of await buttons.all()) await expectButtonShape(action);
    });
  });
}
