import { expect, test } from '@playwright/test';

test('debugs a recorded timeline, switches to an empty archive, and records a simulated clip', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.url().endsWith('/__fixtures/rpc') && !r.ok())
      errors.push(`${r.status()}: ${r.request().postData()}`);
  });
  const tools = page.getByRole('button', { name: '开发工具', exact: true });
  const selectScene = async (name: string) => {
    await tools.click();
    const mode = page.getByRole('radio', { name, exact: true });
    await mode.click();
    await expect(mode).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
  };
  await page.goto('/#archive/match/9485138');
  await selectScene('状态模拟');
  const detail = page.locator('.match-detail-page');
  await expect(detail.getByRole('heading', { name: 'Baltiisk', exact: true })).toBeVisible();
  await detail.getByRole('tab', { name: '时间线', exact: true }).click();
  await expect(detail.getByTestId('moment-row')).toHaveCount(6);
  await selectScene('空数据');
  await expect(page).toHaveURL(/#archive$/);
  await expect(detail).toHaveCount(0);
  await selectScene('状态模拟');
  await page.getByRole('button', { name: '对局录像', exact: true }).click();
  await tools.click();
  const recording = page.getByLabel('录制状态', { exact: true });
  await recording.selectOption('recording');
  await expect(page.locator('.recording-preview img')).toBeVisible();
  await recording.selectOption('idle');
  await page.keyboard.press('Escape');
  const play = page.locator('.replay-play').first();
  await expect(play).toHaveAccessibleName(/River/);
  await play.click();
  const video = page.locator('video');
  await expect(video).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await selectScene('仓库样本');
  await expect(page.locator('.replay-play')).toHaveCount(0);
  expect(errors).toEqual([]);
});
