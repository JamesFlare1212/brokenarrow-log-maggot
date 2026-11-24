import { expect, test, type Page } from '@playwright/test';

async function seedFeatures(page: Page) {
  await page.route('**/__fixtures/rpc', async (route) => {
    const { method } = route.request().postDataJSON();
    if (method === 'app.bootstrap') {
      const response = await route.fetch();
      const json = await response.json();
      Object.assign(json.value.config, { lang: 'en', analyticsChoiceSaved: true });
      Object.assign(json.value.session, {
        phase: 'lobby',
        current: null,
        localPlayerId: '8863',
        lobbyPlayers: [{ id: '8863', name: 'Local Player', teamId: 0 }],
      });
      return route.fulfill({ response, json });
    }
    if (method === 'decks.list') {
      return route.fulfill({
        json: {
          value: {
            found: true,
            decksDir: 'Decks',
            backupsDir: 'Backups',
            decks: [{ name: 'Airborne', size: 3000, modifiedAt: 0 }],
            backups: [],
          },
        },
      });
    }
    if (method === 'replays.list') {
      return route.fulfill({
        json: {
          value: ['Local Player', 'A longer uploader name that wraps over multiple lines'].map(
            (uploaderName, index) => ({
              id: `river-${index}.webm`,
              fid: '9485138',
              map: 'River',
              uploaderId: '8863',
              uploaderName,
              teamId: 0,
              size: 9800000,
              createdAt: 1768000000000,
              durationSec: 91,
              test: false,
            }),
          ),
        },
      });
    }
    return route.continue();
  });
}

async function corner(page: Page, parent: string, child: string, side: 'topLeft' | 'bottomRight') {
  return page
    .locator(parent)
    .first()
    .locator(child)
    .first()
    .evaluate(
      (inner, { parent, side }) => {
        const outer = inner.closest(parent)!;
        const rect = outer.getBoundingClientRect();
        const content = inner.getBoundingClientRect();
        const top = side === 'topLeft';
        const radius = top ? 'borderTopLeftRadius' : 'borderBottomRightRadius';
        const paint = (node: Element) => {
          const style = getComputedStyle(node);
          const clip =
            style.backgroundClip === 'padding-box'
              ? parseFloat(top ? style.borderLeftWidth : style.borderRightWidth)
              : 0;
          return { radius: parseFloat(style[radius]) - clip, clip };
        };
        const a = paint(outer),
          b = paint(inner);
        return {
          outer: a.radius,
          inner: b.radius,
          dx: (top ? content.left - rect.left : rect.right - content.right) + b.clip - a.clip,
          dy: (top ? content.top - rect.top : rect.bottom - content.bottom) + b.clip - a.clip,
        };
      },
      { parent, side },
    );
}

for (const width of [1280, 900, 390]) {
  test(`feature surfaces align painted corners at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 850 : 600 });
    await seedFeatures(page);
    await page.goto('/#current');
    const roster = '.player-card[data-variant=muted]';
    await page.locator(roster).locator('button.player-card-trigger').hover();
    expect(await corner(page, roster, '.player-card-trigger', 'topLeft')).toEqual({
      outer: 11,
      inner: 9,
      dx: 2,
      dy: 2,
    });

    await page.goto('/#decks');
    const deck = '.deck-columns [data-slot=card]:has([data-slot=card-footer])';
    await expect(page.locator(deck).first()).toHaveCSS('overflow', 'hidden');
    expect(await corner(page, deck, '[data-slot=card-footer]', 'bottomRight')).toEqual({
      outer: 14,
      inner: 0,
      dx: 1,
      dy: 1,
    });

    await page.goto('/#replays');
    await expect(page.locator('button.replay-play')).toHaveCount(2);
    await expect(page.locator('.replay-preview-card')).toHaveCSS('border-radius', '16px');
    expect(
      await corner(page, '.replay-preview-card', '.recording-preview-media', 'bottomRight'),
    ).toEqual({ outer: 16, inner: 6, dx: 10, dy: 10 });
    const tile = '.replay-grid-card';
    await expect(page.locator(tile).first()).toHaveCSS('overflow', 'hidden');
    expect(await corner(page, tile, '.replay-thumbnail', 'topLeft')).toEqual({
      outer: 14,
      inner: 0,
      dx: 1,
      dy: 1,
    });
    expect(await corner(page, tile, 'button.replay-play', 'bottomRight')).toEqual({
      outer: 14,
      inner: 13,
      dx: 1,
      dy: 1,
    });
    const duration = () => corner(page, '.replay-thumbnail', '.replay-duration', 'bottomRight');
    expect(await duration()).toEqual({ outer: 10, inner: 6, dx: 4, dy: 4 });
    await page.locator('.replay-library [data-slot=toggle-group-item]').last().click();
    await expect(page.locator(tile)).toHaveCount(0);
    expect(await duration()).toEqual({ outer: 10, inner: 6, dx: 4, dy: 4 });
    expect(await corner(page, 'button.replay-play', '.replay-thumbnail', 'topLeft')).toEqual({
      outer: 10,
      inner: 10,
      dx: 0,
      dy: 0,
    });
  });
}
