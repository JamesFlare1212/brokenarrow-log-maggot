import { expect, test } from '@playwright/test';

for (const touch of [false, true]) {
  test.describe(touch ? 'touch control scale' : 'desktop control scale', () => {
    test.use({ hasTouch: touch, viewport: { width: touch ? 390 : 1280, height: 850 } });
    test('page actions, view options and field frames use the same height', async ({ page }) => {
      await page.route('**/__fixtures/rpc', async (route) => {
        if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        Object.assign(body.value.config, {
          lang: touch ? 'en' : 'zh',
          analyticsChoiceSaved: true,
          sidebarCollapsed: true,
        });
        await route.fulfill({ response, json: body });
      });
      const actions = touch ? 44 : 36;
      const cases: Array<[string, string, number]> = [
        ['current', '.page-current .session-actions button', actions],
        ['radar', '.page-radar .session-actions button', actions],
        [
          'players',
          '.player-search-controls :is([data-slot="input-group"], button[type="submit"])',
          actions,
        ],
        ['archive', '.archive-toolbar :is(button:not([role="switch"]), select)', actions],
        ['replays', '.replay-library .panel-card-actions button', actions],
        ['decks', '.deck-columns section > .actions button', actions],
        ['bans', '.bans-toolbar :is(button, [data-slot="input-group"])', actions],
        ['archive/match/9484902', '.topbar button', 32],
      ];
      for (const [route, selector, height] of cases) {
        await page.goto('/#' + route);
        if (route.startsWith('archive/match/'))
          await expect(page.locator('.match-detail-navigation')).toBeVisible();
        const controls = page.locator(selector).filter({ visible: true });
        await expect(controls.first(), route).toBeVisible();
        await expect
          .poll(
            () =>
              controls.evaluateAll((els) => [
                ...new Set(els.map((el) => el.getBoundingClientRect().height)),
              ]),
            { message: route },
          )
          .toEqual([height]);
        const overflow = await controls.evaluateAll((els) =>
          els
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.x < -1 || rect.right > innerWidth + 1;
            })
            .map((el) => el.textContent),
        );
        expect(overflow, route).toEqual([]);
      }
      await page.locator('.topbar a[href="#archive"]').click();
      await page.getByRole('radio', { name: touch ? 'List view' : '列表视图' }).click();
      const split = page.locator('.archive-table [role="group"]').first().getByRole('button');
      await expect(split).toHaveCount(2);
      for (const button of await split.all()) await expect(button).toHaveCSS('height', '28px');
    });
  });
}
