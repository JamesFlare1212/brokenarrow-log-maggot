import { SIDEBAR_WIDTH_LIMITS } from '@ba/contracts';

const MINIMUM_WORKSPACE_WIDTH = 480;

export function maximumSidebarWidth(viewportWidth: number) {
  return Math.max(
    SIDEBAR_WIDTH_LIMITS.min,
    Math.min(SIDEBAR_WIDTH_LIMITS.max, viewportWidth - MINIMUM_WORKSPACE_WIDTH),
  );
}

export function clampSidebarWidth(width: number, maximum: number = SIDEBAR_WIDTH_LIMITS.max) {
  const value = Number.isFinite(width) ? Math.round(width) : SIDEBAR_WIDTH_LIMITS.default;
  return Math.max(SIDEBAR_WIDTH_LIMITS.min, Math.min(maximum, value));
}
