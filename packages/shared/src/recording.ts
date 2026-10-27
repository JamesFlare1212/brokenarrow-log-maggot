import { RECORDING_QUALITIES, RECORDING_FPS, RECORDING_BITRATE_MBPS } from '@ba/contracts';

export const QUALITIES = RECORDING_QUALITIES;
export function normalizeQuality(value: unknown): (typeof QUALITIES)[number] {
  const n = Number(value);
  return QUALITIES.find((q) => q === n) ?? QUALITIES[0];
}
export function normalizeFps(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(
        RECORDING_FPS.max,
        Math.max(RECORDING_FPS.min, Math.round(n / RECORDING_FPS.step) * RECORDING_FPS.step),
      )
    : RECORDING_FPS.default;
}
export function normalizeBitrate(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(RECORDING_BITRATE_MBPS.max, Math.max(RECORDING_BITRATE_MBPS.min, Math.round(n)))
    : RECORDING_BITRATE_MBPS.default;
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
