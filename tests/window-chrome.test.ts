// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppearance, type Appearance } from '../apps/web/src/hooks/useAppearance';

const appearance: Appearance = {
  theme: 'dark',
  themeMode: 'dark',
  lightTheme: 'forest',
  darkTheme: 'ocean',
};

afterEach(() => {
  cleanup();
  delete window.assistant;
  delete document.documentElement.dataset.windowControlsOverlay;
  vi.unstubAllGlobals();
});

describe('native window appearance', () => {
  it('keeps caption buttons in sync with live appearance changes', () => {
    const setWindowTheme = vi.fn().mockResolvedValue(undefined);
    window.assistant = { invoke: vi.fn(), subscribe: vi.fn(), setWindowTheme };
    const { rerender } = renderHook((value) => useAppearance(value), {
      initialProps: appearance,
    });

    expect(setWindowTheme).toHaveBeenLastCalledWith('dark');
    expect(document.documentElement.dataset.windowControlsOverlay).toBe('true');
    rerender({ ...appearance, themeMode: 'light' });
    expect(setWindowTheme).toHaveBeenLastCalledWith('light');
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

    expect(setWindowTheme).toHaveBeenLastCalledWith('light');
    act(() => {
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(setWindowTheme).toHaveBeenLastCalledWith('dark');
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
});
