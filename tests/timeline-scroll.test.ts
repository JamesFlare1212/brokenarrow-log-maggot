'@vitest-environment jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollToElement } from '../apps/web/src/features/timeline/scroll';

function scrollFixture(targetTop = 300, targetHeight = 100) {
  const container = document.createElement('div');
  container.style.cssText = 'overflow-y: auto; padding: 20px';
  const target = document.createElement('div');
  container.append(target);
  document.body.append(container);
  Object.defineProperties(container, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 1600 },
    clientTop: { value: 0 },
  });
  container.scrollTop = 100;
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 800, 400));
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, targetTop, 800, targetHeight),
  );
  container.scrollTo = vi.fn();
  return { container, target };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('timeline nested scroll geometry', () => {
  it('reserves dialog padding as well as the sticky context when aligning a chart', () => {
    const { container, target } = scrollFixture();
    scrollToElement(target, container, 90, 'start');
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 240, behavior: 'instant' });
  });
  it('centers inside the usable padded scrollport', () => {
    const { container, target } = scrollFixture();
    scrollToElement(target, container, 90, 'center');
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 155, behavior: 'instant' });
  });
  it('reveals rows that would be covered by padding and sticky controls', () => {
    const { container, target } = scrollFixture(150);
    scrollToElement(target, container, 90);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 90, behavior: 'instant' });
  });
  it('aligns oversized content to the usable top instead of hiding its heading', () => {
    const { container, target } = scrollFixture(175, 285);
    scrollToElement(target, container, 90);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 115, behavior: 'instant' });
  });
});
