import { vi } from 'vitest';

// Radix and Sonner use browser layout APIs that jsdom does not implement.
if (typeof window !== 'undefined') {
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
