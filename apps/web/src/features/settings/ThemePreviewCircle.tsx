/* Adapted from pingdotgg/t3code at 5bb54a0f77c6655fdb2ab551612ca1ca1fcd3667.
 * Copyright (c) 2026 T3 Tools Inc. MIT; see THIRD_PARTY_NOTICES.txt.
 */
import type { CSSProperties } from 'react';
import type { PublicConfig } from '@ba/contracts';
import { cn } from '@/lib/utils';

type ThemeAppearance = 'light' | 'dark';
export type ThemeCardPreviewColors = Readonly<{
  sidebar: string;
  canvas: string;
  surface: string;
  accentSurface: string;
  accent: string;
  messageSurface: string;
  messageAction: string;
}>;

const STANDARD_THEME_PREVIEW_COLORS: Record<ThemeAppearance, ThemeCardPreviewColors> = {
  light: {
    sidebar: '#fafafa',
    canvas: '#fcfcfc',
    surface: '#ffffff',
    accentSurface: '#f4f4f5',
    accent: '#f4f4f5',
    messageSurface: '#e4e4e7',
    messageAction: '#4f46e5',
  },
  dark: {
    sidebar: '#0f0f10',
    canvas: '#0a0a0a',
    surface: '#121212',
    accentSurface: '#27272a',
    accent: '#1c1c1f',
    messageSurface: '#27272a',
    messageAction: '#8b9cff',
  },
};

const THEME_PREVIEW_RENDER_SPECS = {
  light: {
    baseTarget: '#ffffff',
    baseWeight: 0.8,
    accent: {
      center: [0.72, 0.22],
      middleOffset: 0.28,
      middleOpacity: 0.72,
      endOffset: 0.58,
    },
    action: { center: [0.18, 0.82], startOpacity: 0.45, endOffset: 0.55 },
    scale: 1.1,
    blurAt56Px: 3,
  },
  dark: {
    baseTarget: '#09090b',
    baseWeight: 0.8,
    accent: {
      center: [0.28, 0.78],
      middleOffset: 0.28,
      middleOpacity: 0.62,
      endOffset: 0.58,
    },
    action: { center: [0.82, 0.18], startOpacity: 0.45, endOffset: 0.55 },
    scale: 1.1,
    blurAt56Px: 3,
  },
} as const;

export function previewColorsFor(
  color: PublicConfig['lightTheme'],
  mode: ThemeAppearance,
): ThemeCardPreviewColors {
  const standard = STANDARD_THEME_PREVIEW_COLORS[mode];
  if (color === 'dark') return standard;
  const accent = `var(--palette-${color}-${mode})`;
  return {
    ...standard,
    canvas: `color-mix(in oklab, ${accent} 4%, ${standard.canvas})`,
    accentSurface: `color-mix(in oklab, ${accent} 12%, ${standard.surface})`,
    accent,
    messageAction: accent,
  };
}

function getThemePreviewStyle(
  colors: ThemeCardPreviewColors,
  mode: ThemeAppearance,
): CSSProperties {
  const spec = THEME_PREVIEW_RENDER_SPECS[mode];
  const modeBase = `color-mix(in oklab, ${colors.canvas} ${spec.baseWeight * 100}%, ${spec.baseTarget})`;
  const accentPosition = `${spec.accent.center[0] * 100}% ${spec.accent.center[1] * 100}%`;
  const actionPosition = `${spec.action.center[0] * 100}% ${spec.action.center[1] * 100}%`;
  return {
    backgroundColor: modeBase,
    backgroundImage: [
      `radial-gradient(circle at ${accentPosition} in oklab, ${colors.accent} 0%, color-mix(in oklab, ${colors.accent} ${spec.accent.middleOpacity * 100}%, transparent) ${spec.accent.middleOffset * 100}%, transparent ${spec.accent.endOffset * 100}%)`,
      `radial-gradient(circle at ${actionPosition} in oklab, color-mix(in oklab, ${colors.messageAction} ${spec.action.startOpacity * 100}%, transparent) 0%, transparent ${spec.action.endOffset * 100}%)`,
    ].join(', '),
  };
}

function themePreviewEdgeShadow(mode: ThemeAppearance): string {
  return mode === 'dark'
    ? 'inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)'
    : 'inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)';
}

export function ThemePreviewCircle({
  colors,
  mode,
  className,
}: {
  colors: ThemeCardPreviewColors;
  mode: ThemeAppearance;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative block size-14 shrink-0 overflow-hidden rounded-full border-2 border-background',
        className,
      )}
      style={{ boxShadow: themePreviewEdgeShadow(mode) }}
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          ...getThemePreviewStyle(colors, mode),
          filter: `blur(${THEME_PREVIEW_RENDER_SPECS[mode].blurAt56Px}px)`,
          transform: `scale(${THEME_PREVIEW_RENDER_SPECS[mode].scale})`,
        }}
      />
    </span>
  );
}
