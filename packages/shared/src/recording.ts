export const QUALITIES = [240, 360, 480, 720, 1080] as const;
export function normalizeQuality(value: unknown): (typeof QUALITIES)[number] {
  const n = Number(value);
  return QUALITIES.find((q) => q === n) ?? 720;
}
export function normalizeFps(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(60, Math.max(30, Math.round(n))) : 30;
}
export function normalizeBitrate(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(10, Math.max(3, Math.round(n))) : 5;
}
export function canvasSize(
  quality: unknown,
  width: number,
  height: number,
): { width: number; height: number } {
  const h = normalizeQuality(quality);
  return { width: Math.max(1, Math.round(((width || 1280) * h) / (height || 720))), height: h };
}
export function estimateRecordingBytes(minutes: number, bitrate: unknown, audio: boolean): number {
  return Math.round(((normalizeBitrate(bitrate) * 1e6 + (audio ? 128000 : 0)) / 8) * minutes * 60);
}
export function filename(value: string, extension?: string): string {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('..') ||
    /[\\/:*?"<>|\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  )
    throw new Error('Invalid file name');
  if (extension && !value.toLowerCase().endsWith(extension))
    throw new Error(`Expected ${extension} file`);
  return value;
}
