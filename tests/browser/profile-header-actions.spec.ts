import { expect, test } from '@playwright/test';
import { BATRACE_ORIGIN } from '@ba/contracts';

for (const [lang, width] of [
  ['zh', 1200],
  ['en', 320],
] as const) {
  test(`profile header icons explain their actions and copy a shareable ${lang} summary`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/__fixtures/rpc', async (route) => {
      if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      Object.assign(body.value.config, {
        lang,
        analyticsChoiceSaved: true,
        sidebarCollapsed: true,
      });
      await route.fulfill({ response, json: body });
    });
    await page.goto('/#archive/match/9485138');
    const detail = page.locator('.match-detail-page');
    await detail
      .getByRole('button', { name: 'JamesFlare', exact: true })
      .click({ button: 'right', position: { x: 32, y: 14 } });
    await page
      .getByRole('menuitem', { name: lang === 'zh' ? '查看玩家资料' : 'View player profile' })
      .click();
    const header = page.locator('.profile-dialog [data-slot="dialog-header"]');
    await expect(header).toBeVisible();
    await page.setViewportSize({ width, height: 800 });
    const label = lang === 'zh' ? '在 BATrace 查看玩家资料' : 'Open player profile on BATrace';
    const copyLabel = lang === 'zh' ? '复制玩家战绩摘要' : 'Copy player summary';
    const external = header.getByRole('button', { name: label, exact: true });
    const copy = header.getByRole('button', { name: copyLabel, exact: true });
    for (const button of [external, copy]) {
      await expect(button).toHaveText('');
      await expect(button).toHaveCSS('width', '32px');
      await expect(button).toHaveCSS('height', '32px');
    }
    await external.hover();
    await expect(page.getByRole('tooltip')).toHaveText(label);
    await page.mouse.move(0, 0);
    await external.focus();
    await expect(copy).toBeEnabled();
    await page.keyboard.press('Tab');
    await expect(copy).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(copyLabel);
    const bubble = page.locator('[data-slot="tooltip-content"]:visible');
    await expect(bubble.locator('svg')).toHaveCount(0);
    await page.keyboard.press('Enter');
    const summary = await page.evaluate(() => navigator.clipboard.readText());
    const lines = summary.split(/\r?\n/);
    expect(lines[0]).toBe('JamesFlare #75402 · ELO 1,995');
    expect(summary).toContain(lang === 'zh' ? '最近一场：K/D' : 'Latest match: K/D');
    expect(lines.at(-1)).toBe(`${BATRACE_ORIGIN}/player/75402`);
  });
}
