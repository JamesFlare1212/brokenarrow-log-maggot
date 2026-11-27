import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { expectCorners } from './corner-geometry';

for (const [width, height] of [
  [1280, 850],
  [900, 600],
  [390, 844],
] as const) {
  test(`appearance preview frames and menu highlights share corner centers at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#settings/appearance');
    const cards = page.locator('.appearance-mode-option');
    await expect(cards).toHaveCount(3);
    for (const card of await cards.all()) {
      await expect(card).toHaveCSS('border-top-left-radius', '36px');
      await expectCorners(card.locator('[data-slot=card-preview]'), '.appearance-mode-option', [
        'TopLeft',
        'TopRight',
      ]);
    }
    for (const selector of [
      '.appearance-mode-option',
      '[data-slot=card-preview]',
      '[aria-labelledby=appearance-elo-heading] [data-slot=toggle-group-item]',
      '.appearance-theme-card',
      '.appearance-settings [data-slot=badge]',
    ]) {
      const shapes = page.locator(selector);
      await expect(shapes.first()).toBeVisible();
      for (const shape of await shapes.all())
        await expect(shape).toHaveCSS('corner-shape', 'superellipse(2)');
    }
    const composerSelector = '[data-slot=preview-composer]';
    const composer = cards.nth(1).locator(composerSelector);
    await expectCorners(composer.locator(':scope > span').first(), composerSelector, [
      'TopLeft',
      'BottomLeft',
    ]);
    await expectCorners(composer.locator(':scope > span').last(), composerSelector, [
      'TopRight',
      'BottomRight',
    ]);
    await expect(
      page
        .locator('[aria-labelledby=appearance-elo-heading] [data-slot=toggle-group-item]')
        .first(),
    ).toHaveCSS('border-top-left-radius', '36px');
    await expect(page.locator('.appearance-theme-card').first()).toHaveCSS('border-radius', '36px');
    await page.goto('/#settings/general');
    await page.locator('#settings-language').press('Enter');
    const options = page.getByRole('option');
    await expect(page.getByRole('listbox')).toHaveCSS('border-top-left-radius', '12px');
    await expectCorners(options.first(), '[role=listbox]', ['TopLeft', 'TopRight']);
    await expectCorners(options.last(), '[role=listbox]', ['BottomLeft', 'BottomRight']);
  });
}

test('dropdowns, portalled submenus and player context menus use the item plus gutter radius', async ({
  page,
}) => {
  await page.goto('/#archive/match/9485138');
  await page.locator('.match-player-toggle').first().click({ button: 'right' });
  const context = page.locator('[data-slot=context-menu-content]');
  await expectCorners(context.getByRole('menuitem').last(), '[data-slot=context-menu-content]', [
    'BottomLeft',
    'BottomRight',
  ]);
  await page.keyboard.press('Escape');
  const url =
    '/@fs/' +
    fileURLToPath(new URL('./submenu-fixture.tsx', import.meta.url)).replaceAll('\\', '/');
  await page.evaluate(async (url) => (await import(url)).mountSubmenuFixture(), url);
  await page.getByRole('button', { name: 'Open actions' }).press('Enter');
  await expectCorners(
    page.getByRole('menuitem', { name: 'Copy ID' }),
    '[data-slot=dropdown-menu-content]',
    ['TopLeft', 'TopRight'],
  );
  const more = page.getByRole('menuitem', { name: 'More actions' });
  await expectCorners(more, '[data-slot=dropdown-menu-content]', ['BottomLeft', 'BottomRight']);
  await more.hover();
  await expectCorners(
    page.getByRole('menuitem', { name: 'Open report' }),
    '[data-slot=dropdown-menu-sub-content]',
    ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'],
  );
});
