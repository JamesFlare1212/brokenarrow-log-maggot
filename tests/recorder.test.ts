// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema, rpcSchemas, type RecorderBridge, type RecorderConfig } from '@ba/contracts';

class Track {
  stop = vi.fn();
  constructor(readonly kind: 'audio' | 'video') {}
}
class Stream {
  constructor(private tracks: Track[] = []) {}
  getTracks() {
    return this.tracks;
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
    expect(bridge.started).toHaveBeenCalledWith('session', expect.any(Boolean)),
  );
  return Recorder.instances[0]!;
}

describe('recorder microphone capture', () => {
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
      expect(bridge.finish).toHaveBeenCalledWith('session', expect.any(Number), true),
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
    expect(recorder.stream.getAudioTracks()).toEqual(desktop.getAudioTracks());
    expect(Context.instances).toHaveLength(0);
  });

  it('does not request or encode any audio when audio is off', async () => {
    config.audio = 'off';
    desktop = new Stream([new Track('video')]);
    const recorder = await start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: expect.any(Object) });
    expect(recorder.stream.getAudioTracks()).toEqual([]);
    expect(bridge.started).toHaveBeenCalledWith('session', false);
  });

  it.each(['NotAllowedError', 'NotFoundError'])(
    'continues recording system audio when the microphone fails with %s',
    async (name) => {
      getUserMedia
        .mockReset()
        .mockResolvedValueOnce(desktop)
        .mockRejectedValueOnce(new DOMException('Microphone unavailable', name));
      const recorder = await start();
      expect(recorder.stream.getAudioTracks()).toEqual(desktop.getAudioTracks());
      expect(bridge.failure).not.toHaveBeenCalled();
    },
  );

  it('still records the microphone when system audio capture fails', async () => {
    desktop = new Stream([new Track('video')]);
    getUserMedia.mockRejectedValueOnce(new Error('Loopback unavailable'));
    const recorder = await start();
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(recorder.stream.getAudioTracks()).toEqual(microphone.getAudioTracks());
    expect(bridge.started).toHaveBeenCalledWith('session', true);
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

  it('defaults old configurations to microphone enabled and validates partial microphone settings', () => {
    expect(configSchema.parse({ replayAudio: 'default' }).replayMicrophone).toBe(true);
    expect(configSchema.parse({ replayMicrophone: false }).replayMicrophone).toBe(false);
    expect(rpcSchemas['config.update'].parse({ replayMicrophone: false })).toEqual({
      replayMicrophone: false,
    });
    expect(rpcSchemas['config.update'].safeParse({ replayMicrophone: 'false' }).success).toBe(
      false,
    );
  });
});
