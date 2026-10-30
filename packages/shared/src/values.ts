import type { Metric, TeamId, Locale, Outcome } from '@ba/contracts';
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}
export function number(value: unknown): Metric {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
export function team(value: unknown, missingAlpha = false): TeamId {
  if (value == null) return missingAlpha ? 0 : null;
  if (value === 'Alpha') return 0;
  if (value === 'Bravo') return 1;
  if (value === 'Spectators') return 100;
  const n = number(value);
  return n === 0 || n === 1 || n === 100 ? n : null;
}
export function timestamp(value: unknown): number | null {
  const n = number(value);
  if (n !== null) return Math.round(n < 1e11 ? n * 1000 : n);
  if (typeof value === 'string') {
    const date = Date.parse(value);
    if (Number.isFinite(date)) return date;
  }
  return null;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function formatTime(value: number | null, locale: Locale = 'zh'): string {
  return value == null || value <= 0
    ? '—'
    : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : locale, {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(value);
}
export function formatMetric(value: Metric, digits = 2): string {
  return value == null
    ? '—'
    : new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(value);
}
export function formatPercent(value: Metric, digits = 0): string {
  return value == null || !Number.isFinite(value) ? '—' : `${formatMetric(value, digits)}%`;
}
export function formatDelta(value: Metric): string {
  return value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes,
    i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}
export function formatDuration(seconds: Metric): string {
  return seconds == null
    ? '—'
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
export function teamLabel(value: TeamId): string {
  return value === 0 ? 'Alpha' : value === 1 ? 'Bravo' : value === 100 ? 'Spectators' : '—';
}
export function outcomeTone(value: Outcome): 'success' | 'danger' | 'info' | 'muted' {
  return value === 'win'
    ? 'success'
    : value === 'loss'
      ? 'danger'
      : value === 'spectator'
        ? 'info'
        : 'muted';
}
