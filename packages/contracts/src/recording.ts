import { z } from 'zod';

export const RECORDING_QUALITIES = [720, 1080, 1440, 2160] as const;
export type RecordingQuality = (typeof RECORDING_QUALITIES)[number];
export const RECORDING_FPS = { min: 30, max: 120, step: 10, default: 30 } as const;
export const RECORDING_BITRATE_MBPS = { min: 5, max: 20, default: 5 } as const;

export const recordingAudioSourceSchema = z
  .object({
    state: z.enum(['off', 'starting', 'active', 'unavailable', 'muted', 'ended']),
    gap: z.boolean(),
  })
  .strict();
export const recordingAudioSchema = z
  .object({
    system: recordingAudioSourceSchema,
    microphone: recordingAudioSourceSchema,
  })
  .strict();
export type RecordingAudioState = z.infer<typeof recordingAudioSchema>;
