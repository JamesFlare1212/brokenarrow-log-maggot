import { expect, test } from '@playwright/test';

for (const width of [1090, 390]) {
  test(`search results and archive cards keep their geometry during preview at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const tools = page.getByRole('button', { name: '开发工具', exact: true });
    const toggle = page.getByRole('switch', { name: '加载状态' });
    await page.goto('/#players');
    await page.getByRole('searchbox').fill('JamesFlare');
    await page.locator('form').getByRole('button', { name: '搜索', exact: true }).click();
    const results = page.locator('.player-results-card');
    const rows = results.locator('.search-result');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    const rowHeight = (await rows.first().boundingBox())!.height;
    await tools.click();
    await toggle.click();
    const loadingRows = results.locator('.player-result-loading');
    await expect(loadingRows).toHaveCount(count);
    expect((await loadingRows.first().boundingBox())!.height).toBeCloseTo(rowHeight, 1);
    await toggle.click();
    await page.keyboard.press('Escape');
    await page.goto('/#archive');
    const card = page.locator('.archive-card').first();
    await expect(card.locator('.archive-card-map')).toBeVisible();
    const height = (await card.boundingBox())!.height;
    const labels = await card.locator('h4').allTextContents();
    await tools.click();
    await toggle.click();
    await expect(card.locator('[data-slot="skeleton"]').first()).toBeVisible();
    expect((await card.boundingBox())!.height).toBeCloseTo(height, 1);
    await expect(card.locator('h4')).toHaveText(labels);
    await expect(card.locator('h4 [data-slot="skeleton"]')).toHaveCount(0);
  });
}
