import { expect, test } from '@playwright/test';

for (const [layout, width, height] of [
  ['paired', 1400, 1340],
  ['stacked', 900, 600],
] as const) {
  test(`match dialog keeps the activated player under the pointer in ${layout} teams`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#current');
    await page.locator('.recent-matches').getByRole('button', { name: '#28' }).click();
    const dialog = page.locator('.match-dialog');
    await expect(dialog.locator('[data-slot="dialog-title"]')).toContainText('#9484902');
    const player = (name: string) => dialog.getByRole('button', { name, exact: true });
    const first = player('JamesFlare');
    await expect(first).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const [name, states] of [
      ['JamesFlare', [true, false, true]],
      ['KAMI', [true, false]],
      ['Hikari', [true, false]],
    ] as const) {
      const trigger = player(name);
      await trigger.scrollIntoViewIfNeeded();
      const before = (await trigger.boundingBox())!;
      const point = { x: before.x + 12, y: before.y + before.height / 2 };
      const shell = await dialog.boundingBox();
      for (const open of states) {
        await page.mouse.click(point.x, point.y);
        await expect(trigger).toHaveAttribute('aria-expanded', String(open));
        await page.evaluate(
          () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            ),
        );
        expect(await dialog.boundingBox()).toEqual(shell);
        const after = (await trigger.boundingBox())!;
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);
        expect(
          await trigger.evaluate(
            (el, p) => el.contains(document.elementFromPoint(p.x, p.y)),
            point,
          ),
        ).toBe(true);
        await expect(trigger).toBeFocused();
        if (name !== 'JamesFlare') await expect(first).toHaveAttribute('aria-expanded', 'true');
      }
    }
  });
}
