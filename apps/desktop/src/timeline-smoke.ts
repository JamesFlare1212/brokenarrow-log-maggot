import type { BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyMatchTimeline(window: BrowserWindow) {
  const size = window.getSize();
  const checks: Record<string, boolean> = {};
  try {
    window.setSize(1800, 1000);
    Object.assign(
      checks,
      await window.webContents.executeJavaScript(`(async () => {
      const wait = async (label, find) => {
        const until = Date.now() + 10000;
        while (Date.now() < until) {
          const value = find();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Timeline smoke: ' + label);
      };
      const response = await window.assistant.invoke('matches.timeline', { fid: '9485138', force: false });
      if (response.status !== 'ready') throw new Error('Recorded timeline is unavailable');
      history.pushState(null, '', '#archive/match/9485138');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      const tab = await wait('tab', () => Array.from(document.querySelectorAll('[data-testid="match-detail-views"] [role="tab"]')).find(element => /^(时间线|Timeline)$/.test(element.textContent.trim())));
      tab.focus();
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait('active timeline tab', () => tab.getAttribute('aria-selected') === 'true');
      const root = await wait('ready view', () => {
        const node = document.querySelector('[data-testid="match-timeline"]');
        return node?.querySelectorAll('[data-testid="moment-row"]').length === 6 && node;
      });
      const chart = await wait('wide chart', () => root.querySelector('[data-testid="force-chart"]'));
      const event = Array.from(root.querySelectorAll('[data-testid="moment-row"] button')).find(element => element.textContent.includes('Ka-50 Akula'));
      event.click();
      await wait('exact event time', () => root.querySelector('[data-testid="readout-time"]').textContent.includes('00:03'));
      const inspect = Array.from(root.querySelectorAll('button')).find(element => /^(查看 00:03 附近 5 分钟|Inspect 5 minutes around 00:03)$/.test(element.getAttribute('aria-label') || ''));
      inspect.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      Array.from(root.querySelectorAll('button')).find(element => /^(分钟数据|Minute data)$/.test(element.textContent.trim())).click();
      const dialog = await wait('minute dialog', () => Array.from(document.querySelectorAll('[role="dialog"]')).find(element => /分钟数据|Minute data/.test(element.textContent)));
      const seek = Array.from(dialog.querySelectorAll('button')).find(element => /^(定位到 03:00|Seek to 03:00)$/.test(element.getAttribute('aria-label') || ''));
      seek.click();
      await wait('minute seek', () => root.querySelector('[data-testid="readout-time"]').textContent.includes('03:00') && !document.querySelector('[role="dialog"]'));
      const focused = root.querySelector('[data-testid="force-chart"]').closest('[role="slider"]');
      await wait('chart focus', () => document.activeElement === focused);
      const page = document.querySelector('.match-detail-page');
      const back = document.querySelector('.topbar a[href="#archive"]');
      const bounds = back.getBoundingClientRect();
      return {
        bridgeTimeline: response.data.duration === 1339 && response.data.sorties.length === 400 && response.data.moments.length === 6,
        archiveEntry: location.hash === '#archive/match/9485138',
        exactEventSeek: event.getAttribute('aria-expanded') === 'true',
        minuteSeek: focused.getAttribute('aria-valuenow') === '180',
        nestedFocus: document.activeElement === focused,
        nestedScroll: page.scrollTop > 0 && scrollY === 0,
        toolbarClear: back.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)),
      };
    })()`),
    );
    const minimum = window.getMinimumSize();
    window.setSize(minimum[0]!, minimum[1]!);
    Object.assign(
      checks,
      await window.webContents.executeJavaScript(`(async () => {
      const until = Date.now() + 5000;
      let overview;
      while (Date.now() < until) {
        overview = document.querySelector('[data-testid="overview-chart"]');
        if (overview) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const root = document.querySelector('[data-testid="match-timeline"]');
      const page = document.querySelector('.match-detail-page');
      const inspect = Array.from(root.querySelectorAll('button')).find(element => /^(查看5分钟细节|Inspect 5-minute detail)$/.test(element.getAttribute('aria-label') || ''));
      inspect?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const context = root.querySelector('[data-testid="event-context"], [data-testid="analysis-context"]');
      const toolbar = document.querySelector('.topbar').getBoundingClientRect();
      return {
        containerResponsive: !!overview,
        minimumWidthContained: root.scrollWidth <= root.clientWidth + 1 && page.scrollWidth <= page.clientWidth + 1,
        stickyToolbarSeparation: !!context && context.getBoundingClientRect().top >= toolbar.bottom - 1,
        localizedExit: Array.from(root.querySelectorAll('button')).filter(element => /^(返回概览|Back to overview)$/.test(element.textContent.trim())).length === 1,
      };
    })()`),
    );
    if (process.env.BA_SMOKE_CAPTURE_DIR) {
      await mkdir(process.env.BA_SMOKE_CAPTURE_DIR, { recursive: true });
      await writeFile(
        join(process.env.BA_SMOKE_CAPTURE_DIR, 'timeline-integrated.png'),
        (await window.capturePage()).toPNG(),
      );
    }
    await window.webContents.executeJavaScript(
      `history.replaceState(null, '', '#archive'); window.dispatchEvent(new HashChangeEvent('hashchange'));`,
    );
    return checks;
  } finally {
    window.setSize(size[0]!, size[1]!);
  }
}
