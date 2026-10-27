import { useLayoutEffect } from 'react';
import type { PublicConfig, WindowThemeColors } from '@ba/contracts';

function readWindowThemeColors(): WindowThemeColors | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const styles = getComputedStyle(document.body);
  const toHex = (color: string) => {
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return (
      '#' +
      Array.from(context.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')
    );
  };
  return { background: toHex(styles.backgroundColor), foreground: toHex(styles.color) };
}

/** Used for both saved preferences and the settings draft, including live OS changes. */
export type Appearance = Pick<PublicConfig, 'theme' | 'themeMode' | 'lightTheme' | 'darkTheme'>;
export function colorSchemeFor(appearance: Appearance, mode: 'light' | 'dark') {
  return (
    appearance[mode === 'light' ? 'lightTheme' : 'darkTheme'] ??
    (appearance.theme === 'light' ? 'dark' : appearance.theme)
  );
}
export function useAppearance(appearance: Appearance | undefined) {
  const theme = appearance?.theme,
    themeMode = appearance?.themeMode,
    lightTheme = appearance?.lightTheme,
    darkTheme = appearance?.darkTheme;
  useLayoutEffect(() => {
    if (!theme || !themeMode) return;
    const root = document.documentElement;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const mode = themeMode === 'system' ? (media?.matches ? 'dark' : 'light') : themeMode;
      root.dataset.theme = colorSchemeFor({ theme, themeMode, lightTheme, darkTheme }, mode);
      root.dataset.mode = mode;
      root.classList.toggle('dark', mode === 'dark');
      root.style.colorScheme = mode;
      root.dataset.windowControlsOverlay = String(Boolean(window.assistant?.setWindowTheme));
      const setWindowTheme = window.assistant?.setWindowTheme;
      if (setWindowTheme) {
        const colors = readWindowThemeColors();
        void (colors ? setWindowTheme(mode, colors) : setWindowTheme(mode)).catch(() => {});
      }
    };
    apply();
    if (themeMode === 'system') media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [theme, themeMode, lightTheme, darkTheme]);
}
