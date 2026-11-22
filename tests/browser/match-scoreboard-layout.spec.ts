import { expect, test } from '@playwright/test';

test('team results stay in the scoreboard and expanded rows reach the right edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1070, height: 1180 });
  await page.goto('/#archive');
  await page.getByRole('button', { name: '开发工具', exact: true }).click();
  const simulation = page.getByRole('radio', { name: '状态模拟', exact: true });
  await simulation.click();
  await expect(simulation).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: /^查看 River .* 的对局详情$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#archive\/match\/9485454$/);
  const detail = page.locator('.match-detail-page');
  await expect(detail.locator('.match-outcome')).toHaveText(/^\+35\.76\s*ELO$/);
  await expect(detail.locator('.match-outcome [data-slot="badge"]')).toHaveCount(0);
  await expect(detail.getByRole('heading', { name: '敌方队伍 · Bravo' })).toBeVisible();
  await expect(detail.locator('.match-team-heading [data-slot="badge"]')).toHaveText([
    '胜利',
    '失败',
  ]);
  for (const name of ['Взгляд Крота', 'udkdjs'])
    await detail.getByRole('button', { name, exact: true }).click({ position: { x: 12, y: 16 } });
  const panels = detail.locator('.match-player-details');
  await expect(panels).toHaveCount(2);
  for (const panel of await panels.all()) {
    const gap = await panel.evaluate((el) => {
      const team = el.closest('.match-team')!;
      return (
        team.getBoundingClientRect().right -
        parseFloat(getComputedStyle(team).borderRightWidth) -
        el.getBoundingClientRect().right
      );
    });
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    const offsets = await panel.evaluate((el) => {
      const textStart = (node: Element) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().left;
      };
      const player = el.closest('tr')!.previousElementSibling!.querySelector('.match-player-name')!;
      const start = textStart(player);
      return [
        el.closest('table')!.querySelector('th')!,
        el.querySelector('dt')!,
        el.querySelector('dd')!,
      ].map((node) => Math.abs(textStart(node) - start));
    });
    expect(Math.max(...offsets)).toBeLessThan(1);
  }
});
