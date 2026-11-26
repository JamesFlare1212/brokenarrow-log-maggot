import { expect, test } from '@playwright/test';
import { expectCorners } from './corner-geometry';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

test('the collapsed desktop preferences card follows the lower-right dialog corner', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1068, height: 930 });
  await page.goto('/#radar');
  await page.locator('.session-actions button').first().click();
  await page.getByRole('button', { name: '翻斗花园第一巴图鲁', exact: true }).click();
  const card = page.locator('.profile-dialog .profile-preferences');
  await expect(card).toHaveAttribute('aria-busy', 'false');
  await expect(card.locator('.profile-category-list')).toBeVisible();
  await expectCorners(card, '.profile-dialog', ['BottomRight'], 0.5);
});

for (const width of [1280, 390]) {
  test(`profile map cards align with the dialog bottom corner at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route('**/__fixtures/rpc', async (route) => {
      if (route.request().postDataJSON().method !== 'players.profile') return route.continue();
      const response = await route.fetch();
      const json = await response.json();
      json.value.names = [];
      await route.fulfill({ response, json });
    });
    await page.goto('/#radar');
    await page.locator('.session-actions button').first().click();
    await page.locator('.player-card-trigger').first().click();
    const dialog = page.locator('.profile-dialog');
    const highlights = dialog.locator('.profile-highlights');
    await expect(highlights.locator('.profile-unit-table tbody tr').first()).toBeVisible();
    await expect(highlights.locator('[data-slot="card-header"] [data-slot="badge"]')).toHaveCount(
      0,
    );
    await expect(highlights).toHaveCSS('padding-block-start', '16px');
    for (const slot of ['card-header', 'card-content']) {
      const section = highlights.locator(`:scope > [data-slot="${slot}"]`);
      await expect(section).toHaveCSS('padding-inline-start', '20px');
      await expect(section).toHaveCSS('padding-inline-end', '20px');
    }
    const mapsTab = dialog.locator('.profile-records').getByRole('tab').nth(1);
    await expect(mapsTab).toHaveAccessibleName(/地图表现|Map performance/);
    await mapsTab.click();
    const cards = dialog.locator('.map-performance-card');
    await expect(cards.first()).toBeVisible();
    const body = dialog.locator('.dialog-body');
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const index = await cards.evaluateAll((nodes) =>
      nodes.findIndex(
        (el) =>
          Math.abs(
            el.getBoundingClientRect().bottom - nodes.at(-1)!.getBoundingClientRect().bottom,
          ) < 1,
      ),
    );
    await expect(dialog).toHaveCSS('corner-shape', 'superellipse(2)');
    await expect(dialog).toHaveCSS('border-radius', width === 390 ? '52px' : '56px');
    await expectCorners(cards.nth(index), '.profile-dialog', ['BottomLeft'], 0.5);
    if (width === 1280) {
      const b = (await dialog.boundingBox())!;
      await page.screenshot({
        path: info.outputPath('bottom-left.png'),
        clip: { x: b.x - 4, y: b.y + b.height - 136, width: 240, height: 140 },
        animations: 'disabled',
      });
    }
  });
}
