import { expect, test, type Page } from '@playwright/test';
import type { PlayerReport } from '../../packages/contracts/src/index';
import { translate } from '../../apps/web/src/hooks/useI18n';

const player = { id: '8863', name: 'Spacing Player', level: 35, rating: 1728 };
const report: PlayerReport = {
  ...player,
  fallback: false,
  matchCount: 12,
  sampleCount: 12,
  elo: player.rating,
  kd: 1.4,
  dmr: 1.6,
  winRate: 50,
  wins: 6,
  losses: 6,
  updatedAt: 1794268800000,
  stale: false,
  ratingTrend: [],
  recentMatches: [],
  favUnits: [],
  categories: [],
  style: null,
  mapStats: ['Dam', 'Airport'].map((name, mapId) => ({
    mapId,
    name,
    matchCount: 6,
    winRate: 50,
    avgKd: 1.4,
    avgDestructionScore: 2500,
  })),
};

async function expectCardGaps(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const layout = page.locator(selector).filter({ visible: true });
    await expect(layout).toHaveCount(1);
    await expect(layout).toHaveCSS('row-gap', '16px');
    await expect(layout).toHaveCSS('column-gap', '16px');
  }
}

for (const [width, lang] of [
  [1440, 'en'],
  [900, 'zh'],
  [390, 'en'],
] as const) {
  test(`card layouts retain 16px gaps at ${width}px in ${lang}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/__fixtures/rpc', async (route) => {
      const { method } = route.request().postDataJSON();
      if (method === 'app.bootstrap') {
        const response = await route.fetch();
        const body = await response.json();
        Object.assign(body.value.config, {
          lang,
          sidebarWidth: 240,
          sidebarCollapsed: false,
          analyticsEnabled: false,
          analyticsChoiceSaved: true,
        });
        return route.fulfill({ response, json: body });
      }
      const values: Record<string, unknown> = {
        'players.search': { source: 'local', players: [player] },
        'players.report': report,
        'players.profile': {
          id: player.id,
          name: player.name,
          names: [],
          firstSeen: null,
          lastSeen: null,
          encounters: [],
          banned: null,
          recentMatches: [],
          recentError: null,
          latestElo: player.rating,
          info: null,
        },
        'players.maggot': {
          id: player.id,
          complete: true,
          index: null,
          averageRank: null,
          trend: 'flat',
          rows: [],
          calls: 0,
          warning: null,
        },
        'decks.list': { found: true, decksDir: '', backupsDir: '', decks: [], backups: [] },
      };
      return method in values
        ? route.fulfill({ json: { value: values[method] } })
        : route.continue();
    });
    for (const [route, selectors] of [
      ['current', ['.dashboard', '.metrics-grid', '.dashboard-grid', '.dashboard-side']],
      ['replays', ['.replays-panel', '.replay-workspace']],
      ['decks', ['.decks-panel', '.deck-columns']],
      [
        'settings/appearance',
        ['.appearance-settings', '.appearance-modes', '.appearance-theme-grid'],
      ],
      ['settings/recording', ['.recording-settings']],
    ] as const) {
      await page.goto('/#' + route);
      await expectCardGaps(page, [...selectors]);
      if (route === 'current') {
        const gaps = await page.locator('.dashboard').evaluate((dashboard) => {
          const sections = Array.from(
            dashboard.querySelectorAll(
              ':scope > .metrics-grid, :scope > .session-card, :scope > .dashboard-grid',
            ),
            (node) => node.getBoundingClientRect(),
          );
          const cards = Array.from(
            dashboard.querySelectorAll('.metrics-grid > [data-slot=card]'),
            (node) => node.getBoundingClientRect(),
          );
          return [
            cards[1]!.left - cards[0]!.right,
            ...sections.slice(1).map((section, index) => section.top - sections[index]!.bottom),
          ];
        });
        for (const gap of gaps) expect(gap).toBeCloseTo(16, 1);
        await page.screenshot({ path: testInfo.outputPath('dashboard.png') });
      }
    }

    const label = (key: string) => translate(lang, key);
    await page.goto('/#players');
    await page.getByRole('searchbox', { name: label('searchLabel') }).fill(player.name);
    await page.getByRole('button', { name: label('search'), exact: true }).click();
    await page.getByRole('button', { name: /^Spacing Player/ }).click();
    await page.getByRole('button', { name: label('mapStatistics'), exact: true }).click();
    await expectCardGaps(page, [
      '.players-panel',
      '.players-workspace',
      '.player-report-panel',
      '.report-content',
      '.stats',
      '.profile-analysis-grid',
      '.map-performance-grid',
    ]);
    // Small-card density is independent of the surrounding layout gap.
    await expect(page.locator('.stats > [data-slot=card]').first()).toHaveCSS(
      'padding-top',
      '12px',
    );

    await page.getByRole('button', { name: label('investigate'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectCardGaps(page, [
      '.profile-dialog .dialog-body',
      '.profile-dialog .profile-overview',
      '.profile-dialog .stats',
      '.profile-dialog .profile-analysis-grid',
      '.profile-dialog .profile-analysis-sidebar',
    ]);
    await page.screenshot({ path: testInfo.outputPath('profile.png') });
    await page.getByRole('button', { name: label('close'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
