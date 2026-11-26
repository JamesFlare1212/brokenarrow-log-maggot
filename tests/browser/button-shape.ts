import { expect, type Locator } from '@playwright/test';

export async function expectButtonShape(button: Locator) {
  await expect(button).toHaveCSS('border-radius', '18px');
  await expect(button).toHaveCSS('corner-shape', 'superellipse(2)');
}
