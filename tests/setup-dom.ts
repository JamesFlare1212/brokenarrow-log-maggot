import { vi } from 'vitest';

// Radix, Sonner and Recharts use browser layout APIs that jsdom does not implement.
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
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (target.closest('[data-chart]'))
        queueMicrotask(() =>
          this.callback(
            [{ target, contentRect: { width: 640, height: 256 } } as ResizeObserverEntry],
            this,
          ),
        );
    }
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
