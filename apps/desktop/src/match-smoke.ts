import type { BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Exercise the real archive route and layout in the hidden offline smoke window. */
export async function verifyMatchDetails(window: BrowserWindow) {
  const originalSize = window.getSize();
  await window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (find) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const result = find();
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Match detail smoke did not initialize');
    };
    document.querySelector('.app-dialog button[aria-label="关闭"], .app-dialog button[aria-label="Close"]')?.click();
    await waitFor(() => !document.querySelector('.app-dialog'));
    document.querySelector('.nav-item[aria-label="对局档案"], .nav-item[aria-label="Match archive"]').click();
    const opener = await waitFor(() => document.querySelector('[data-match-open]:not(:disabled)'));
    opener.click();
    await waitFor(() => document.querySelectorAll('.match-detail-page .match-player-cell').length &&
      !document.querySelector('.match-detail-page [data-slot="skeleton"]'));
  })()`);
  const checks: Record<string, boolean> = {};
  try {
    for (const [width, height] of [[1800, 1000], window.getMinimumSize()]) {
      window.setSize(width!, height!);
      const layout = await window.webContents.executeJavaScript(`(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const page = document.querySelector('.match-detail-page');
        const details = page.querySelector('.match-details');
        const grid = page.querySelector('.match-scoreboard-grid');
        const teams = grid.querySelectorAll('.match-team');
        const width = details.getBoundingClientRect().width;
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        const initial = {
          route: location.hash.startsWith('#archive/match/'),
          scoreboard: teams.length >= 2 && Array.from(teams).every(team => team.querySelectorAll('thead th').length === 6),
          responsive: columns === (width >= 1180 ? 2 : 1),
          contained: page.scrollWidth <= page.clientWidth + 1 && details.scrollWidth <= details.clientWidth + 1,
          readable: Array.from(page.querySelectorAll('.match-player-toggle')).every(button => button.getBoundingClientRect().width > 40),
        };
        page.scrollTop = page.scrollHeight;
        await new Promise(resolve => requestAnimationFrame(resolve));
        const back = page.querySelector('.match-detail-toolbar button');
        const rect = back.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        initial.backAccessible = back.contains(hit);
        page.scrollTop = 0;
        return initial;
      })()`);
      for (const [name, passed] of Object.entries(layout))
        checks[name] = passed === true && checks[name] !== false;
      if (process.env.BA_SMOKE_CAPTURE_DIR) {
        await mkdir(process.env.BA_SMOKE_CAPTURE_DIR, { recursive: true });
        await writeFile(
          join(process.env.BA_SMOKE_CAPTURE_DIR, `match-details-${width}.png`),
          (await window.capturePage()).toPNG(),
        );
      }
    }
    const interaction = await window.webContents.executeJavaScript(`(async () => {
      const page = document.querySelector('.match-detail-page');
      page.querySelector('[role="tab"][data-state="inactive"]').click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const player = page.querySelector('.match-player-toggle');
      player.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const expanded = page.querySelectorAll('.match-player-metrics dt').length === 13;
      const selected = document.querySelector('.archive-panel [data-match-open]:not(:disabled)');
      page.querySelector('.match-detail-toolbar button').click();
      const deadline = Date.now() + 5000;
      while (document.querySelector('.match-detail-page') && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 25));
      return { expanded, returned: !document.querySelector('.match-detail-page'), focusRestored: document.activeElement === selected };
    })()`);
    Object.assign(checks, interaction);
    const archiveActions = await window.webContents.executeJavaScript(`(async () => {
      const waitFor = async (label, find) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const result = find();
          if (result) return result;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Archive action smoke did not initialize: ' + label);
      };
      document.querySelector('.archive-panel [role="radio"][aria-label="列表视图"], .archive-panel [role="radio"][aria-label="List view"]').click();
      const trigger = await waitFor('menu trigger', () => document.querySelector('.archive-table [data-menu-trigger]'));
      const table = document.querySelector('.archive-table table');
      const refresh = trigger.closest('[role="group"]').querySelector('button[aria-busy]');
      const mergedArchiveActions = table.querySelectorAll('thead th').length === 8 &&
        ['刷新', 'Refresh'].includes(refresh?.textContent.trim());
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const details = await waitFor('details menu item', () => Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        item => ['查看详情', 'View details'].includes(item.textContent.trim()) && item.getAttribute('aria-disabled') !== 'true'
      ));
      details.click();
      const heading = await waitFor('detail heading', () => document.querySelector('.match-detail-page h2[tabindex="-1"]'));
      await waitFor('detail heading focus', () => document.activeElement === heading);
      const menuDetailNavigation = location.hash.startsWith('#archive/match/');
      document.querySelector('.match-detail-page .match-detail-toolbar button').click();
      await waitFor('archive return', () => !document.querySelector('.match-detail-page'));
      await waitFor('menu exit animation', () => !document.querySelector('[role="menu"]'));
      const returnedTrigger = Array.from(document.querySelectorAll('.archive-table [data-menu-trigger]')).find(
        button => button.dataset.matchOpen === trigger.dataset.matchOpen
      );
      return {
        mergedArchiveActions,
        menuDetailNavigation,
        menuReturnFocus: document.activeElement === returnedTrigger,
        menuClosedOnReturn: !document.querySelector('[role="menu"]'),
      };
    })()`);
    Object.assign(checks, archiveActions);
    const originalLocale = await window.webContents.executeJavaScript(
      "window.assistant.invoke('app.bootstrap', null).then(state => state.config.lang)",
    );
    try {
      for (const locale of ['zh', 'en']) {
        await window.webContents.executeJavaScript(
          `window.assistant.invoke('config.update', { lang: ${JSON.stringify(locale)} })`,
        );
        for (const [width, height] of [[1800, 1000], window.getMinimumSize()]) {
          window.setSize(width!, height!);
          const { widths, ...layout } = await window.webContents.executeJavaScript(`(async () => {
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const viewport = document.querySelector('.archive-table');
            const table = viewport.querySelector('table');
            const headers = Array.from(table.querySelectorAll('thead th'));
            const columns = Array.from(table.querySelectorAll('col'));
            const widths = headers.map(header => header.getBoundingClientRect().width);
            const fixedWidths = columns.every((column, index) => index === 2 ||
              Math.abs(widths[index] - parseFloat(column.style.width)) <= 1);
            const cellsFit = Array.from(table.querySelectorAll('th, td')).every(cell => cell.scrollWidth <= cell.clientWidth + 1);
            const account = table.querySelector('tbody tr td:nth-child(7) span');
            const accountName = account.textContent;
            account.textContent = 'A very long account name for column overflow verification';
            const longAccountFits = account.scrollWidth > account.clientWidth &&
              getComputedStyle(account).textOverflow === 'ellipsis' &&
              account.parentElement.scrollWidth <= account.parentElement.clientWidth + 1;
            account.textContent = accountName;
            viewport.scrollLeft = viewport.scrollWidth;
            const scrollContained = table.getBoundingClientRect().width <= viewport.clientWidth + 1 || viewport.scrollLeft > 0;
            viewport.scrollLeft = 0;
            return {
              widths,
              archiveFixedColumns: fixedWidths,
              archiveFlexibleMap: widths[2] >= 159 && !columns[2].style.width,
              archiveCompactAccount: Math.abs(widths[6] - 120) <= 1,
              archiveContentFits: cellsFit,
              archiveLongAccountFits: longAccountFits,
              archiveScrollContained: scrollContained &&
                document.querySelector('.workspace-scroll').scrollWidth <= document.querySelector('.workspace-scroll').clientWidth + 1,
            };
          })()`);
          if (Object.values(layout).some((passed) => passed !== true))
            throw new Error(
              `Archive column layout failed: ${JSON.stringify({ locale, width, widths, ...layout })}`,
            );
          for (const [name, passed] of Object.entries(layout))
            checks[name] = passed === true && checks[name] !== false;
          if (process.env.BA_SMOKE_CAPTURE_DIR)
            await writeFile(
              join(process.env.BA_SMOKE_CAPTURE_DIR, `match-archive-${locale}-${width}.png`),
              (await window.capturePage()).toPNG(),
            );
        }
      }
    } finally {
      await window.webContents.executeJavaScript(
        `window.assistant.invoke('config.update', { lang: ${JSON.stringify(originalLocale)} })`,
      );
    }
    return checks;
  } finally {
    window.setSize(originalSize[0]!, originalSize[1]!);
  }
}
