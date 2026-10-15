import { useEffect } from 'react';
import type { PublicConfig } from '@ba/contracts';

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
  useEffect(() => {
    if (!theme || !themeMode) return;
    const root = document.documentElement;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const mode = themeMode === 'system' ? (media?.matches ? 'dark' : 'light') : themeMode;
      root.dataset.theme = colorSchemeFor({ theme, themeMode, lightTheme, darkTheme }, mode);
      root.dataset.mode = mode;
    };
    apply();
    if (themeMode === 'system') media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [theme, themeMode, lightTheme, darkTheme]);
}
