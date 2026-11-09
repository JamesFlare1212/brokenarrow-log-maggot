import { vi } from 'vitest';

// Radix, Sonner, and Recharts use browser layout APIs that jsdom does not implement.
if (typeof window !== 'undefined') {
  const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  // Keep this fixture as the base method so individual tests can wrap it with layout spies.
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('recharts-responsive-container')
      ? new DOMRect(0, 0, 640, 200)
      : getBoundingClientRect.call(this);
  };

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!window.PointerEvent)
    Object.defineProperty(window, 'PointerEvent', {
      value: class PointerEvent extends MouseEvent {
        readonly pointerType: string;
        constructor(type: string, options: PointerEventInit = {}) {
          super(type, options);
          this.pointerType = options.pointerType ?? 'mouse';
        }
      },
    });
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
}
