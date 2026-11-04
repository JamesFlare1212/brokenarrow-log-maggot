import { describe, expect, it, vi } from 'vitest';
import {
  encoderCandidates,
  recordingQuantizer,
  selectRecordingEncoder,
  withRecordingDeadline,
} from '../apps/web/src/recordings/encoder';

const dimensions = { width: 1920, height: 1080 };

describe('recording encoder selection', () => {
  it.each([
    ['av1', 0],
    ['hevc', 1],
    ['h264', 2],
  ] as const)(
    'selects %s only after all higher-priority encoders fail a real probe',
    async (codec, failures) => {
      const candidates = encoderCandidates(20);
      const probe = vi.fn(async (candidate) => {
        if (candidate.codec !== codec) throw new Error('Initialization or playback failed');
        return candidate;
      });
      const result = await selectRecordingEncoder(
        20,
        dimensions,
        60,
        new AbortController().signal,
        probe,
      );
      expect(result.codec).toBe(codec);
      expect(probe.mock.calls.map(([candidate]) => candidate.codec)).toEqual(
        candidates.slice(0, failures + 1).map((candidate) => candidate.codec),
      );
      expect(probe).toHaveBeenLastCalledWith(
        expect.objectContaining({ codec }),
        dimensions,
        60,
        expect.any(AbortSignal),
      );
    },
  );

  it('tries software AV1 only after the three hardware-preferred probes fail', async () => {
    const probe = vi.fn(async (candidate) => {
      if (candidate.config.hardwareAcceleration !== 'prefer-software')
        throw new Error('No hardware encoder');
      return candidate;
    });
    const selected = await selectRecordingEncoder(
      20,
      dimensions,
      60,
      new AbortController().signal,
      probe,
    );
    expect(selected).toMatchObject({
      codec: 'av1',
      config: { hardwareAcceleration: 'prefer-software' },
    });
    expect(probe.mock.calls.map(([candidate]) => candidate.codec)).toEqual([
      'av1',
      'hevc',
      'h264',
      'av1',
    ]);
  });

  it('reports that no encoder is available instead of silently reverting to bitrate or VP8', async () => {
    const probe = vi.fn(async () => {
      throw new Error('Unsupported quantizer mode');
    });
    await expect(
      selectRecordingEncoder(20, dimensions, 120, new AbortController().signal, probe),
    ).rejects.toThrow('No available AV1, HEVC or H.264 encoder');
    expect(probe).toHaveBeenCalledTimes(4);
    expect(probe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        codec: 'av1',
        config: expect.objectContaining({ hardwareAcceleration: 'prefer-software' }),
      }),
      dimensions,
      120,
      expect.any(AbortSignal),
    );
  });

  it('stops probing immediately when a pending capture is cancelled', async () => {
    const controller = new AbortController();
    const probe = vi.fn(async () => {
      controller.abort();
      throw new Error('Cancelled');
    });
    await expect(
      selectRecordingEncoder(20, dimensions, 60, controller.signal, probe),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('converts the AV1 qindex separately and retains AVC/HEVC QP values', () => {
    expect(recordingQuantizer('av1', 20)).toBe(80);
    expect(recordingQuantizer('hevc', 20)).toBe(20);
    expect(recordingQuantizer('h264', 20)).toBe(20);
    expect(recordingQuantizer('av1', 51)).toBe(204);
  });

  it('bounds hung driver probes and responds to cancellation', async () => {
    const controller = new AbortController();
    const pending = new Promise<never>(() => {});
    await expect(withRecordingDeadline(pending, controller.signal, 5)).rejects.toThrow('timed out');
    const cancelled = withRecordingDeadline(pending, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  });
});
