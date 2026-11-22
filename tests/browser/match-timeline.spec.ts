import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, locale: 'zh' | 'en' = 'zh') {
  await page.route('**/__fixtures/rpc', async (route) => {
    if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    Object.assign(body.value.config, {
      lang: locale,
      sidebarCollapsed: true,
      analyticsEnabled: false,
      analyticsChoiceSaved: true,
    });
    await route.fulfill({ response, json: body });
  });
}

test('compact overview keeps recon selection and inspection in the event row', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await prepare(page);
  await page.goto('/#archive/match/9485454');
  await page.getByRole('tab', { name: '时间线', exact: true }).click();
  const timeline = page.getByTestId('match-timeline');
  const row = timeline.getByTestId('moment-row').filter({ hasText: 'RQ-170 Sentinel' }).first();
  const trigger = row.getByRole('button', { name: /RQ-170 Sentinel/ });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(timeline.getByTestId('compact-event-summary')).toHaveCount(0);
  const inspect = row.getByRole('button', { name: /附近 5 分钟/ });
  await expect(inspect).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await inspect.click();
  await expect(timeline.getByTestId('event-context')).toBeVisible();
});

for (const locale of ['zh', 'en'] as const) {
  test(`match detail tab underlines follow the ${locale} label width`, async ({ page }) => {
    await prepare(page, locale);
    await page.goto('/#archive/match/9485454');
    const tabs = page.getByTestId('match-detail-views').getByRole('tab');
    await expect(tabs).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    for (const tab of await tabs.all()) {
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const difference = await tab.evaluate((el) => {
        const text = document.createRange();
        text.selectNodeContents(el);
        return Math.abs(
          text.getBoundingClientRect().width - parseFloat(getComputedStyle(el, '::after').width),
        );
      });
      expect(difference).toBeLessThan(1);
    }
  });
  test(`recorded match timeline integrates with the archive, nested scrolling and ${locale} UI`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
    await prepare(page, locale);
    const requests: Array<{ fid: string; force: boolean }> = [];
    page.on('request', (request) => {
      if (!request.url().endsWith('/__fixtures/rpc') || request.method() !== 'POST') return;
      const body = request.postDataJSON();
      if (body.method === 'matches.timeline') requests.push(body.input);
    });
    await page.goto('/#archive/match/9485138');
    const detail = page.locator('.match-detail-page');
    await expect(detail.getByRole('heading', { name: 'Baltiisk', exact: true })).toBeVisible();
    await expect(detail.locator('.match-player-cell').first()).toBeVisible();
    expect(requests).toHaveLength(0);
    await detail
      .getByRole('tab', { name: locale === 'zh' ? '时间线' : 'Timeline', exact: true })
      .click();
    const timeline = detail.getByTestId('match-timeline');
    await expect(timeline.getByTestId('moment-row')).toHaveCount(6);
    // The development shell intentionally runs React StrictMode effect replay.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.length).toBeLessThanOrEqual(2);
    expect(requests.every((request) => request.fid === '9485138' && !request.force)).toBe(true);
    await expect(timeline.getByTestId('readout-time')).toContainText('22:19');
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await timeline
      .getByTestId('moment-row')
      .getByRole('button', { name: /Ka-50 Akula/ })
      .click();
    await expect(timeline.getByTestId('readout-time')).toContainText('00:03');
    await timeline
      .getByRole('button', {
        name: locale === 'zh' ? '查看 00:03 附近 5 分钟' : 'Inspect 5 minutes around 00:03',
        exact: true,
      })
      .click();
    await expect(
      timeline.getByRole('radio', { name: locale === 'zh' ? '5 分钟' : '5 minutes', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await timeline
      .getByRole('button', { name: locale === 'zh' ? '分钟数据' : 'Minute data', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: /分钟数据|Minute data/ });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', {
        name: locale === 'zh' ? '定位到 03:00' : 'Seek to 03:00',
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(timeline.getByTestId('readout-time')).toContainText('03:00');
    const force = timeline.getByTestId('force-chart').locator('xpath=..');
    await expect(force).toHaveAttribute('aria-valuenow', '180');
    await expect(force).toBeFocused();
    const back = page
      .locator('.topbar')
      .getByRole('link', { name: locale === 'zh' ? '对局档案' : 'Match archive', exact: true });
    expect(
      await back.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const players = timeline.getByRole('combobox', {
      name: locale === 'zh' ? '筛选事件玩家' : 'Filter events by player',
    });
    await players.click();
    const options = page.getByRole('listbox');
    await expect(options.getByRole('group', { name: 'Bravo' })).toBeVisible();
    await options
      .getByRole('group', { name: 'Alpha' })
      .getByRole('option', { name: 'JamesFlare', exact: true })
      .click();
    await expect(players).toHaveText('JamesFlare');
    const highlights = timeline.getByRole('tab', {
      name: locale === 'zh' ? '高光' : 'Highlights',
      exact: true,
    });
    await highlights.click();
    await expect(highlights).toHaveAttribute('aria-selected', 'true');
    expect(
      await highlights.evaluate((el) => {
        const label = document.createRange();
        label.selectNodeContents(el);
        return Math.abs(
          label.getBoundingClientRect().width - parseFloat(getComputedStyle(el, '::after').width),
        );
      }),
    ).toBeLessThan(1);
    await expect(
      timeline.getByText(locale === 'zh' ? '没有匹配的时刻' : 'No matching moments', {
        exact: true,
      }),
    ).toBeVisible();
    const clearFilters = timeline.getByRole('button', {
      name: locale === 'zh' ? '清除筛选' : 'Clear filters',
      exact: true,
    });
    await expect(clearFilters).toHaveCSS('height', '32px');
    await clearFilters.click();
    await expect(timeline.getByTestId('moment-row')).toHaveCount(6);
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(timeline.getByTestId('overview-chart')).toBeVisible();
    await timeline
      .getByRole('button', {
        name: locale === 'zh' ? '查看5分钟细节' : 'Inspect 5-minute detail',
        exact: true,
      })
      .click();
    await expect(timeline.getByTestId('analysis-context')).toBeVisible();
    await timeline
      .getByRole('button', { name: locale === 'zh' ? '返回概览' : 'Back to overview', exact: true })
      .click();
    await expect(timeline.getByTestId('overview-chart')).toBeVisible();
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page
      .locator('.topbar')
      .getByRole('button', {
        name: locale === 'zh' ? '刷新当前对局' : 'Refresh current match',
        exact: true,
      })
      .click();
    await expect.poll(() => requests.some((request) => request.force)).toBe(true);
    await expect(timeline.getByTestId('moment-row')).toHaveCount(6);
    await page.screenshot({
      path: `.test-data/timeline-integration/archive-${locale}.png`,
      animations: 'disabled',
    });
    await detail
      .getByRole('tab', { name: locale === 'zh' ? '核心战绩' : 'Core stats', exact: true })
      .click();
    await expect(detail.locator('.match-player-cell').first()).toBeVisible();
  });
}

for (const locale of ['zh', 'en'] as const) {
  test(
    'compact archive titlebar keeps the return link, identity and controls visible in ' + locale,
    async ({ page }) => {
      await prepare(page, locale);
      await page.goto('/#archive/match/9485454');
      const header = page.locator('.topbar');
      const actions = header.getByRole('group', {
        name: locale === 'zh' ? '对局详情' : 'Match details',
      });
      const crumb = header.locator('[aria-current="page"]');
      const back = header.locator('a[href="#archive"]');
      await expect(actions.getByRole('button')).toHaveCount(3);
      await expect(page.locator('.match-detail-page .match-detail-navigation')).toHaveCount(0);
      for (const width of [1280, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 750 });
        await expect(back).toBeVisible();
        await expect(crumb).toContainText('#9485454');
        await expect
          .poll(() =>
            crumb.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.clientWidth > 0),
          )
          .toBe(true);
        const linkBox = (await back.boundingBox())!;
        const actionBox = (await actions.boundingBox())!;
        expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(actionBox.x);
        expect(
          Math.abs(linkBox.y + linkBox.height / 2 - actionBox.y - actionBox.height / 2),
        ).toBeLessThan(2);
        expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      await back.focus();
      await back.press('Enter');
      await expect(page).toHaveURL(/#archive$/);
      await expect(actions).toHaveCount(0);
    },
  );
}

test('legacy timing gaps and local-only matches remain honest empty states', async ({
  page,
  request,
}) => {
  await prepare(page);
  await page.goto('/#archive/match/8105853');
  await page.getByRole('tab', { name: '时间线', exact: true }).click();
  await expect(page.getByText('暂无时间线数据', { exact: true })).toBeVisible();
  await expect(page.getByTestId('timeline-card')).toHaveCount(0);
  const response = await request.post('/__fixtures/rpc', {
    data: { method: 'matches.list', input: {} },
  });
  const local = (await response.json()).value.find((match: { fid: string | null }) => !match.fid);
  expect(local).toBeTruthy();
  await page.goto(`/#archive/match/${encodeURIComponent(local.id)}`);
  await page.getByRole('tab', { name: '时间线', exact: true }).click();
  await expect(
    page.getByText('本地日志没有完整的单位时间记录，无法还原时间线。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('timeline-card')).toHaveCount(0);
});

test('explicit minute inspection keeps the bucket ending at a selected event start', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await prepare(page, 'en');
  await page.goto('/#archive/match/9485138');
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  const timeline = page.getByTestId('match-timeline');
  await timeline.getByTestId('moment-row').getByRole('button', { name: /19:00/ }).click();
  await expect(timeline.getByTestId('loss-time')).toHaveText('19:00–20:00');
  const minuteData = timeline.getByRole('button', { name: 'Minute data', exact: true });
  await minuteData.click();
  const dialog = page.getByRole('dialog', { name: /Minute data/ });
  await dialog.getByRole('button', { name: 'Seek to 19:00', exact: true }).click();
  await expect(timeline.getByTestId('loss-time')).toHaveText('18:00–19:00');
  await minuteData.click();
  await expect(dialog.locator('tr[aria-current="time"]')).toContainText('19:00');
});

test('match dialog supports nested minute navigation without closing the match', async ({
  page,
  request,
}) => {
  await prepare(page);
  await page.goto('/#archive/match/9485138');
  const detail = page.locator('.match-detail-page');
  await detail
    .getByRole('button', { name: 'JamesFlare', exact: true })
    .click({ button: 'right', position: { x: 32, y: 14 } });
  await page.getByRole('menuitem', { name: '查看玩家资料' }).click();
  const profile = page.locator('.profile-dialog');
  await expect(profile).toBeVisible();
  const matches = profile.locator('td[data-column="matchId"] button');
  await expect(matches.first()).toBeVisible();
  let chosen = -1;
  for (let index = 0; index < (await matches.count()); index++) {
    const fid = (await matches.nth(index).innerText()).replace('#', '').trim();
    const response = await request.post('/__fixtures/rpc', {
      data: { method: 'matches.timeline', input: { fid, force: false } },
    });
    if ((await response.json()).value?.status === 'ready') {
      chosen = index;
      break;
    }
  }
  expect(chosen).toBeGreaterThanOrEqual(0);
  await matches.nth(chosen).click();
  const match = page.locator('.match-dialog');
  await expect(match).toBeVisible();
  await match.getByRole('tab', { name: '时间线', exact: true }).click();
  const timeline = match.getByTestId('match-timeline');
  await expect(timeline.getByTestId('timeline-card')).toBeVisible();
  if (await timeline.getByTestId('overview-chart').count())
    await timeline.getByRole('button', { name: '查看5分钟细节', exact: true }).click();
  await timeline.getByRole('button', { name: '分钟数据', exact: true }).click();
  const minute = page.getByRole('dialog', { name: /分钟数据/ });
  await minute.getByRole('button', { name: '回到顶部', exact: true }).click();
  await minute.getByRole('button', { name: '定位到 01:00', exact: true }).click();
  await expect(minute).toHaveCount(0);
  await expect(match).toBeVisible();
  await expect(timeline.getByTestId('readout-time')).toContainText('01:00');
  const navigation = await timeline.getByTestId('analysis-context').boundingBox();
  const plotCard = await timeline.getByTestId('timeline-card').boundingBox();
  expect(plotCard!.y).toBeGreaterThanOrEqual(navigation!.y + navigation!.height + 8);
  expect(
    await match
      .locator('.dialog-body')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.screenshot({
    path: '.test-data/timeline-integration/dialog.png',
    animations: 'disabled',
  });
});
