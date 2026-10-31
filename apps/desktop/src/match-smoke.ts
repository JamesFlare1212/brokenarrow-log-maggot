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
    return checks;
  } finally {
    window.setSize(originalSize[0]!, originalSize[1]!);
  }
}
