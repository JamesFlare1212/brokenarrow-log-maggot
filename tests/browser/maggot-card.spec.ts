import { expect, test } from '@playwright/test';
import type { MaggotReport, PlayerProfile, PlayerReport } from '../../packages/contracts/src/index';
import { translate } from '../../apps/web/src/hooks/useI18n';

const player = { id: '8863', name: 'Scale Player', level: 35, rating: 1728 };
const report: PlayerReport = {
  id: player.id,
  name: player.name,
  level: 35,
  fallback: false,
  matchCount: 12,
  sampleCount: 12,
  elo: 1728,
  kd: 1.42,
  dmr: 1.63,
  winRate: 58.3,
  wins: 7,
  losses: 5,
  updatedAt: 1794268800000,
  stale: false,
  ratingTrend: [],
  recentMatches: [],
  mapStats: [],
  style: 'balanced_combat',
  favUnits: [{ name: 'Preview unit', value: 81240, spawn: 42, roi: 1.84 }],
  categories: [{ key: 'infantry', pct: 38.4, totalCost: 82600 }],
};
const profile: PlayerProfile = {
  id: player.id,
  name: player.name,
  names: [],
  firstSeen: null,
  lastSeen: null,
  encounters: [],
  banned: null,
  recentMatches: [],
  recentError: null,
  latestElo: 1728,
  info: null,
};
const analysis: MaggotReport = {
  id: player.id,
  complete: true,
  index: 7.5,
  averageRank: 3.6,
  trend: 'up',
  calls: 12,
  warning: null,
  rows: Array.from({ length: 12 }, (_, index) => ({
    matchId: String(9565049 - index),
    won: true,
    mvpRank: 3,
    killRank: 3,
    lossRank: 3,
    kdRank: 3,
    eloDelta: 14,
  })),
};

for (const [locale, mode, width, height] of [
  ['zh', 'dark', 1280, 900],
  ['en', 'light', 1280, 700],
  ['zh', 'light', 900, 900],
  ['en', 'dark', 900, 700],
] as const) {
  test(`${locale} scale card at ${width}x${height} in ${mode} mode preserves tooltip and endpoint readability`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    let index = 7.5;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/__fixtures/rpc', async (route) => {
      const request = route.request().postDataJSON();
      if (request.method === 'app.bootstrap') {
        const response = await route.fetch();
        const body = await response.json();
        Object.assign(body.value.config, {
          lang: locale,
          themeMode: mode,
          analyticsEnabled: false,
          analyticsChoiceSaved: true,
        });
        return route.fulfill({ response, json: body });
      }
      const values: Record<string, unknown> = {
        'players.search': { source: 'network', players: [player] },
        'players.report': report,
        'players.profile': profile,
        'players.maggot': { ...analysis, index },
      };
      return request.method in values
        ? route.fulfill({ json: { value: values[request.method] } })
        : route.continue();
    });
    const label = (key: string, vars: Record<string, string | number> = {}) =>
      translate(locale, key, vars);
    await page.goto('/#players');
    await page.getByRole('searchbox', { name: label('searchLabel') }).fill(player.name);
    await page.getByRole('button', { name: label('search'), exact: true }).click();
    await page.getByRole('button', { name: /^Scale Player/ }).click();
    await page.getByRole('button', { name: label('investigate'), exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: `${player.name} · #${player.id}`,
      exact: true,
    });
    const card = dialog.getByRole('region', { name: label('maggot'), exact: true });
    await expect(
      card.getByRole('img', { name: label('maggotScaleValue', { value: '7.5' }) }),
    ).toBeVisible();
    // Finish modal entry and initial focus before measuring layout or focusing the explanation.
    await dialog.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
    });
    await page.evaluate(() => document.fonts.ready);
    const scope = label('maggotSample', { n: 12 });
    await expect(card.getByText(scope, { exact: true })).toHaveCount(0);
    const info = card.getByRole('button', { name: label('maggotSampleInfo') });
    // Radix dismisses hints on ancestor scroll, so finish scrolling before testing focus.
    await info.evaluate((button) =>
      button.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'instant',
      }),
    );
    await info.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(info).toBeInViewport({ ratio: 1 });
    await info.focus();
    await expect(info).toBeFocused();
    const tooltip = page.locator('[data-slot=tooltip-content]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(scope);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(dialog).toBeVisible();
    const cardHeight = (await card.boundingBox())!.height;
    await info.click();
    const pinned = page.locator('[data-slot=popover-content]');
    await expect(pinned).toBeVisible();
    await expect(pinned).toContainText(scope);
    expect((await card.boundingBox())!.height).toBe(cardHeight);
    await page.keyboard.press('Escape');
    await expect(pinned).toHaveCount(0);
    await expect(dialog).toBeVisible();
    for (index of [0, 10]) {
      await dialog.getByRole('button', { name: label('refresh'), exact: true }).click();
      const scale = card.getByRole('img', {
        name: label('maggotScaleValue', { value: String(index) }),
      });
      await expect(scale).toBeVisible();
      const marker = (await scale.locator('path').boundingBox())!;
      const bounds = (await scale.boundingBox())!;
      expect(marker.x).toBeGreaterThanOrEqual(bounds.x);
      expect(marker.x + marker.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      const coloredRange = await scale
        .locator('rect')
        .evaluateAll(
          (nodes) =>
            nodes.at(-1)!.getBoundingClientRect().right - nodes[0]!.getBoundingClientRect().left,
        );
      expect(coloredRange).toBeCloseTo(bounds.width - 12, 0);
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
