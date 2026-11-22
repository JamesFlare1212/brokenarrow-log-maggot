import { expect, test } from '@playwright/test';

test('toggling expiry refreshes the selected player without leaving a live party', async ({
  page,
}) => {
  await page.goto('/#players');
  const tools = page.getByRole('button', { name: '开发工具', exact: true });
  await tools.click();
  const simulation = page.getByRole('radio', { name: '状态模拟', exact: true });
  await simulation.click();
  await page.getByRole('radio', { name: '3', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('[data-player-select="75402"]').click();
  const report = page.locator('.player-report-panel');
  const identity = report.getByRole('heading', { name: 'JamesFlare #75402' });
  await expect(identity).toBeVisible();
  const stale = report.getByText(/缓存数据，可能已过期/);
  await expect(stale).toHaveCount(0);
  await tools.click();
  const expired = page.getByRole('switch', { name: '缓存过期' });
  await expired.click();
  await expect(stale).toBeVisible();
  await expired.click();
  await expect(identity).toBeVisible();
  await expect(stale).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '3', exact: true })).toBeChecked();
});

test('the open player dialog shows the selected expiry state even for a fresh report', async ({
  page,
}) => {
  let stale = true;
  await page.route('**/__fixtures/rpc', async (route) => {
    const { method } = route.request().postDataJSON();
    if (!['players.profile', 'players.report'].includes(method)) return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (method === 'players.report') body.value.stale = stale;
    else if (body.value.info) body.value.info.stale = stale;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/#archive/match/9485138');
  await page
    .locator('.match-detail-page')
    .getByRole('button', { name: 'JamesFlare', exact: true })
    .click({ button: 'right', position: { x: 32, y: 14 } });
  await page.getByRole('menuitem', { name: '查看玩家资料' }).click();
  const dialog = page.locator('.profile-dialog');
  const warning = dialog.getByText(/缓存数据，可能已过期/);
  const refresh = dialog.getByRole('button', { name: '刷新', exact: true });
  await expect(refresh).toBeEnabled();
  await expect(warning).toHaveCount(0);
  const tools = page.locator('.development-tools-launcher [data-slot="popover-trigger"]');
  await tools.click();
  const expiry = page.locator('.development-tools-panel').getByRole('switch', { name: '缓存过期' });
  await expiry.click();
  await expect(warning).toBeVisible();
  await expiry.click();
  await expect(refresh).toBeEnabled();
  await expect(warning).toHaveCount(0);
  stale = false;
  await expiry.click();
  await expect(warning).toBeVisible();
  await expiry.click();
  await expect(refresh).toBeEnabled();
  await expect(warning).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

for (const { width, height, x, y, side, edge, theme } of [
  { width: 900, height: 600, x: 800, y: 560, side: 'top', edge: 'right', theme: 'dark' },
  { width: 375, height: 350, x: 12, y: 8, side: 'bottom', edge: 'left', theme: 'light' },
] as const) {
  test(`development tools align ${edge} and leave a gap ${side === 'top' ? 'above' : 'below'} the launcher`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(
      ({ x, y }) =>
        sessionStorage.setItem('brokenarrow:development-tool-position', JSON.stringify({ x, y })),
      { x, y },
    );
    await page.goto('/#archive/match/9485138');
    const tools = page.getByRole('button', { name: '开发工具', exact: true });
    await tools.click();
    const panel = page.locator('.development-tools-panel');
    await expect(panel).toHaveAttribute('data-side', side);
    await expect(panel).toHaveAccessibleName('开发工具');
    await expect(panel.getByText('开发工具', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '重置当前场景' })).toBeVisible();
    await expect
      .poll(async () => {
        const dock = await page.locator('.development-tools-launcher').boundingBox();
        const p = await panel.boundingBox();
        if (!dock || !p) return false;
        const gap = side === 'top' ? dock.y - p.y - p.height : p.y - dock.y - dock.height;
        const offset = p.x - dock.x + (edge === 'right' ? p.width - dock.width : 0);
        return (
          Math.abs(gap - 8) <= 1 &&
          Math.abs(offset) <= 1 &&
          p.x >= 7 &&
          p.y >= 7 &&
          p.x + p.width <= width - 7 &&
          p.y + p.height <= height - 7
        );
      })
      .toBe(true);
    expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    if (side === 'bottom')
      expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const expired = panel.getByRole('switch', { name: '缓存过期' });
    await expect(expired).not.toBeChecked();
    const stale = page
      .locator('.match-detail-page')
      .getByText('BATrace 暂不可用，正在显示缓存的对局数据。');
    await expired.click();
    await expect(expired).toBeChecked();
    await expect(stale).toBeVisible();
    await expired.click();
    await expect(stale).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect(tools).toBeFocused();
  });
}
