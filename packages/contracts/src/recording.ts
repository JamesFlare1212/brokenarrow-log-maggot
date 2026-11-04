export const RECORDING_QUALITIES = [720, 1080, 1440, 2160] as const;
export type RecordingQuality = (typeof RECORDING_QUALITIES)[number];
export const RECORDING_FPS = { min: 30, max: 120, step: 10, default: 30 } as const;
export const RECORDING_QUALITY_SCORE = {
  min: 1,
  max: 51,
  default: 20,
  recommendedMin: 16,
  recommendedMax: 23,
} as const;
export const RECORDING_CODECS = ['av1', 'hevc', 'h264'] as const;
export type RecordingCodec = (typeof RECORDING_CODECS)[number];
export const RECORDING_CODEC_LABELS: Record<RecordingCodec, string> = {
  av1: 'AV1',
  hevc: 'HEVC',
  h264: 'H.264',
};
