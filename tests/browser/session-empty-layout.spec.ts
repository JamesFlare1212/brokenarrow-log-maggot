import { expect, test } from '@playwright/test';

for (const width of [1120, 390]) {
  test(`empty data preserves the overview radar layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#current');
    const card = page.locator('.session-card');
    const prompt = card.getByText('等待游戏日志', { exact: true });
    const previous = card.getByRole('button', { name: '上一局' });
    await expect(previous).toBeEnabled();
    await expect(prompt).toBeVisible();
    const sample = (await card.boundingBox())!;
    const promptOffset = (await prompt.boundingBox())!.y - sample.y;
    await page.getByRole('button', { name: '开发工具', exact: true }).click();
    await page.getByRole('radio', { name: '空数据', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(previous).toBeDisabled();
    await expect(prompt).toBeVisible();
    await expect.poll(async () => (await card.boundingBox())!.height).toBeCloseTo(sample.height, 1);
    expect((await prompt.boundingBox())!.y - (await card.boundingBox())!.y).toBeCloseTo(
      promptOffset,
      1,
    );
  });
}
