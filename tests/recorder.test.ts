// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderBridge, RecorderConfig } from '@ba/contracts';

class Track extends EventTarget {
  readyState = 'live';
  enabled = true;
  muted = false;
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  constructor(readonly kind: 'audio' | 'video') {
    super();
  }
}
class Stream {
  constructor(private tracks: Track[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  addTrack(track: Track) {
    this.tracks.push(track);
  }
}
class Context {
  state = 'running';
  static instances: Context[] = [];
  destination = { stream: new Stream([new Track('audio')]) };
  sources: Array<{
    stream: Stream;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  silence = {
    offset: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  createConstantSource() {
    return this.silence;
  }
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() {
    Context.instances.push(this);
  }
  createMediaStreamDestination() {
    return this.destination;
  }
  createMediaStreamSource(stream: Stream) {
    const source = { stream, connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(source);
    return source;
  }
}
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = () => true;
  state = 'inactive';
  ondataavailable?: (event: {
    data: { size: number; arrayBuffer: () => Promise<ArrayBuffer> };
  }) => void;
  onstop?: () => void;
  onerror?: (event: Event) => void;
  constructor(
    readonly stream: Stream,
    readonly options: MediaRecorderOptions,
  ) {
    Recorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    const data = new TextEncoder().encode('recorded audio and video').buffer;
    this.ondataavailable?.({ data: { size: data.byteLength, arrayBuffer: async () => data } });
    this.onstop?.();
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let config: RecorderConfig;
let bridge: RecorderBridge;
let stop: (discard: boolean) => void;
let getUserMedia: ReturnType<typeof vi.fn>;
let desktop: Stream;
let microphone: Stream;
let canvas: Stream;
let retryAudio: (requestId: string) => void;

beforeEach(() => {
  vi.resetModules();
  Context.instances = [];
  Recorder.instances = [];
  config = {
    sessionId: 'session',
    sourceId: 'screen:1:0',
    quality: 720,
    fps: 30,
    bitrateMbps: 5,
    audio: 'default',
    microphone: true,
  };
  desktop = new Stream([new Track('video'), new Track('audio')]);
  microphone = new Stream([new Track('audio')]);
  canvas = new Stream([new Track('video')]);
  getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
    constraints.video === false ? microphone : desktop,
  );
  vi.stubGlobal('MediaStream', Stream);
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    value: () => canvas,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  bridge = {
    config: vi.fn(async () => config),
    started: vi.fn(async () => {}),
    audio: vi.fn(async () => {}),
    retryAudio: vi.fn((callback) => {
      retryAudio = callback;
      return vi.fn();
    }),
    chunk: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    failure: vi.fn(async () => {}),
    preview: vi.fn(),
    stop: (callback) => {
      stop = callback;
      return vi.fn();
    },
  };
  Object.assign(window, { recorder: bridge });
  document.body.innerHTML = '<video id="capture" muted></video>';
});
afterEach(() => {
  stop?.(true);
  vi.unstubAllGlobals();
});
async function start() {
  await import('../apps/web/src/recorder');
  await vi.waitFor(() =>
    expect(bridge.started).toHaveBeenCalledWith('session', expect.any(Boolean), expect.any(Object)),
  );
  return Recorder.instances[0]!;
}

describe('recorder microphone capture', () => {
  it.each(['system', 'microphone'] as const)(
    'reports an ended %s input while the other mixed source and video continue',
    async (source) => {
      const recorder = await start(),
        track = (source === 'system' ? desktop : microphone).getAudioTracks()[0]!;
      const output = recorder.stream.getAudioTracks()[0]!;
      track.stop();
      await vi.waitFor(() =>
        expect(bridge.audio).toHaveBeenCalledWith(
          'session',
          expect.objectContaining({ [source]: { state: 'ended', gap: true } }),
        ),
      );
      expect(output.readyState).toBe('live');
      expect(recorder.state).toBe('recording');
      expect(canvas.getVideoTracks()[0]!.readyState).toBe('live');
      expect(bridge.failure).not.toHaveBeenCalled();
      stop(false);
      await vi.waitFor(() =>
        expect(bridge.finish).toHaveBeenCalledWith(
          'session',
          expect.any(Number),
          true,
          expect.objectContaining({ [source]: { state: 'ended', gap: true } }),
        ),
      );
    },
  );

  it('retains a gap after mute/unmute and notices disabled inputs without a track event', async () => {
    await start();
    const track = microphone.getAudioTracks()[0]!;
    track.muted = true;
    track.dispatchEvent(new Event('mute'));
    expect(bridge.audio).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ microphone: { state: 'muted', gap: true } }),
    );
    track.muted = false;
    track.dispatchEvent(new Event('unmute'));
    expect(bridge.audio).toHaveBeenLastCalledWith(
      'session',
      expect.objectContaining({ microphone: { state: 'active', gap: true } }),
    );
    track.enabled = false;
    await vi.waitFor(() =>
      expect(bridge.audio).toHaveBeenLastCalledWith(
        'session',
        expect.objectContaining({ microphone: { state: 'muted', gap: true } }),
      ),
    );
  });

  it('treats a suspended mixer as interrupted audio even while both input tracks stay live', async () => {
    await start();
    Context.instances[0]!.state = 'suspended';
    await vi.waitFor(() =>
      expect(bridge.audio).toHaveBeenCalledWith('session', {
        system: { state: 'muted', gap: true },
        microphone: { state: 'muted', gap: true },
      }),
    );
    Context.instances[0]!.state = 'running';
    await vi.waitFor(() =>
      expect(bridge.audio).toHaveBeenCalledWith('session', {
        system: { state: 'active', gap: true },
        microphone: { state: 'active', gap: true },
      }),
    );
  });

  it('keeps an encoded audio path when both requested sources fail, and reconnects them without replacing the output track', async () => {
    getUserMedia
      .mockRejectedValueOnce(new Error('System unavailable'))
      .mockResolvedValueOnce(new Stream([new Track('video')]))
      .mockRejectedValueOnce(new Error('Microphone unavailable'));
    const recorder = await start(),
      output = recorder.stream.getAudioTracks()[0];
    expect(output).toBeTruthy();
    expect(Context.instances[0]!.silence.offset.value).toBe(0);
    expect(Context.instances[0]!.silence.start).toHaveBeenCalledOnce();
    expect(bridge.started).toHaveBeenCalledWith('session', false, {
      system: { state: 'unavailable', gap: true },
      microphone: { state: 'unavailable', gap: true },
    });
    retryAudio('retry-1');
    await vi.waitFor(() =>
      expect(bridge.audio).toHaveBeenCalledWith(
        'session',
        { system: { state: 'active', gap: true }, microphone: { state: 'active', gap: true } },
        'retry-1',
      ),
    );
    expect(Recorder.instances).toHaveLength(1);
    expect(recorder.stream.getAudioTracks()).toEqual([output]);
    expect(recorder.state).toBe('recording');
    stop(false);
    await vi.waitFor(() =>
      expect(bridge.finish).toHaveBeenCalledWith(
        'session',
        expect.any(Number),
        true,
        expect.any(Object),
      ),
    );
  });

  it('keeps video and good system audio active while a microphone retry is held or fails', async () => {
    getUserMedia
      .mockResolvedValueOnce(desktop)
      .mockRejectedValueOnce(new Error('Microphone unavailable'));
    const recorder = await start(),
      pending = deferred<Stream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    retryAudio('retry-1');
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(3));
    retryAudio('retry-duplicate');
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(recorder.state).toBe('recording');
    expect(desktop.getAudioTracks()[0]!.readyState).toBe('live');
    pending.resolve(microphone);
    await vi.waitFor(() =>
      expect(bridge.audio).toHaveBeenCalledWith(
        'session',
        expect.objectContaining({ microphone: { state: 'active', gap: true } }),
        'retry-1',
      ),
    );
  });

  it('releases audio granted after a retry is cancelled without updating an expired capture', async () => {
    getUserMedia
      .mockResolvedValueOnce(desktop)
      .mockRejectedValueOnce(new Error('Microphone unavailable'));
    await start();
    const pending = deferred<Stream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    retryAudio('retry-1');
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(3));
    stop(true);
    pending.resolve(microphone);
    await vi.waitFor(() => expect(microphone.getAudioTracks()[0]!.stop).toHaveBeenCalled());
    expect(vi.mocked(bridge.audio).mock.calls.some((call) => call[2] === 'retry-1')).toBe(false);
    expect(bridge.finish).not.toHaveBeenCalled();
  });
  it('passes 4K, 120fps and 20Mbps through to the capture source and encoder', async () => {
    config.quality = 2160;
    config.fps = 120;
    config.bitrateMbps = 20;
    const width = vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(3840);
    const height = vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(2160);
    const capture = vi.spyOn(HTMLCanvasElement.prototype, 'captureStream');
    try {
      const recorder = await start();
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: config.sourceId,
              maxFrameRate: 120,
            },
            optional: [{ minFrameRate: 120 }],
          },
        }),
      );
      expect(capture).toHaveBeenCalledWith(120);
      const output = capture.mock.instances[0] as HTMLCanvasElement;
      expect([output.width, output.height]).toEqual([3840, 2160]);
      expect(recorder.options.videoBitsPerSecond).toBe(20_000_000);
    } finally {
      capture.mockRestore();
      width.mockRestore();
      height.mockRestore();
    }
  });

  it('mixes system and microphone into one encoded audio track, saves chunks, and releases all resources', async () => {
    const recorder = await start();
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true, video: false });
    const context = Context.instances[0]!;
    expect(context.sources.map((source) => source.stream.getAudioTracks()[0])).toEqual([
      desktop.getAudioTracks()[0],
      microphone.getAudioTracks()[0],
    ]);
    for (const source of context.sources)
      expect(source.connect).toHaveBeenCalledWith(context.destination);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(recorder.stream.getAudioTracks()).toEqual(context.destination.stream.getAudioTracks());
    expect(recorder.options.mimeType).toBe('video/webm;codecs=vp8,opus');
    stop(false);
    await vi.waitFor(() =>
      expect(bridge.finish).toHaveBeenCalledWith(
        'session',
        expect.any(Number),
        true,
        expect.any(Object),
      ),
    );
    expect(bridge.chunk).toHaveBeenCalledTimes(1);
    const chunk = vi.mocked(bridge.chunk).mock.calls[0]!;
    expect(chunk.slice(0, 2)).toEqual(['session', 0]);
    expect(new TextDecoder().decode(chunk[2])).toBe('recorded audio and video');
    expect(bridge.failure).not.toHaveBeenCalled();
    for (const stream of [desktop, microphone, canvas, context.destination.stream])
      for (const track of stream.getTracks()) expect(track.stop).toHaveBeenCalled();
    for (const source of context.sources) expect(source.disconnect).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('keeps system audio without requesting a microphone when the microphone switch is off', async () => {
    config.microphone = false;
    const recorder = await start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(recorder.stream.getAudioTracks()).toEqual(
      Context.instances[0]!.destination.stream.getAudioTracks(),
    );
    expect(
      Context.instances[0]!.sources.map((source) => source.stream.getAudioTracks()[0]),
    ).toEqual(desktop.getAudioTracks());
  });

  it('does not request or encode any audio when audio is off', async () => {
    config.audio = 'off';
    desktop = new Stream([new Track('video')]);
    const recorder = await start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: expect.any(Object) });
    expect(recorder.stream.getAudioTracks()).toEqual([]);
    expect(bridge.started).toHaveBeenCalledWith('session', false, {
      system: { state: 'off', gap: false },
      microphone: { state: 'off', gap: false },
    });
  });

  it.each(['NotAllowedError', 'NotFoundError'])(
    'continues recording system audio when the microphone fails with %s',
    async (name) => {
      getUserMedia
        .mockReset()
        .mockResolvedValueOnce(desktop)
        .mockRejectedValueOnce(new DOMException('Microphone unavailable', name));
      await start();
      expect(
        Context.instances[0]!.sources.map((source) => source.stream.getAudioTracks()[0]),
      ).toEqual(desktop.getAudioTracks());
      expect(bridge.failure).not.toHaveBeenCalled();
    },
  );

  it('still records the microphone when system audio capture fails', async () => {
    desktop = new Stream([new Track('video')]);
    getUserMedia.mockRejectedValueOnce(new Error('Loopback unavailable'));
    await start();
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(
      Context.instances[0]!.sources.map((source) => source.stream.getAudioTracks()[0]),
    ).toEqual(microphone.getAudioTracks());
    expect(bridge.started).toHaveBeenCalledWith('session', true, {
      system: { state: 'unavailable', gap: true },
      microphone: { state: 'active', gap: false },
    });
  });

  it('releases a microphone granted after capture was cancelled without starting a recorder', async () => {
    const pending = deferred<Stream>();
    getUserMedia.mockResolvedValueOnce(desktop).mockReturnValueOnce(pending.promise);
    await import('../apps/web/src/recorder');
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    stop(true);
    pending.resolve(microphone);
    await vi.waitFor(() => expect(microphone.getAudioTracks()[0]!.stop).toHaveBeenCalled());
    expect(Recorder.instances).toHaveLength(0);
    expect(bridge.started).not.toHaveBeenCalled();
    expect(bridge.finish).not.toHaveBeenCalled();
  });

  it('releases microphone and mixer when the encoder fails', async () => {
    const recorder = await start();
    recorder.onerror?.(new Event('error'));
    expect(bridge.failure).toHaveBeenCalledWith('session', 'MediaRecorder failed');
    expect(microphone.getAudioTracks()[0]!.stop).toHaveBeenCalled();
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
  });
});
