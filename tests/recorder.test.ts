// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderBridge, RecorderConfig } from '@ba/contracts';

class Track {
  stop = vi.fn();
  constructor(readonly kind: 'audio' | 'video') {}
}
class Stream {
  constructor(private tracks: Track[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  addTrack(track: Track) {
    this.tracks.push(track);
  }
}
class Context {
  static instances: Context[] = [];
  destination = { stream: new Stream([new Track('audio')]) };
  sources: Array<{
    stream: Stream;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
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
const media = vi.hoisted(() => {
  class Quality {
    constructor(readonly options: { bitrate?: number; quantizer?: number }) {}
  }
  class Source {
    pause = vi.fn();
    fail!: (error: Error) => void;
    errorPromise = new Promise<never>((_resolve, reject) => {
      this.fail = reject;
    });
    constructor(
      readonly track: MediaStreamTrack,
      readonly config: Record<string, unknown>,
      readonly options?: unknown,
    ) {}
  }
  class StreamTarget {
    constructor(
      readonly writable: WritableStream<{ type: 'write'; data: Uint8Array; position: number }>,
    ) {}
  }
  class Output {
    static instances: Output[] = [];
    state = 'pending';
    video?: Source;
    audio?: Source;
    constructor(readonly options: { target: StreamTarget }) {
      Output.instances.push(this);
    }
    addVideoTrack(source: Source) {
      this.video = source;
    }
    addAudioTrack(source: Source) {
      this.audio = source;
    }
    async start() {
      this.state = 'started';
      for (const source of [this.video, this.audio])
        (source?.config.onEncodedPacket as (() => void) | undefined)?.();
    }
    async finalize() {
      const writer = this.options.target.writable.getWriter();
      try {
        await writer.write({
          type: 'write',
          data: new TextEncoder().encode('recorded audio and video'),
          position: 0,
        });
        await writer.close();
        this.state = 'finalized';
      } finally {
        writer.releaseLock();
      }
    }
    async cancel() {
      this.state = 'canceled';
    }
  }
  return { Quality, Source, StreamTarget, Output, select: vi.fn(), prepareAudio: vi.fn() };
});
vi.mock('../apps/web/node_modules/mediabunny/dist/modules/src/index.js', () => ({
  Output: media.Output,
  StreamTarget: media.StreamTarget,
  Quality: media.Quality,
  Mp4OutputFormat: class {},
  MediaStreamVideoTrackSource: media.Source,
  MediaStreamAudioTrackSource: media.Source,
}));
vi.mock('../apps/web/src/recordings/encoder', () => ({
  selectRecordingEncoder: media.select,
  prepareRecordingAudio: media.prepareAudio,
  recordingAudioConfig: () => ({ codec: 'aac', quality: new media.Quality({ bitrate: 128000 }) }),
  withRecordingDeadline: (promise: Promise<unknown>) => promise,
}));
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

beforeEach(() => {
  vi.resetModules();
  Context.instances = [];
  media.Output.instances = [];
  media.prepareAudio.mockReset().mockResolvedValue(undefined);
  media.select.mockReset().mockResolvedValue({
    codec: 'av1',
    config: { codec: 'av1', quality: new media.Quality({ quantizer: 80 }) },
  });
  config = {
    sessionId: 'session',
    sourceId: 'screen:1:0',
    quality: 720,
    fps: 30,
    qualityScore: 20,
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
    expect(bridge.started).toHaveBeenCalledWith('session', expect.any(Boolean), 'av1'),
  );
  return media.Output.instances[0]!;
}

describe('recorder microphone capture', () => {
  it('passes 4K, 120fps and quality score through to capability probing and encoding', async () => {
    config.quality = 2160;
    config.fps = 120;
    config.qualityScore = 18;
    const width = vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(3840);
    const height = vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(2160);

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
      expect(media.select).toHaveBeenCalledWith(
        18,
        { width: 3840, height: 2160 },
        120,
        expect.any(AbortSignal),
      );
      expect(recorder.video?.config.transform).toEqual({ width: 3840, height: 2160 });
      expect(recorder.video?.options).toEqual({ frameRate: 120, timestampBase: 'synced-zero' });
    } finally {
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
    expect(recorder.audio?.track).toBe(context.destination.stream.getAudioTracks()[0]);
    expect(recorder.video?.config.codec).toBe('av1');
    expect(recorder.audio?.config.codec).toBe('aac');
    stop(false);
    await vi.waitFor(() =>
      expect(bridge.finish).toHaveBeenCalledWith('session', expect.any(Number), true),
    );
    expect(bridge.chunk).toHaveBeenCalledTimes(1);
    const chunk = vi.mocked(bridge.chunk).mock.calls[0]!;
    expect(chunk.slice(0, 2)).toEqual(['session', 0]);
    expect(new TextDecoder().decode(chunk[2])).toBe('recorded audio and video');
    expect(bridge.failure).not.toHaveBeenCalled();
    expect(recorder.video?.pause).toHaveBeenCalledOnce();
    expect(recorder.audio?.pause).toHaveBeenCalledOnce();
    for (const stream of [desktop, microphone, context.destination.stream])
      for (const track of stream.getTracks()) expect(track.stop).toHaveBeenCalled();
    for (const source of context.sources) expect(source.disconnect).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('keeps system audio without requesting a microphone when the microphone switch is off', async () => {
    config.microphone = false;
    const recorder = await start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(recorder.audio?.track).toBe(desktop.getAudioTracks()[0]);
    expect(Context.instances).toHaveLength(0);
  });

  it('does not request or encode any audio when audio is off', async () => {
    config.audio = 'off';
    desktop = new Stream([new Track('video')]);
    const recorder = await start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: expect.any(Object) });
    expect(recorder.audio).toBeUndefined();
    expect(media.prepareAudio).not.toHaveBeenCalled();
    expect(bridge.started).toHaveBeenCalledWith('session', false, 'av1');
  });

  it.each(['NotAllowedError', 'NotFoundError'])(
    'continues recording system audio when the microphone fails with %s',
    async (name) => {
      getUserMedia
        .mockReset()
        .mockResolvedValueOnce(desktop)
        .mockRejectedValueOnce(new DOMException('Microphone unavailable', name));
      const recorder = await start();
      expect(recorder.audio?.track).toBe(desktop.getAudioTracks()[0]);
      expect(bridge.failure).not.toHaveBeenCalled();
    },
  );

  it('still records the microphone when system audio capture fails', async () => {
    desktop = new Stream([new Track('video')]);
    getUserMedia.mockRejectedValueOnce(new Error('Loopback unavailable'));
    const recorder = await start();
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(recorder.audio?.track).toBe(microphone.getAudioTracks()[0]);
    expect(bridge.started).toHaveBeenCalledWith('session', true, 'av1');
  });

  it('releases a microphone granted after capture was cancelled without starting a recorder', async () => {
    const pending = deferred<Stream>();
    getUserMedia.mockResolvedValueOnce(desktop).mockReturnValueOnce(pending.promise);
    await import('../apps/web/src/recorder');
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    stop(true);
    pending.resolve(microphone);
    await vi.waitFor(() => expect(microphone.getAudioTracks()[0]!.stop).toHaveBeenCalled());
    expect(media.Output.instances).toHaveLength(0);
    expect(bridge.started).not.toHaveBeenCalled();
    expect(bridge.finish).not.toHaveBeenCalled();
  });

  it('releases microphone and mixer when the encoder fails', async () => {
    const recorder = await start();
    recorder.video?.fail(new Error('Encoder failed'));
    await vi.waitFor(() =>
      expect(bridge.failure).toHaveBeenCalledWith('session', 'Encoder failed'),
    );
    expect(microphone.getAudioTracks()[0]!.stop).toHaveBeenCalled();
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce();
  });

  it('cancels a pending codec probe without starting an output', async () => {
    const pending = deferred<{ codec: string; config: { codec: string } }>();
    media.select.mockReturnValueOnce(pending.promise);
    await import('../apps/web/src/recorder');
    await vi.waitFor(() => expect(media.select).toHaveBeenCalled());
    stop(true);
    pending.resolve({ codec: 'av1', config: { codec: 'av1' } });
    await vi.waitFor(() => expect(desktop.getVideoTracks()[0]!.stop).toHaveBeenCalled());
    expect(media.Output.instances).toHaveLength(0);
    expect(bridge.started).not.toHaveBeenCalled();
    expect(bridge.finish).not.toHaveBeenCalled();
  });

  it('waits for the final disk acknowledgement before reporting a saved recording', async () => {
    const writing = deferred<void>();
    vi.mocked(bridge.chunk).mockReturnValueOnce(writing.promise);
    await start();
    stop(false);
    await vi.waitFor(() => expect(bridge.chunk).toHaveBeenCalledOnce());
    expect(bridge.finish).not.toHaveBeenCalled();
    writing.resolve();
    await vi.waitFor(() => expect(bridge.finish).toHaveBeenCalledOnce());
  });

  it('reports a failed disk write without finalizing a saved recording', async () => {
    vi.mocked(bridge.chunk).mockRejectedValueOnce(new Error('Disk full'));
    await start();
    stop(false);
    await vi.waitFor(() => expect(bridge.failure).toHaveBeenCalledWith('session', 'Disk full'));
    expect(bridge.finish).not.toHaveBeenCalled();
  });

  it('releases capture and reports AAC initialization failure before starting a recording', async () => {
    media.prepareAudio.mockRejectedValueOnce(new Error('AAC initialization failed'));
    await import('../apps/web/src/recorder');
    await vi.waitFor(() =>
      expect(bridge.failure).toHaveBeenCalledWith('session', 'AAC initialization failed'),
    );
    expect(media.Output.instances).toHaveLength(0);
    expect(bridge.started).not.toHaveBeenCalled();
    for (const stream of [desktop, microphone])
      for (const track of stream.getTracks()) expect(track.stop).toHaveBeenCalled();
  });

  it('cancels audio initialization without publishing a partial recording', async () => {
    const pending = deferred<void>();
    media.prepareAudio.mockReturnValueOnce(pending.promise);
    await import('../apps/web/src/recorder');
    await vi.waitFor(() => expect(media.prepareAudio).toHaveBeenCalled());
    stop(true);
    pending.resolve();
    await vi.waitFor(() => expect(desktop.getVideoTracks()[0]!.stop).toHaveBeenCalled());
    expect(media.Output.instances).toHaveLength(0);
    expect(bridge.started).not.toHaveBeenCalled();
    expect(bridge.finish).not.toHaveBeenCalled();
  });
});
