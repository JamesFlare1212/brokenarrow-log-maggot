import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = resolve(root, '.test-data/previews/timeline-qa');
await mkdir(directory, { recursive: true });
// Preserve native scrollbars in reference captures, as in the actual application.
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const errors = [];
const results = [];

async function verifyMinuteContinuation(surface, label) {
  const dialog = surface.getByRole('dialog');
  const viewport = dialog.locator('[data-slot="table-container"]');
  const next = dialog.getByRole('button', { name: '查看下一段', exact: true });
  const previous = dialog.getByRole('button', { name: '查看上一段', exact: true });
  const top = dialog.getByRole('button', { name: '回到顶部', exact: true });
  const status = dialog.getByTestId('table-scroll-status');
  const region = dialog.getByRole('region', { name: '分钟数据表', exact: true });
  const positionTitle = await dialog.getByRole('heading').innerText();
  assert.match(positionTitle, /当前定位/);
  const assertEnd = async () => {
    await expect(next).toBeDisabled();
    await expect(status).toHaveText('浏览 19–24 / 24 条');
    const bottom = await viewport.evaluate((element) => {
      const last = element.querySelector('tbody tr:last-child').getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return {
        remaining: element.scrollHeight - element.scrollTop - element.clientHeight,
        last: last.bottom,
        bottom: bounds.bottom,
        top: element.scrollTop,
      };
    });
    assert(
      bottom.remaining <= 1 && bottom.last <= bottom.bottom + 1 && bottom.top > 0,
      `${label}: terminal row must be fully revealed`,
    );
  };
  await expect(next).toBeEnabled();
  await next.click();
  await assertEnd();
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(status).toHaveText('浏览 14–19 / 24 条');
  await expect(dialog.getByRole('heading')).toHaveText(positionTitle);
  await next.click();
  await assertEnd();

  // Repeated forward input must never acquire the opposite action at the end.
  await region.focus();
  await surface.keyboard.press('ArrowUp');
  await expect(next).toBeEnabled();
  await next.dblclick({ delay: 60 });
  await assertEnd();

  // CSS-pixel rounding must not hide the last row behind the old 4px tolerance.
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 3;
  });
  await expect(status).toHaveText('浏览 19–23 / 24 条');
  await expect(next).toBeEnabled();
  await next.click();
  await assertEnd();

  await top.click();
  await expect(viewport).toHaveJSProperty('scrollTop', 0);
  await expect(top).toBeDisabled();
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(status).toHaveText('浏览 1–6 / 24 条');
  await expect(dialog.getByRole('heading')).toHaveText(positionTitle);
  results.push({
    check: `minute continuation ${label}`,
    passed: [
      'end visibility',
      'previous/next segment round trip',
      'disabled previous at start',
      'repeat-click direction',
      '3px remainder',
      'explicit return to top',
    ],
  });
}

async function verifyMinuteNavigation(surface, label, touch = false) {
  const activate = (locator) => (touch ? locator.tap() : locator.click());
  await activate(surface.getByRole('button', { name: '分钟数据', exact: true }));
  await activate(surface.getByRole('button', { name: '回到顶部', exact: true }));
  await activate(surface.getByRole('button', { name: '定位到 03:00', exact: true }));
  await expect(surface.getByRole('dialog')).toHaveCount(0);
  const cursor = surface.getByRole('slider', { name: '兵力曲线', exact: true });
  await expect(cursor).toHaveAttribute('aria-valuenow', '180');
  await expect(cursor).toBeFocused();
  await expect(surface.getByTestId('loss-time')).toHaveText('02:00–03:00');
  await activate(surface.getByRole('button', { name: '分钟数据', exact: true }));
  await expect(surface.getByRole('dialog').getByRole('heading')).toHaveText(
    '分钟数据 · 当前定位 02:00–03:00',
  );
  await surface.getByRole('button', { name: '定位到 02:00', exact: true }).focus();
  await surface.keyboard.press('Enter');
  await expect(cursor).toHaveAttribute('aria-valuenow', '120');
  await expect(cursor).toBeFocused();
  await activate(surface.getByRole('button', { name: '分钟数据', exact: true }));
  await activate(
    surface
      .getByRole('row')
      .filter({ has: surface.getByRole('button', { name: '定位到 05:00', exact: true }) })
      .getByRole('cell')
      .nth(2),
  );
  await expect(cursor).toHaveAttribute('aria-valuenow', '300');
  await activate(surface.getByTestId('moment-row').getByRole('button', { name: /14 个单位/ }));
  // Expanded narrow layouts already show evidence in the inspector.
  await activate(surface.getByRole('radio', { name: '5 分钟', exact: true }));
  await activate(surface.getByRole('button', { name: '分钟数据', exact: true }));
  await activate(surface.getByRole('button', { name: '回到顶部', exact: true }));
  await activate(surface.getByRole('button', { name: '定位到 03:00', exact: true }));
  await expect(cursor).toHaveAttribute('aria-valuenow', '180');
  await expect(surface.getByRole('radio', { name: '5 分钟', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    surface.getByTestId('force-chart').getByText('00:00', { exact: true }),
  ).toBeVisible();
  await activate(surface.getByRole('button', { name: '分钟数据', exact: true }));
  await surface.getByRole('region', { name: '分钟数据表', exact: true }).focus();
  await surface.keyboard.press('End');
  await activate(surface.getByRole('button', { name: '定位到 22:19', exact: true }));
  await expect(cursor).toHaveAttribute('aria-valuenow', '1339');
  await expect(surface.getByTestId('loss-time')).toHaveText('22:00–22:19');
  await activate(surface.getByRole('button', { name: '分钟数据', exact: true }));
  await expect(surface.getByRole('dialog').getByRole('heading')).toHaveText(
    '分钟数据 · 当前定位 22:00–22:19',
  );
  await activate(surface.getByRole('button', { name: '关闭', exact: true }));
  await cursor.focus();
  await surface.keyboard.press('Home');
  await activate(surface.getByRole('button', { name: '分钟数据', exact: true }));
  await expect(surface.getByRole('dialog').getByRole('heading')).toHaveText(
    '分钟数据 · 当前定位 开局 00:00',
  );
  await expect(
    surface.getByRole('dialog').getByText('开局兵力 · 估算点数', { exact: true }),
  ).toBeVisible();
  await activate(surface.getByRole('button', { name: '关闭', exact: true }));
  assert(await surface.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  results.push({
    check: `minute navigation ${label}`,
    passed: [
      'time button',
      'keyboard activation',
      'whole row',
      'out-of-window seek',
      'partial final minute',
      'chart focus',
    ],
  });
}

async function verifyPlotTouch(surface, label = '390px touch') {
  const cursor = surface.getByRole('slider', { name: '兵力曲线', exact: true });
  const tapForce = async (ratio, start, end) => {
    const area = surface.getByTestId('force-chart').getByTestId('plot-hit-area');
    await area.scrollIntoViewIfNeeded();
    const box = await area.boundingBox();
    const x = Math.round(box.x + box.width * ratio);
    const y = Math.round(box.y + box.height / 2);
    const expected = Math.round(start + ((x - box.x) / box.width) * (end - start));
    await surface.touchscreen.tap(x, y);
    await expect(cursor).toHaveAttribute('aria-valuenow', String(expected));
    await expect(surface.getByTestId('readout-time')).not.toContainText('悬停');
    const otherX = Math.round(box.x + box.width * (1 - ratio));
    const other = Math.round(start + ((otherX - box.x) / box.width) * (end - start));
    await surface.mouse.click(otherX, y);
    await expect(cursor).toHaveAttribute('aria-valuenow', String(other));
    await surface.mouse.click(x, y);
    await expect(cursor).toHaveAttribute('aria-valuenow', String(expected));
  };
  const overview = surface.getByTestId('overview-chart');
  assert.equal((await overview.boundingBox()).height, 180);
  await expect(overview.getByText('05:00', { exact: true })).toBeVisible();
  await expect(overview.getByText('15:00', { exact: true })).toBeVisible();
  assert.deepEqual(
    (await overview.locator('.recharts-cartesian-axis-tick-value').allTextContents()).filter(
      (text) => /^\d\d:\d\d$/.test(text),
    ),
    ['00:00', '05:00', '10:00', '15:00', '22:19'],
  );
  const overviewPlot = await overview.getByTestId('plot-hit-area').boundingBox();
  const overviewX = Math.round(overviewPlot.x + overviewPlot.width * 0.3);
  const overviewSecond = Math.round(((overviewX - overviewPlot.x) / overviewPlot.width) * 1339);
  await surface.touchscreen.tap(overviewX, Math.round(overviewPlot.y + overviewPlot.height / 2));
  await expect(cursor).toHaveAttribute('aria-valuenow', String(overviewSecond));
  await expect(surface.getByRole('radio', { name: '5 分钟', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(surface.getByRole('dialog')).toHaveCount(0);
  await surface.screenshot({
    path: resolve(directory, `overview-drill-${label.replaceAll(' ', '-')}.png`),
    animations: 'disabled',
  });
  await surface.getByRole('button', { name: '返回概览', exact: true }).tap();
  await surface.getByRole('button', { name: '点选查看附近5分钟', exact: true }).focus();
  await surface.keyboard.press('Enter');
  await expect(cursor).toHaveAttribute('aria-valuenow', String(overviewSecond));
  await surface.getByRole('button', { name: '返回概览', exact: true }).tap();
  await surface.getByRole('button', { name: '查看5分钟细节', exact: true }).tap();
  await expect(surface.getByRole('radio', { name: '5 分钟', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await surface.getByRole('radio', { name: '全局', exact: true }).tap();
  assert.equal(await surface.getByTestId('chart-input-hint').innerText(), '轻点定位');
  for (const mode of ['兵力', '兵力差', '净变化']) {
    await surface.getByRole('radio', { name: mode, exact: true }).tap();
    await tapForce(0.28, 0, 1339);
    await tapForce(0.72, 0, 1339);
  }
  await surface.getByRole('radio', { name: '兵力', exact: true }).tap();
  await surface
    .getByTestId('moment-row')
    .getByRole('button', { name: /14 个单位/ })
    .tap();
  await surface.getByRole('radio', { name: '5 分钟', exact: true }).tap();
  await surface
    .getByTestId('event-context')
    .getByRole('button', { name: '查看当前定位图表', exact: true })
    .tap();
  await tapForce(0.28, 1020, 1320);
  const lossBoxes = await surface
    .getByTestId('loss-chart')
    .locator('.recharts-bar-rectangle')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
  const lossBox = lossBoxes.sort((a, b) => b.height - a.height)[0];
  assert(lossBox.height > 0);
  const x = Math.round(lossBox.x + lossBox.width / 2);
  const y = Math.round(lossBox.y + lossBox.height / 2);
  await surface.touchscreen.tap(x, y);
  await expect(cursor).toHaveAttribute('aria-valuenow', '1200');
  await expect(surface.getByTestId('loss-time')).toHaveText('19:00–20:00');
  await surface.mouse.click(x, y);
  await expect(cursor).toHaveAttribute('aria-valuenow', '1200');
  await cursor.focus();
  await surface.keyboard.press('End');
  await expect(cursor).toHaveAttribute('aria-valuenow', '1339');
  await surface.getByTestId('loss-chart').getByText('22:19', { exact: true }).waitFor();
  const lastBar = surface.getByTestId('loss-chart').locator('.recharts-bar-rectangle').last();
  await lastBar.waitFor({ state: 'visible' });
  await surface.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const last = await lastBar.boundingBox();
  await surface.touchscreen.tap(
    Math.round(last.x + last.width / 2),
    Math.round(last.y + last.height / 2),
  );
  await expect(cursor).toHaveAttribute('aria-valuenow', '1339');
  await expect(surface.getByTestId('loss-time')).toHaveText('22:00–22:19');
  const area = await surface.getByTestId('force-chart').getByTestId('plot-hit-area').boundingBox();
  const beforeScroll = await surface.evaluate(() => scrollY);
  const cdp = await surface.context().newCDPSession(surface);
  const point = {
    x: Math.round(area.x + area.width * 0.5),
    y: Math.round(area.y + area.height * 0.8),
  };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  for (const dy of [20, 40, 70]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y - dy }],
    });
    await surface.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await surface.waitForFunction((before) => scrollY > before + 10, beforeScroll);
  await expect(cursor).toHaveAttribute('aria-valuenow', '1339');
  await cdp.detach();
  results.push({
    check: `plot pointer parity ${label}`,
    passed: [
      'cold touch without hover',
      'force/difference/change',
      'mouse parity',
      'five-minute scale',
      'loss column',
      'partial final minute',
      'vertical pan without seeking',
    ],
  });
}

async function verifyCompactBrowsing(surface) {
  await surface.setViewportSize({ width: 390, height: 900 });
  await surface.addStyleTag({ content: 'html { padding: 8px; background: var(--background); }' });
  const lastEvent = surface.getByTestId('moment-row').getByRole('button', { name: /14 个单位/ });
  const summary = surface.getByTestId('compact-event-summary');
  const players = surface.getByLabel('筛选事件玩家');
  const assertUncovered = async (control) => {
    assert(
      await control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        return y >= 0 && y <= innerHeight && element.contains(document.elementFromPoint(x, y));
      }),
      'Visible filter controls must not be covered by the overview or event summary',
    );
  };
  await lastEvent.tap();
  await expect(lastEvent).toHaveAttribute('aria-expanded', 'true');
  await expect(summary).toBeVisible();
  await surface.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.notEqual(
    await surface
      .getByTestId('timeline-card')
      .evaluate((element) => getComputedStyle(element).position),
    'sticky',
  );
  assert((await summary.boundingBox()).height <= 88);
  const selectedBounds = await lastEvent.locator('..').boundingBox();
  assert(
    selectedBounds.y >= 0 && selectedBounds.y + selectedBounds.height <= 900,
    'Expanding a late event must keep its header and evidence visible',
  );
  await assertUncovered(players);
  for (const name of ['全部', '高光', '损失', '侦察'])
    await assertUncovered(surface.getByRole('radio', { name, exact: true }));
  await expect(
    surface.getByRole('button', { name: '查看 19:00 附近 5 分钟', exact: true }),
  ).toHaveCount(1);
  await surface.screenshot({
    path: resolve(directory, 'mobile-collapsed-browse.png'),
    animations: 'disabled',
  });
  await surface.setViewportSize({ width: 390, height: 600 });
  await surface.mouse.wheel(0, 1200);
  await surface.waitForFunction(
    () =>
      document.querySelector('[data-testid="timeline-card"]').getBoundingClientRect().bottom <= 0,
  );
  const sticky = await summary.boundingBox();
  assert(sticky.y >= 0 && sticky.height <= 88);
  await players.scrollIntoViewIfNeeded();
  await assertUncovered(players);
  await players.selectOption('75402');
  await expect(summary).toHaveCount(0);
  await expect(surface.getByTestId('moment-row')).toHaveCount(2);
  await surface.getByRole('radio', { name: '高光', exact: true }).tap();
  await expect(surface.getByText('没有匹配的时刻', { exact: true })).toBeVisible();
  await surface.getByRole('button', { name: '清除筛选', exact: true }).tap();
  await expect(surface.getByTestId('moment-row')).toHaveCount(6);
  await surface.setViewportSize({ width: 390, height: 900 });
  await lastEvent.tap();
  await summary.getByRole('button', { name: '查看 19:00 附近 5 分钟', exact: true }).tap();
  await expect(surface.getByRole('slider', { name: '兵力曲线', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '1140',
  );
  await expect(surface.getByTestId('event-context')).toBeVisible();
  await expect(summary).toHaveCount(0);
  results.push({
    check: 'compact browsing',
    passed: [
      'late-event selection without filter occlusion',
      'non-sticky full overview',
      'small sticky summary after filters',
      'short-viewport scrolling',
      'filter recovery',
      'single event-inspection action',
    ],
  });
}

async function verifySelectionContext(surface) {
  const caveat = surface.getByTestId('estimate-caveat');
  await expect(caveat).toHaveText('非在场值 · 回收除外');
  assert((await caveat.boundingBox()).y + (await caveat.boundingBox()).height <= 844);
  await surface
    .getByTestId('moment-row')
    .getByRole('button', { name: /Ka-50 Akula/ })
    .tap();
  await surface.getByRole('button', { name: '查看 00:03 附近 5 分钟', exact: true }).tap();
  await surface.getByRole('button', { name: '展开分钟损失', exact: true }).tap();
  const plot = await surface.getByTestId('loss-chart').getByTestId('plot-hit-area').boundingBox();
  await surface.touchscreen.tap(
    Math.round(plot.x + plot.width * 0.7),
    Math.round(plot.y + plot.height / 2),
  );
  await expect(surface.getByTestId('readout-time')).toHaveText('定位 04:00');
  const context = surface.getByTestId('event-context');
  await expect(context.getByTestId('event-identity')).toContainText('所选');
  await expect(context.getByTestId('event-identity')).toContainText('Ka-50 Akula');
  await expect(context.getByTestId('event-identity')).toContainText('00:03–01:33');
  await expect(context.getByTestId('event-attribution')).toContainText('9神来啦 · 短时多杀');
  await expect(context).not.toContainText('04:00');
  await expect(context.getByTestId('context-evidence').getByText('6', { exact: true })).toHaveCount(
    1,
  );
  await expect(caveat).toBeVisible();
  await context.getByRole('button', { name: '查看当前定位图表', exact: true }).tap();
  await expect(surface.getByRole('slider', { name: '兵力曲线', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '240',
  );
  await surface.screenshot({
    path: resolve(directory, 'independent-event-and-cursor.png'),
    animations: 'disabled',
  });
  await surface
    .getByTestId('moment-row')
    .getByRole('button', { name: /Patriot PAC-3/ })
    .tap();
  await context.getByRole('button', { name: '查看当前定位图表', exact: true }).tap();
  await expect(context.getByTestId('event-attribution')).toContainText('HOKY · 快速阵亡');
  await expect(context.getByTestId('event-attribution')).toContainText('≈227');
  await expect(
    context.getByTestId('context-evidence').getByText('99 秒', { exact: true }),
  ).toBeVisible();
  await surface.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const contextBox = await context.boundingBox();
  const plotBox = await surface.getByTestId('timeline-card').boundingBox();
  assert(
    contextBox.y >= 0 &&
      plotBox.y >= contextBox.y + contextBox.height &&
      plotBox.y + plotBox.height <= 844,
    'Player, type, loss value, and plots must fit without returning to the list',
  );
  await surface.screenshot({
    path: resolve(directory, 'mobile-rapid-death-context.png'),
    animations: 'disabled',
  });
  results.push({
    check: 'selected-event context',
    passed: [
      'event interval distinct from current cursor',
      'evidence retained outside its interval',
      'chart return preserves inspected time',
      'upfront proxy and refund limitations',
      'player, event type, estimated loss, and lifetime remain in the inspector',
    ],
  });
}

async function verifyAnalysisNavigation(surface) {
  const back = surface.getByRole('button', { name: '返回概览', exact: true });
  const settle = () =>
    surface.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  await surface.getByRole('button', { name: '查看5分钟细节', exact: true }).tap();
  await expect(surface.getByTestId('analysis-context')).toBeVisible();
  await settle();
  const fromOverview = await back.boundingBox();
  assert(fromOverview.y >= 0 && fromOverview.y + fromOverview.height < 100);
  await expect(back).toHaveCount(1);
  await expect(surface.getByRole('button', { name: '收起图表', exact: true })).toHaveCount(0);
  await back.tap();
  await expect(
    surface.getByRole('button', { name: '点选查看附近5分钟', exact: true }),
  ).toBeFocused();
  await surface
    .getByTestId('moment-row')
    .getByRole('button', { name: /Ka-50 Akula/ })
    .tap();
  await surface.getByRole('button', { name: '查看 00:03 附近 5 分钟', exact: true }).tap();
  await expect(surface.getByTestId('event-context')).toBeVisible();
  await settle();
  const fromEvent = await back.boundingBox();
  assert(
    Math.abs(fromOverview.x - fromEvent.x) < 1 && Math.abs(fromOverview.y - fromEvent.y) < 1,
    'Both detail entry paths must put the overview exit in the same location',
  );
  await expect(back).toHaveCount(1);
  await surface.getByLabel('筛选事件玩家').selectOption('75402');
  await expect(surface.getByTestId('analysis-context')).toBeVisible();
  await surface.getByRole('button', { name: '查看当前定位图表', exact: true }).tap();
  await expect(back).toBeVisible();
  await back.tap();
  await expect(
    surface.getByRole('button', { name: '点选查看附近5分钟', exact: true }),
  ).toBeFocused();
  results.push({
    check: 'consistent analysis exit',
    passed: [
      'same label and top position for both entries',
      'single exit',
      'overview focus restored',
      'exit remains after clearing selection',
    ],
  });
}

async function verifyMarkerLabels(surface) {
  await surface.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const marks = surface
    .getByRole('group', { name: '关键时刻标记', exact: true })
    .getByRole('button');
  const bounds = await marks.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        label: element.textContent.trim(),
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        font: getComputedStyle(element).fontSize,
      };
    }),
  );
  const plot = await surface.getByTestId('plot-hit-area').first().boundingBox();
  bounds.forEach((mark, index) => {
    assert.match(mark.label, /^(Ka-50|Orion|RQ-4|Patriot|\d+阵亡|(?:(?:高光|侦察|损失)×\d+)+)$/);
    assert(mark.bottom <= plot.y, 'Marker labels must stay above the plotted values');
    assert.equal(mark.font, '14px');
    if (index > 0)
      assert(mark.left >= bounds[index - 1].right, 'Text event markers must not overlap');
  });
}

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  // Supply the application's ambient workspace behind the transparent embed.
  await page.addStyleTag({ content: 'html { padding: 8px; background: var(--background); }' });
  await page.getByRole('heading', { name: 'Baltiisk' }).waitFor();
  await page.locator('.recharts-line-curve').first().waitFor();
  await page
    .getByRole('group', { name: '关键时刻标记', exact: true })
    .getByRole('button')
    .first()
    .waitFor();
  const shot = async (name) => {
    const viewport = page.viewportSize();
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const dialog = (await page.getByRole('dialog').count()) > 0;
    if (!dialog) {
      // Playwright fullPage can measure the width before removing the native
      // scrollbar, then crop a wider reflow. Use an explicit all-visible canvas.
      const contentHeight = await page
        .getByRole('main')
        .evaluate((element) => element.getBoundingClientRect().height + 16);
      await page.setViewportSize({
        width: viewport.width,
        height: Math.max(viewport.height, Math.ceil(contentHeight)),
      });
      await page.evaluate(() => scrollTo(0, 0));
      if (name === 'filter-hover')
        await page.getByRole('radio', { name: '高光', exact: true }).hover();
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ animations: 'disabled' });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const content = dialog ? null : await page.getByRole('main').boundingBox();
    await page.screenshot({
      path: resolve(directory, `${name}.png`),
      ...(dialog
        ? {}
        : {
            clip: {
              x: 0,
              y: 0,
              width: viewport.width,
              height: Math.ceil(content.y + content.height + 8),
            },
          }),
      animations: 'disabled',
    });
    if (!dialog) {
      await page.setViewportSize(viewport);
      await page.evaluate((position) => scrollTo(position.x, position.y), scroll);
    }
  };
  const fit = async (label) => {
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      charts: [...document.querySelectorAll('[data-slot="chart"]')].map((e) => ({
        width: e.getBoundingClientRect().width,
        height: e.getBoundingClientRect().height,
      })),
    }));
    assert(bounds.scroll <= bounds.width, `${label}: horizontal overflow`);
    assert(
      bounds.charts.every((b) => b.width > 100 && b.height >= 60),
      `${label}: chart collapsed`,
    );
    await verifyMarkerLabels(page);
    results.push({ check: label, ...bounds });
  };
  await fit('desktop');
  await expect(page.getByTestId('estimate-caveat')).toHaveText('非在场值 · 回收除外');
  assert.equal(await page.getByTestId('chart-input-hint').innerText(), '点选或 ← → 定位');
  assert.equal(await page.getByTestId('moment-row').count(), 6);
  await shot('desktop');
  const chartDetail = await page.getByTestId('timeline-card').boundingBox();
  await page.screenshot({
    path: resolve(directory, 'desktop-chart-detail.png'),
    clip: { x: chartDetail.x, y: chartDetail.y, width: 640, height: 520 },
    animations: 'disabled',
  });
  await page
    .locator('section[aria-label="关键时刻"]')
    .screenshot({ path: resolve(directory, 'desktop-events-detail.png'), animations: 'disabled' });
  assert.equal(
    await page
      .getByTestId('force-chart')
      .locator('.recharts-cartesian-axis-tick-value')
      .first()
      .evaluate((e) => getComputedStyle(e).fontSize),
    '14px',
  );
  assert(
    (await page.getByTestId('timeline-card').boundingBox()).y +
      (await page.getByTestId('timeline-card').boundingBox()).height <=
      900,
  );
  const markers = page.getByRole('group', { name: '关键时刻标记', exact: true });
  assert.equal(await markers.getByRole('button').count(), 5);
  await markers.getByRole('button', { name: /短时多杀/ }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.activeElement?.closest('[data-testid="moment-row"]') !== null,
  );
  assert.equal(await page.getByTestId('readout-time').innerText(), '起点 00:03');
  await page.mouse.move(5, 5);
  await shot('marker-selected');
  await markers.getByRole('button', { name: /查看 2 个关键时刻/ }).click();
  await page.getByRole('dialog', { name: '2 个关键时刻', exact: true }).waitFor();
  const clusterBox = await page
    .getByRole('dialog', { name: '2 个关键时刻', exact: true })
    .boundingBox();
  const mainPlot = await page.getByTestId('force-chart').boundingBox();
  assert(
    clusterBox.y + clusterBox.height <= mainPlot.y + 36,
    'Desktop event choices should not cover plotted data',
  );
  await shot('marker-cluster');
  await page
    .getByRole('dialog', { name: '2 个关键时刻', exact: true })
    .getByRole('button', { name: /定位事件：Patriot PAC-3/ })
    .click();
  assert.equal(await page.getByTestId('readout-time').innerText(), '起点 13:46');
  await page.waitForFunction(
    () =>
      document.activeElement?.textContent?.includes('Patriot PAC-3') &&
      document.activeElement?.closest('[data-testid="moment-row"]'),
  );
  await page
    .getByTestId('moment-row')
    .getByRole('button', { name: /14 个单位/ })
    .click();
  assert.equal(await page.getByTestId('readout-time').innerText(), '起点 19:00');
  assert.equal(await page.getByTestId('loss-time').innerText(), '19:00–20:00');
  await page.getByRole('button', { name: '14 条记录', exact: true }).click();
  assert.equal(await page.getByRole('dialog').getByRole('row').count(), 15);
  await shot('expanded-records');
  await page.getByRole('button', { name: '查看下一段', exact: true }).click();
  const recordsViewport = page.getByRole('dialog').locator('[data-slot="table-container"]');
  assert(await recordsViewport.evaluate((e) => e.scrollTop > 0));
  await page.getByRole('button', { name: '查看上一段', exact: true }).click();
  await expect(recordsViewport).toHaveJSProperty('scrollTop', 0);
  await page.getByRole('button', { name: '查看下一段', exact: true }).click();
  const headerTop = (await page.getByRole('dialog').locator('thead').boundingBox()).y;
  assert(Math.abs(headerTop - (await recordsViewport.boundingBox()).y) < 2);
  await shot('records-scrolled');
  await page.getByRole('region', { name: '阵亡记录表' }).focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: '回到顶部', exact: true }).waitFor();
  await page.getByRole('button', { name: '回到顶部', exact: true }).click();
  await page.keyboard.press('Escape');
  assert(
    await page
      .getByRole('button', { name: '14 条记录', exact: true })
      .evaluate((e) => e === document.activeElement),
  );
  await page.getByRole('button', { name: '分钟数据', exact: true }).click();
  assert.equal(await page.getByRole('dialog').getByRole('row').count(), 26);
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText(
    '分钟数据 · 当前定位 19:00–20:00',
  );
  const currentMinuteRow = page.getByRole('dialog').locator('tr[aria-current="time"]');
  assert.match(await currentMinuteRow.innerText(), /^20:00/);
  assert.notEqual(
    await currentMinuteRow.evaluate((e) => getComputedStyle(e).backgroundColor),
    await page
      .getByRole('dialog')
      .locator('tbody tr')
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  );
  const minuteViewport = await page
    .getByRole('dialog')
    .locator('[data-slot="table-container"]')
    .boundingBox();
  const currentMinuteBox = await currentMinuteRow.boundingBox();
  assert(
    currentMinuteBox.y >= minuteViewport.y + 70 &&
      currentMinuteBox.y + currentMinuteBox.height <= minuteViewport.y + minuteViewport.height,
  );
  await shot('minute-data');
  const partialRows = await page.getByRole('dialog').evaluate((dialog) => {
    const viewport = dialog.querySelector('[data-slot="table-container"]').getBoundingClientRect();
    const headerBottom = dialog.querySelector('thead').getBoundingClientRect().bottom;
    return [...dialog.querySelectorAll('tbody tr')]
      .map((row) => row.getBoundingClientRect())
      .filter(
        (row) =>
          row.bottom > headerBottom + 1 &&
          row.top < viewport.bottom - 1 &&
          (row.top < headerBottom - 1 || row.bottom > viewport.bottom + 1),
      ).length;
  });
  assert.equal(partialRows, 0, 'Initial minute data should show complete rows');
  const headerClip = await page.getByRole('dialog').evaluate((dialog) => {
    const viewport = dialog.querySelector('[data-slot="table-container"]');
    const table = dialog.querySelector('table');
    const expected =
      viewport.getBoundingClientRect().top +
      table.tHead.getBoundingClientRect().height -
      table.tBodies[0].getBoundingClientRect().top;
    return {
      expected,
      actual: Number.parseFloat(table.tBodies[0].style.getPropertyValue('--table-clip-top')),
    };
  });
  assert(
    Math.abs(headerClip.actual - headerClip.expected) < 1,
    'Auto-scrolled body must not overlap the sticky headers after dialog animation',
  );
  await verifyMinuteContinuation(page, 'desktop');
  await page.keyboard.press('Escape');
  for (const mode of ['兵力差', '净变化', '兵力']) {
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await shot(mode === '兵力差' ? 'difference' : mode === '净变化' ? 'change' : 'force');
  }
  await page.getByRole('radio', { name: '兵力', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.getByRole('radio', { name: '兵力差', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.getByRole('radio', { name: '净变化', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  assert.equal(await page.getByTestId('force-chart').getByText('0', { exact: true }).count(), 1);
  await page.keyboard.press('Home');
  assert.equal(
    await page.getByRole('radio', { name: '兵力', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  await page.getByRole('radio', { name: '全局', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.getByRole('radio', { name: '5 分钟', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  await page.getByTestId('force-chart').getByText('17:00', { exact: true }).waitFor();
  assert.equal(await markers.getByRole('button').count(), 1);
  await shot('zoom-desktop');
  const lossBox = await page.getByTestId('loss-chart').boundingBox();
  await page.mouse.move(lossBox.x + 56 + (lossBox.width - 70) / 2, lossBox.y + 30);
  await page.getByTestId('readout-time').filter({ hasText: '悬停 20:00' }).waitFor();
  assert.equal(await page.getByTestId('loss-time').innerText(), '19:00–20:00');
  await page.mouse.move(5, 5);
  await page.getByRole('slider', { name: '定位对局时间' }).focus();
  await page.keyboard.press('End');
  await page.getByTestId('force-chart').getByText('22:19', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('readout-time').innerText(), '定位 22:19');
  await page.getByRole('radio', { name: '全局', exact: true }).click();
  await page.getByRole('button', { name: '数据口径' }).click();
  await page.getByText('数据口径', { exact: true }).last().waitFor();
  await shot('method');
  await page.keyboard.press('Escape');
  const initialAlpha = await page.getByTestId('alpha-value').innerText();
  await page.getByLabel('筛选事件玩家').selectOption('75402');
  assert.equal(await page.getByTestId('moment-row').count(), 2);
  assert.equal(await page.getByTestId('alpha-value').innerText(), initialAlpha);
  await page.getByRole('radio', { name: '高光', exact: true }).click();
  await page.getByText('没有匹配的时刻', { exact: true }).waitFor();
  assert.equal(await markers.getByRole('button').count(), 0);
  await shot('empty');
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  assert.equal(await page.getByTestId('moment-row').count(), 6);
  for (const name of ['侦察', '损失', '全部'])
    await page.getByRole('radio', { name, exact: true }).click();
  await page.getByRole('radio', { name: '全部', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.getByRole('radio', { name: '高光', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('End');
  assert.equal(
    await page.getByRole('radio', { name: '侦察', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('Home');
  await page
    .getByTestId('moment-row')
    .getByRole('button', { name: /Ka-50 Akula/ })
    .click();
  assert.equal(await page.getByTestId('event-evidence').getByText('90 秒').count(), 1);
  await page.getByRole('slider', { name: '兵力曲线', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByTestId('readout-time').innerText(), '定位 00:02');
  assert.equal(await page.getByTestId('event-evidence').getByText('90 秒').count(), 1);
  assert.equal(
    await page.getByRole('button', { name: '在列表中查看选中事件', exact: true }).count(),
    1,
  );
  await shot('anchored-scrub');
  await page.getByRole('button', { name: '前进 1 秒', exact: true }).click();
  assert.equal(await page.getByTestId('readout-time').innerText(), '起点 00:03');
  await page.getByRole('button', { name: '后退 1 秒', exact: true }).click();
  await page.getByRole('button', { name: '查看 00:03 附近 5 分钟', exact: true }).click();
  assert.equal(
    await page.getByRole('radio', { name: '5 分钟', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  assert.equal(await page.getByTestId('readout-time').innerText(), '起点 00:03');
  assert.equal(
    await page.getByRole('slider', { name: '兵力曲线', exact: true }).getAttribute('aria-valuenow'),
    '3',
  );
  await shot('highlight');
  assert(await page.getByRole('button', { name: '上一个关键时刻', exact: true }).isDisabled());
  await page.getByRole('button', { name: '下一个关键时刻', exact: true }).click();
  assert.equal(await page.getByTestId('readout-time').innerText(), '定位 02:39');
  await page.getByRole('button', { name: '上一个关键时刻', exact: true }).click();
  assert.equal(await page.getByTestId('readout-time').innerText(), '起点 00:03');
  await page.getByRole('radio', { name: '全局', exact: true }).click();
  await page.getByRole('button', { name: '清除选中', exact: true }).click();
  const accessibleChart = page.getByRole('slider', { name: '兵力曲线', exact: true });
  await accessibleChart.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await accessibleChart.getAttribute('aria-valuenow'), '4');
  assert.equal(await page.getByTestId('readout-time').innerText(), '定位 00:04');
  assert.equal(await accessibleChart.evaluate((e) => getComputedStyle(e).outlineStyle), 'solid');
  await shot('keyboard-focus');
  await page.keyboard.press('PageUp');
  assert.equal(await accessibleChart.getAttribute('aria-valuenow'), '64');
  await page.getByRole('slider', { name: '分钟损失图', exact: true }).focus();
  await page.keyboard.press('Home');
  assert.equal(await accessibleChart.getAttribute('aria-valuenow'), '0');
  assert.equal(await page.getByRole('application').count(), 0);
  const slider = page.getByRole('slider', { name: '定位对局时间' });
  await slider.focus();
  await page.keyboard.press('Home');
  assert.equal(await slider.getAttribute('aria-valuenow'), '0');
  await page.keyboard.press('End');
  assert.equal(await slider.getAttribute('aria-valuenow'), '1339');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await slider.getAttribute('aria-valuenow'), '1338');
  const chart = page.getByTestId('force-chart');
  const bounds = await chart.getByTestId('plot-hit-area').boundingBox();
  const clickPoint = { x: bounds.x + bounds.width * (576 / 1339), y: bounds.y + bounds.height / 2 };
  await page.mouse.move(clickPoint.x, clickPoint.y);
  await page.getByTestId('readout-time').filter({ hasText: '悬停' }).waitFor();
  const hoverTime = await page.getByTestId('readout-time').innerText();
  const pinnedTime = hoverTime.replace('悬停', '定位');
  const hoverValues = [
    await page.getByTestId('alpha-value').innerText(),
    await page.getByTestId('bravo-value').innerText(),
  ];
  await shot('hover');
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(page.getByTestId('readout-time')).toHaveText(pinnedTime);
  for (const dx of [0, 0.5]) {
    await page.mouse.move(clickPoint.x + dx, clickPoint.y);
    await expect(page.getByTestId('readout-time')).toHaveText(pinnedTime);
    assert.deepEqual(
      [
        await page.getByTestId('alpha-value').innerText(),
        await page.getByTestId('bravo-value').innerText(),
      ],
      hoverValues,
    );
  }
  await page.mouse.move(5, 5);
  await expect(page.getByTestId('readout-time')).toHaveText(pinnedTime);
  assert.deepEqual(
    [
      await page.getByTestId('alpha-value').innerText(),
      await page.getByTestId('bravo-value').innerText(),
    ],
    hoverValues,
  );
  const clicked = Number(await slider.getAttribute('aria-valuenow'));
  const [minute, seconds] = hoverTime.split(' ').at(-1).split(':').map(Number);
  assert.equal(clicked, minute * 60 + seconds);
  await page.mouse.move(clickPoint.x + 8, clickPoint.y);
  await expect(page.getByTestId('readout-time')).toContainText('悬停');
  await page.mouse.move(5, 5);
  await expect(page.getByTestId('readout-time')).toHaveText(pinnedTime);
  await page
    .getByTestId('moment-row')
    .getByRole('button', { name: /14 个单位/ })
    .click();
  await page.getByRole('button', { name: '切换浅色' }).click();
  await shot('light-desktop');
  const contrastPoints = await page
    .locator('path.recharts-rectangle[fill-opacity="0.9"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.width >= 3 && rect.height >= 8)
        .map((rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })),
    );
  assert(contrastPoints.length >= 2);
  const lossBackground = await page.getByTestId('loss-chart').boundingBox();
  const pixels = (await page.screenshot({ scale: 'css' })).toString('base64');
  const contrast = await page.evaluate(
    async ({ pixels, points, background }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${pixels}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const luminance = (point) => {
        const rgb = context.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
        const linear = [...rgb].slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      const base = luminance(background);
      return Math.min(
        ...points.map((point) => {
          const color = luminance(point);
          return (Math.max(base, color) + 0.05) / (Math.min(base, color) + 0.05);
        }),
      );
    },
    {
      pixels,
      points: contrastPoints,
      background: { x: lossBackground.x + 2, y: lossBackground.y + 40 },
    },
  );
  assert(contrast >= 3.2, `Light loss-bar contrast: ${contrast}`);
  results.push({ check: 'light loss-bar contrast', minimumRatio: contrast });
  await page.getByRole('button', { name: '切换深色' }).click();
  for (const width of [728, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('loss-chart').waitFor({ state: 'hidden' });
    await fit(`width-${width}`);
    assert.equal(await page.getByTestId('loss-chart').count(), 0);
    const firstMoment = await page.getByTestId('moment-row').first().boundingBox();
    assert(
      firstMoment.y + firstMoment.height <= 844,
      `First moment must fit the compact initial viewport at ${width}`,
    );
    await shot(`width-${width}`);
  }
  // Full-page screenshots can retain stale offscreen backdrop-filter tiles after
  // a viewport resize. Keep those diagnostics, plus fresh all-visible references.
  for (const width of [728, 390, 360]) {
    const reference = await browser.newPage({ viewport: { width, height: 1800 } });
    reference.on('pageerror', (error) => errors.push(error.message));
    await reference.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
    await reference.addStyleTag({
      content: 'html { padding: 8px; background: var(--background); }',
    });
    await reference.getByRole('heading', { name: 'Baltiisk' }).waitFor();
    await reference.locator('.recharts-line-curve').first().waitFor();
    await reference.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const thirdMoment = await reference.getByTestId('moment-row').nth(2).boundingBox();
    assert(
      thirdMoment.y + thirdMoment.height <= 844,
      `Three moments should fit the initial overview at ${width}`,
    );
    const content = await reference.getByRole('main').boundingBox();
    await reference.screenshot({
      path: resolve(directory, `width-${width}-fresh.png`),
      clip: { x: 0, y: 0, width, height: Math.ceil(content.y + content.height + 8) },
      animations: 'disabled',
    });
    await reference.close();
  }
  assert.equal(await page.getByTestId('overview-chart').count(), 1);
  await page.getByRole('button', { name: '查看5分钟细节', exact: true }).click();
  await page.getByTestId('force-chart').waitFor();
  await page.getByRole('button', { name: '返回概览', exact: true }).click();
  await page.getByTestId('force-chart').waitFor({ state: 'hidden' });
  assert.notEqual(
    await page.getByTestId('timeline-card').evaluate((e) => getComputedStyle(e).position),
    'sticky',
  );
  assert.equal(await page.getByTestId('compact-event-summary').count(), 1);
  await page.setViewportSize({ width: 360, height: 700 });
  await page.mouse.wheel(0, 400);
  await page.getByTestId('moment-row').getByRole('button', { name: /Orion/ }).click();
  assert.equal(await page.getByTestId('readout-time').innerText(), '定位 02:39');
  assert.equal(await page.getByTestId('force-chart').count(), 0);
  await page.screenshot({
    path: resolve(directory, 'mobile-compact.png'),
    fullPage: false,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole('button', { name: '查看5分钟细节', exact: true }).click();
  await page.getByTestId('force-chart').waitFor();
  await page.getByRole('button', { name: '返回概览', exact: true }).click();
  await page.getByTestId('force-chart').waitFor({ state: 'hidden' });
  await page
    .getByTestId('moment-row')
    .getByRole('button', { name: /Ka-50 Akula/ })
    .click();
  await page.getByRole('button', { name: '查看 00:03 附近 5 分钟', exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '兵力曲线',
  );
  assert(await accessibleChart.evaluate((e) => e === document.activeElement));
  const visibleChart = await accessibleChart.boundingBox();
  assert(visibleChart.y >= 0 && visibleChart.y + visibleChart.height <= 900);
  assert.equal(await page.getByTestId('readout-time').innerText(), '起点 00:03');
  await shot('mobile-event-navigation');
  assert(await page.getByTestId('event-context').isVisible());
  const nextEvent = page
    .getByTestId('event-context')
    .getByRole('button', { name: '下一个关键时刻', exact: true });
  const previousEvent = page
    .getByTestId('event-context')
    .getByRole('button', { name: '上一个关键时刻', exact: true });
  await expect(previousEvent).toBeDisabled();
  for (const [index, time] of ['02:39', '08:06', '13:00', '13:46', '19:00'].entries()) {
    await nextEvent.focus();
    await page.keyboard.press('Enter');
    await page.mouse.move(2, 2);
    await expect(page.getByTestId('event-position')).toHaveText(`${index + 2}/6`);
    await expect(page.getByTestId('readout-time')).toContainText(time);
    const plot = await accessibleChart.boundingBox();
    const facts = await page.getByTestId('event-context').boundingBox();
    const plotCard = await page.getByTestId('timeline-card').boundingBox();
    assert(
      plotCard.y >= facts.y + facts.height,
      'Sticky inspector must not cover chart controls after paging',
    );
    assert(
      facts.y >= 0 && facts.y + facts.height <= plot.y,
      'Event pager and evidence stay above the visible plot',
    );
    assert(plot.y + plot.height <= 900);
    if (index < 4) await expect(nextEvent).toBeFocused();
  }
  await expect(nextEvent).toBeDisabled();
  for (let index = 5; index >= 1; index--) {
    await previousEvent.click();
    await page.mouse.move(2, 2);
    await expect(page.getByTestId('event-position')).toHaveText(`${index}/6`);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const contextBounds = await page.getByTestId('event-context').boundingBox();
    assert(
      (await page.getByTestId('timeline-card').boundingBox()).y >=
        contextBounds.y + contextBounds.height,
      'Repeated reverse paging must not accumulate sticky scroll drift',
    );
  }
  await expect(previousEvent).toBeDisabled();
  await nextEvent.click();
  await page.mouse.move(2, 2);
  assert.equal(await page.getByTestId('readout-time').innerText(), '定位 02:39');
  assert.match(await page.getByTestId('event-context').innerText(), /02:39/);
  assert.equal(
    await page.getByTestId('event-context').evaluate((e) => getComputedStyle(e).position),
    'sticky',
  );
  await page.screenshot({
    path: resolve(directory, 'mobile-event-context.png'),
    fullPage: false,
    animations: 'disabled',
  });
  await page.getByTestId('moment-row').last().scrollIntoViewIfNeeded();
  await page
    .getByTestId('event-context')
    .getByRole('button', { name: '查看当前定位图表', exact: true })
    .click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '兵力曲线',
  );
  assert.equal(await page.getByTestId('readout-time').innerText(), '定位 02:39');
  const restoredContext = await page.getByTestId('event-context').boundingBox();
  const restoredCard = await page.getByTestId('timeline-card').boundingBox();
  assert(
    restoredCard.y >= restoredContext.y + restoredContext.height &&
      restoredCard.y + restoredCard.height <= 900,
    'Chart shortcut restores the whole inspector, not just its sticky header',
  );
  await page
    .getByTestId('moment-row')
    .getByRole('button', { name: /14 个单位/ })
    .click();
  await page.getByTestId('loss-chart').waitFor();
  assert.equal(
    await page
      .getByTestId('context-evidence')
      .getByRole('button', { name: '14 条记录', exact: true })
      .count(),
    1,
  );
  assert.equal(await page.getByTestId('loss-chart').count(), 1);
  await fit('mobile-zoom');
  await shot('zoom-mobile');
  const zoomReference = await browser.newPage({ viewport: { width: 390, height: 1800 } });
  await zoomReference.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  await zoomReference.addStyleTag({
    content: 'html { padding: 8px; background: var(--background); }',
  });
  await zoomReference
    .getByTestId('moment-row')
    .getByRole('button', { name: /14 个单位/ })
    .click();
  await zoomReference.getByRole('button', { name: '查看 19:00 附近 5 分钟', exact: true }).click();
  await zoomReference.getByTestId('loss-chart').waitFor();
  await zoomReference.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const zoomContent = await zoomReference.getByRole('main').boundingBox();
  const inspectedEvidence = await zoomReference.getByTestId('event-context').boundingBox();
  const inspectedPlots = await zoomReference.getByTestId('timeline-card').boundingBox();
  assert(
    Math.max(
      inspectedEvidence.y + inspectedEvidence.height,
      inspectedPlots.y + inspectedPlots.height,
    ) <= 844,
    'Zoomed plots and selected evidence must fit the initial phone viewport',
  );
  assert(await zoomReference.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await zoomReference.screenshot({
    path: resolve(directory, 'zoom-mobile-fresh.png'),
    clip: { x: 0, y: 0, width: 390, height: Math.ceil(zoomContent.y + zoomContent.height + 8) },
    animations: 'disabled',
  });
  await zoomReference.close();
  await page.getByRole('radio', { name: '高光', exact: true }).hover();
  assert.equal(
    await page.getByRole('radio', { name: '全部', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  assert.equal(
    await page.getByRole('radio', { name: '高光', exact: true }).getAttribute('aria-checked'),
    'false',
  );
  assert.equal(
    await page.getByRole('radio', { name: '全部', exact: true }).locator('svg').count(),
    1,
  );
  assert.equal(
    await page.getByRole('radio', { name: '高光', exact: true }).locator('svg').count(),
    0,
  );
  assert.equal(
    await page
      .getByRole('radio', { name: '高光', exact: true })
      .locator('svg.lucide-check')
      .count(),
    0,
  );
  assert.notEqual(
    await page
      .getByRole('radio', { name: '全部', exact: true })
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    await page
      .getByRole('radio', { name: '高光', exact: true })
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  );
  await shot('filter-hover');
  await page.mouse.move(5, 5);
  await page.getByRole('button', { name: '收起分钟损失', exact: true }).click();
  assert.equal(await page.getByTestId('loss-chart').count(), 0);
  await page.getByRole('button', { name: '展开分钟损失', exact: true }).click();
  await page.getByTestId('loss-chart').waitFor();
  await page.getByRole('radio', { name: '全局', exact: true }).click();
  for (const control of [
    page.getByRole('button', { name: '估算 · 点：数据口径', exact: true }),
    page.getByRole('button', { name: '切换浅色', exact: true }),
    page.getByLabel('筛选事件玩家'),
  ]) {
    const target = await control.boundingBox();
    assert(target.height >= 44, `Mobile target must be at least 44px: ${target.height}`);
  }
  await page.getByRole('button', { name: '14 条记录', exact: true }).click();
  await shot('mobile-records');
  const closeTarget = await page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭', exact: true })
    .boundingBox();
  assert(closeTarget.width >= 44 && closeTarget.height >= 44);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '分钟数据', exact: true }).click();
  await shot('mobile-minute-data');
  await verifyMinuteContinuation(page, '360px');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '切换浅色' }).click();
  await shot('light-mobile');
  await page.getByLabel('筛选事件玩家').selectOption('265522');
  await fit('long-name-mobile');
  await shot('long-name-mobile');
  await page.close();
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const touchPage = await touchContext.newPage();
  touchPage.on('pageerror', (error) => errors.push(error.message));
  await touchPage.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  await touchPage.getByRole('button', { name: '分钟数据', exact: true }).tap();
  await expect(touchPage.getByRole('dialog').getByRole('heading')).toHaveText(
    '分钟数据 · 当前定位 22:00–22:19',
  );
  assert.equal(await touchPage.getByTestId('force-chart').count(), 0);
  await touchPage.screenshot({
    path: resolve(directory, 'mobile-direct-minute-data.png'),
    animations: 'disabled',
  });
  await touchPage.getByRole('button', { name: '关闭', exact: true }).tap();
  assert(await touchPage.getByTestId('overview-chart').isVisible());
  assert.equal(await touchPage.getByTestId('force-chart').count(), 0);
  await touchPage.getByRole('button', { name: '查看5分钟细节', exact: true }).click();
  await touchPage
    .getByTestId('moment-row')
    .getByRole('button', { name: /Ka-50 Akula/ })
    .tap();
  await touchPage
    .getByTestId('event-context')
    .getByRole('button', { name: '下一个关键时刻', exact: true })
    .tap();
  await expect(touchPage.getByTestId('event-position')).toHaveText('2/6');
  await expect(touchPage.getByTestId('readout-time')).toHaveText('定位 02:39');
  await touchPage.screenshot({
    path: resolve(directory, 'mobile-event-paging.png'),
    animations: 'disabled',
  });
  await touchPage
    .getByTestId('event-context')
    .getByRole('button', { name: '上一个关键时刻', exact: true })
    .tap();
  await expect(touchPage.getByTestId('event-position')).toHaveText('1/6');
  await expect(touchPage.getByTestId('readout-time')).toHaveText('起点 00:03');
  await touchPage
    .getByTestId('moment-row')
    .getByRole('button', { name: /14 个单位/ })
    .click();
  const touchSlider = touchPage.locator('[data-slot="slider"]');
  await touchSlider.waitFor();
  await touchSlider.scrollIntoViewIfNeeded();
  const touchBox = await touchSlider.boundingBox();
  assert(touchBox.height >= 44 && touchBox.width >= 326);
  await touchPage.touchscreen.tap(touchBox.x + touchBox.width * 0.3, touchBox.y + 3);
  const touchedSecond = Number(
    await touchPage
      .getByRole('slider', { name: '定位对局时间', exact: true })
      .getAttribute('aria-valuenow'),
  );
  assert(touchedSecond > 350 && touchedSecond < 450);
  assert.equal(await touchPage.getByTestId('event-context').count(), 1);
  const navigationPage = await touchContext.newPage();
  navigationPage.on('pageerror', (error) => errors.push(error.message));
  await navigationPage.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  await verifyMinuteNavigation(navigationPage, '390px touch', true);
  const pointerPage = await touchContext.newPage();
  pointerPage.on('pageerror', (error) => errors.push(error.message));
  await pointerPage.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  await verifyPlotTouch(pointerPage);
  const browsingPage = await touchContext.newPage();
  browsingPage.on('pageerror', (error) => errors.push(error.message));
  await browsingPage.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  await verifyCompactBrowsing(browsingPage);
  const selectionPage = await touchContext.newPage();
  selectionPage.on('pageerror', (error) => errors.push(error.message));
  await selectionPage.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  await verifySelectionContext(selectionPage);
  const exitPage = await touchContext.newPage();
  exitPage.on('pageerror', (error) => errors.push(error.message));
  await exitPage.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  await verifyAnalysisNavigation(exitPage);
  await touchContext.close();
  const navigationDesktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  navigationDesktop.on('pageerror', (error) => errors.push(error.message));
  await navigationDesktop.goto(
    pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href,
  );
  await verifyMinuteNavigation(navigationDesktop, 'desktop');
  await navigationDesktop.close();
  const scaledContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1.5,
    hasTouch: true,
  });
  const scaledPage = await scaledContext.newPage();
  scaledPage.on('pageerror', (error) => errors.push(error.message));
  await scaledPage.goto(pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href);
  await scaledPage.getByRole('button', { name: '查看5分钟细节', exact: true }).click();
  await scaledPage
    .getByTestId('moment-row')
    .getByRole('button', { name: /14 个单位/ })
    .click();
  await scaledPage.getByRole('button', { name: '分钟数据', exact: true }).click();
  await scaledPage.getByRole('dialog').evaluate(async (dialog) => {
    await Promise.all(
      dialog.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await verifyMinuteContinuation(scaledPage, '390px DPR 1.5');
  const scaledPointerPage = await scaledContext.newPage();
  scaledPointerPage.on('pageerror', (error) => errors.push(error.message));
  await scaledPointerPage.goto(
    pathToFileURL(resolve(root, '.test-data/previews/timeline.html')).href,
  );
  await verifyPlotTouch(scaledPointerPage, '390px DPR 1.5');
  await scaledContext.close();
  assert.deepEqual(errors, [], 'Browser runtime errors');
  results.push({
    check: 'controls',
    passed: [
      'views',
      'record dialog',
      'minute table',
      'popover',
      'player filter',
      'type filter',
      'empty reset',
      'exact-second selection',
      'chart keyboard and focus',
      'slider keyboard',
      'hover',
      'chart click',
      'mobile bidirectional event navigation',
      'previous/next events',
      'zoom and final partial minute',
      'sticky table headers and continuation',
      '44px mobile targets',
      'full-width touch scrubbing and one-second adjustment',
      'event context survives scrubbing',
      'radio arrow-to-select semantics',
      'rounded axes with explicit zero',
      'compact initial viewport and collapsible loss chart',
      'minute table reveals the current row',
      'direct event zoom',
      'light-theme loss bars exceed 3.2:1 contrast',
      'compact sticky context and chart restore',
      'selected filter differs from hover',
      'localized dialog close controls',
      '14px analytical labels and strong current-minute emphasis',
      'sticky mobile time context, adjacent evidence, and chart shortcut',
      'whole-row minute viewport',
      'full-canvas captures without scrollbar reflow clipping',
      'event markers, clustered choices, filtering, and time-window alignment',
      'stable continuation controls at scroll boundaries and DPR 1.5',
      'interval-start navigation and matching forward-minute bucket',
      'one-tap minute data from the compact overview',
      'self-labeling 14px event marks without collisions',
      'in-place mobile event paging, both boundaries, and retained keyboard focus',
      'mouse/touch plot-selection parity without prior hover and pan cancellation',
      'minute table time/row/keyboard navigation with exact seek and focus restoration',
      '180px overview with five time ticks and one-action detail via touch, keyboard, and button',
      'unit-specific markers, visible cluster-type counts, and measured-label collision avoidance',
      'full overview scrolls away; compact selection summary does not cover filters',
      'record continuation uses explicit next-segment wording',
      'minute titles expose full, partial, and opening interval semantics',
      'previous/next record segments and pointer-specific chart hints',
      'selected-event identity is independent from the current cursor',
      'proxy and refund limitations visible without opening method details',
      'hover and click share one time sample; values stay pinned through pointer jitter and leave',
      'both mobile detail entries share the same top overview exit',
      'minute position and browsed record range are explicitly distinguished',
      'event inspection preserves player, type, and estimated loss context',
      'theme',
    ],
    errors,
  });
  await writeFile(resolve(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
