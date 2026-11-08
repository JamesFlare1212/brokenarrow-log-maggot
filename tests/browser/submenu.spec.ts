import { test, expect, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./submenu-fixture.tsx', import.meta.url)).replaceAll(
  '\\',
  '/',
);

async function expectPaintedItem(item: Locator) {
  await expect(item).toBeVisible();
  await expect
    .poll(() =>
      item.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    )
    .toBe(true);
}

async function mount(page: Page, mode: 'light' | 'dark', opacity: number) {
  await page.route('**/__fixtures/rpc', async (route) => {
    if (route.request().postDataJSON().method !== 'app.bootstrap') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    Object.assign(body.value.config, {
      lang: 'en',
      themeMode: mode,
      lightTheme: 'dark',
      darkTheme: 'dark',
      glassOpacity: opacity,
    });
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await expect(page.locator('[data-ready=true]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--glass-opacity')),
    )
    .toBe(`${opacity}%`);
  await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).mountSubmenuFixture(),
    `/@fs/${fixturePath}`,
  );
}

for (const mode of ['light', 'dark'] as const) {
  for (const opacity of [40, 100]) {
    test.describe(`${mode}, ${opacity}% glass opacity`, () => {
      test.beforeEach(async ({ page }) => mount(page, mode, opacity));

      test('pointer reaches and activates the submenu outside its scrolling parent', async ({
        page,
      }) => {
        const trigger = page.getByRole('button', { name: 'Open actions', exact: true });
        await trigger.click();
        await page.getByRole('menuitem', { name: 'More actions', exact: true }).hover();
        const item = page.getByRole('menuitem', { name: 'Open report', exact: true });
        await expectPaintedItem(item);
        await item.click();
        await expect(page.getByRole('status')).toHaveText('Selections: 1');
        await expect(trigger).toBeFocused();
      });

      test('keyboard navigation, Escape, activation and focus return remain intact', async ({
        page,
      }) => {
        await page.getByRole('button', { name: 'Before menu', exact: true }).focus();
        await page.keyboard.press('Tab');
        const trigger = page.getByRole('button', { name: 'Open actions', exact: true });
        await expect(trigger).toBeFocused();
        const first = page.getByRole('menuitem', { name: 'Copy ID', exact: true });
        const content = page.locator('[data-slot="dropdown-menu-content"]');
        await page.keyboard.press('Enter');
        await expect(first).toBeFocused();
        await page.keyboard.press('ArrowDown');
        const more = page.getByRole('menuitem', { name: 'More actions', exact: true });
        await expect(more).toBeFocused();
        await page.keyboard.press('ArrowRight');
        const item = page.getByRole('menuitem', { name: 'Open report', exact: true });
        await expect(item).toBeFocused();
        await expectPaintedItem(item);
        await page.keyboard.press('ArrowLeft');
        await expect(more).toBeFocused();
        await expect(item).toBeHidden();
        await page.keyboard.press('ArrowRight');
        await expect(item).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await expect(content).toBeHidden();
        await page.keyboard.press('Enter');
        await expect(first).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(more).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(item).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('status')).toHaveText('Selections: 1');
        await expect(trigger).toBeFocused();
      });
    });
  }
}
