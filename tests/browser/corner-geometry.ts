import { expect, type Locator } from '@playwright/test';

type Corner = 'TopLeft' | 'TopRight' | 'BottomLeft' | 'BottomRight';

export async function expectCorners(
  inner: Locator,
  outerSelector: string,
  corners: Corner[],
  tolerance = 0.05,
) {
  await expect(inner).toBeVisible();
  await expect
    .poll(() =>
      inner.evaluate(
        (node, { outerSelector, corners }) => {
          const parent = node.parentElement!.closest(outerSelector)!;
          const a = parent.getBoundingClientRect();
          const b = node.getBoundingClientRect();
          const radius = (element: Element, rect: DOMRect, corner: Corner) =>
            Math.min(
              parseFloat(getComputedStyle(element)[`border${corner}Radius`]),
              rect.width / 2,
              rect.height / 2,
            );
          return Math.max(
            ...corners.flatMap((corner) => {
              const inset = radius(parent, a, corner) - radius(node, b, corner);
              const dx = corner.endsWith('Left') ? b.left - a.left : a.right - b.right;
              const dy = corner.startsWith('Top') ? b.top - a.top : a.bottom - b.bottom;
              return [Math.abs(inset - dx), Math.abs(inset - dy)];
            }),
          );
        },
        { outerSelector, corners },
      ),
    )
    .toBeLessThan(tolerance);
}
