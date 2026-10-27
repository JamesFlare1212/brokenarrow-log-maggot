// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { windowThemeColorsSchema } from '@ba/contracts';
import { useAppearance, type Appearance } from '../apps/web/src/hooks/useAppearance';

const appearance: Appearance = {
  theme: 'dark',
  themeMode: 'dark',
  lightTheme: 'forest',
  darkTheme: 'ocean',
};
const colors = { background: '#101820', foreground: '#f0f4f8' };

beforeEach(() => {
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    getImageData: () => ({
      data: new Uint8ClampedArray([...context.fillStyle.match(/\d+/g)!.map(Number), 255]),
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    backgroundColor: 'rgb(16, 24, 32)',
    color: 'rgb(240, 244, 248)',
  } as CSSStyleDeclaration);
});

afterEach(() => {
  cleanup();
  delete window.assistant;
  delete document.documentElement.dataset.windowControlsOverlay;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('native window appearance', () => {
  it('keeps caption buttons in sync with live appearance changes', () => {
    const setWindowTheme = vi.fn().mockResolvedValue(undefined);
    window.assistant = { invoke: vi.fn(), subscribe: vi.fn(), setWindowTheme };
    const { rerender } = renderHook((value) => useAppearance(value), {
      initialProps: appearance,
    });

    expect(setWindowTheme).toHaveBeenLastCalledWith('dark', colors);
    expect(document.documentElement.dataset.windowControlsOverlay).toBe('true');
    rerender({ ...appearance, darkTheme: 'violet' });
    expect(setWindowTheme).toHaveBeenCalledTimes(2);
    expect(setWindowTheme).toHaveBeenLastCalledWith('dark', colors);
    rerender({ ...appearance, themeMode: 'light' });
    expect(setWindowTheme).toHaveBeenLastCalledWith('light', colors);
    expect(document.documentElement.dataset.mode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('forest');
  });

  it('updates native controls when the system theme changes and removes its listener', () => {
    const setWindowTheme = vi.fn().mockResolvedValue(undefined);
    window.assistant = { invoke: vi.fn(), subscribe: vi.fn(), setWindowTheme };
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: (_: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_: string, callback: () => void) => listeners.delete(callback),
    };
    vi.stubGlobal('matchMedia', () => media);
    const { unmount } = renderHook(() => useAppearance({ ...appearance, themeMode: 'system' }));

    expect(setWindowTheme).toHaveBeenLastCalledWith('light', colors);
    act(() => {
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(setWindowTheme).toHaveBeenLastCalledWith('dark', colors);
    expect(document.documentElement.dataset.mode).toBe('dark');
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('supports the browser fixture bridge without reserving native controls', () => {
    window.assistant = { invoke: vi.fn(), subscribe: vi.fn() };
    renderHook(() => useAppearance(appearance));

    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.dataset.windowControlsOverlay).toBe('false');
  });

  it('retains native window controls if canvas colors are unavailable', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    const setWindowTheme = vi.fn().mockResolvedValue(undefined);
    window.assistant = { invoke: vi.fn(), subscribe: vi.fn(), setWindowTheme };
    renderHook(() => useAppearance(appearance));

    expect(setWindowTheme).toHaveBeenCalledWith('dark');
    expect(document.documentElement.dataset.windowControlsOverlay).toBe('true');
  });

  it('accepts opaque native colors and rejects arbitrary CSS or malformed payloads', () => {
    expect(windowThemeColorsSchema.parse(colors)).toEqual(colors);
    for (const invalid of [
      { ...colors, background: 'url(file:///secret)' },
      { ...colors, foreground: 'transparent' },
      { ...colors, background: '#12345678' },
      { background: '#123456' },
      { ...colors, height: 0 },
    ])
      expect(windowThemeColorsSchema.safeParse(invalid).success).toBe(false);
  });
});
