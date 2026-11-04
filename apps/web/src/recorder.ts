import type { RecorderBridge } from '@ba/contracts';
import { canvasSize } from '@ba/shared';
import {
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny';
import {
  prepareRecordingAudio,
  recordingAudioConfig,
  selectRecordingEncoder,
  withRecordingDeadline,
} from './recordings/encoder';
import './recorder.css';

const bridge = (window as unknown as { recorder: RecorderBridge }).recorder;
const startup = new AbortController();
let stream: MediaStream | null = null;
let microphone: MediaStream | null = null;
let mixedAudio: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let output: Output | null = null;
let videoSource: MediaStreamVideoTrackSource | null = null;
let audioSource: MediaStreamAudioTrackSource | null = null;
let preview: ReturnType<typeof setInterval> | null = null;
let discard = false;
let stopRequested = false;
let failed = false;
let stopping: Promise<void> | null = null;
let startedAt = 0;
let token = '';
let hasAudio = false;
const audioSources: MediaStreamAudioSourceNode[] = [];

function cleanup() {
  if (preview) clearInterval(preview);
  preview = null;
  stream?.getTracks().forEach((track) => track.stop());
  microphone?.getTracks().forEach((track) => track.stop());
  mixedAudio?.getTracks().forEach((track) => track.stop());
  audioSources.splice(0).forEach((source) => source.disconnect());
  if (audioContext) {
    void audioContext.close().catch(() => {});
    audioContext = null;
  }
}

async function failure(error: unknown) {
  if (failed || discard) return;
  failed = true;
  stopRequested = true;
  startup.abort();
  cleanup();
  if (output && output.state !== 'finalized') void output.cancel().catch(() => {});
  await bridge.failure(token, error instanceof Error ? error.message : String(error));
}

async function stop() {
  if (preview) clearInterval(preview);
  if (discard || !output || !startedAt) {
    if (output) void output.cancel().catch(() => {});
    cleanup();
    return;
  }
  const duration = (performance.now() - startedAt) / 1000;
  try {
    // Freeze both timelines before flushing either encoder to avoid an extra audio tail.
    videoSource?.pause();
    audioSource?.pause();
    // Finalization drains encoders, muxer fragments and acknowledged disk writes.
    await output.finalize();
    cleanup();
    if (!discard && !failed) await bridge.finish(token, duration, hasAudio);
  } catch (error) {
    await failure(error);
  }
}

const unsubscribe = bridge.stop((cancel) => {
  discard ||= cancel;
  stopRequested = true;
  startup.abort();
  if (cancel) cleanup();
  stopping ??= stop();
});
window.addEventListener('beforeunload', () => {
  discard = true;
  stopRequested = true;
  startup.abort();
  unsubscribe();
  cleanup();
  if (output && output.state !== 'finalized') void output.cancel().catch(() => {});
});

async function start() {
  try {
    const config = await bridge.config();
    token = config.sessionId;
    if (stopRequested) return;
    const video = document.getElementById('capture') as HTMLVideoElement;
    const constraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: config.sourceId,
        maxFrameRate: config.fps,
      },
      optional: [{ minFrameRate: config.fps }],
    } as unknown as MediaTrackConstraints;
    if (config.audio === 'default') {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: { chromeMediaSource: 'desktop' },
          } as unknown as MediaTrackConstraints,
          video: constraints,
        });
      } catch {
        stream = null;
      }
    }
    if (!stream && !stopRequested)
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
    if (stopRequested) {
      cleanup();
      return;
    }
    if (!stream) throw new Error('Screen capture is unavailable');
    if (config.audio === 'default' && config.microphone) {
      try {
        microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (error) {
        console.warn('Microphone capture unavailable', error);
      }
      if (stopRequested) {
        cleanup();
        return;
      }
    }
    video.srcObject = stream;
    await video.play();
    if (stopRequested) {
      cleanup();
      return;
    }
    const size = canvasSize(config.quality, video.videoWidth, video.videoHeight);
    // Chroma-subsampled hardware encoders need even dimensions, including ultrawide displays.
    const dimensions = { width: Math.max(2, Math.round(size.width / 2) * 2), height: size.height };
    const selected = await selectRecordingEncoder(
      config.qualityScore,
      dimensions,
      config.fps,
      startup.signal,
    );
    if (stopRequested) {
      cleanup();
      return;
    }
    const audioTracks = [...stream.getAudioTracks(), ...(microphone?.getAudioTracks() ?? [])];
    if (audioTracks.length) await prepareRecordingAudio(startup.signal);
    if (stopRequested) {
      cleanup();
      return;
    }
    let audioTrack = audioTracks[0];
    if (audioTracks.length > 1) {
      const context = new AudioContext({ sampleRate: 48000 });
      audioContext = context;
      const destination = context.createMediaStreamDestination();
      mixedAudio = destination.stream;
      for (const track of audioTracks) {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        audioSources.push(source);
        source.connect(destination);
      }
      await context.resume();
      if (stopRequested) {
        cleanup();
        return;
      }
      audioTrack = mixedAudio.getAudioTracks()[0];
    }
    hasAudio = Boolean(audioTrack);
    let sequence = 0;
    let position = 0;
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 2 }),
      target: new StreamTarget(
        new WritableStream({
          async write(chunk) {
            if (discard) return;
            if (chunk.position !== position) throw new Error('Unexpected MP4 write position');
            for (let offset = 0; offset < chunk.data.byteLength; offset += 1024 * 1024) {
              if (discard) return;
              const bytes = chunk.data.slice(offset, offset + 1024 * 1024);
              await bridge.chunk(token, sequence++, bytes.buffer);
              position += bytes.byteLength;
            }
          },
        }),
        { chunked: true, chunkSize: 1024 * 1024 },
      ),
    });
    let videoReady = () => {};
    let audioReady = () => {};
    const readiness = [
      new Promise<void>((resolve) => {
        videoReady = resolve;
      }),
    ];
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Screen capture has no video track');
    videoSource = new MediaStreamVideoTrackSource(
      videoTrack,
      {
        ...selected.config,
        sizeChangeBehavior: 'contain',
        transform: dimensions,
        onEncodedPacket: () => videoReady(),
      },
      { frameRate: config.fps, timestampBase: 'synced-zero' },
    );
    const sourceErrors = [videoSource.errorPromise];
    output.addVideoTrack(videoSource, { frameRate: config.fps });
    if (audioTrack) {
      readiness.push(
        new Promise<void>((resolve) => {
          audioReady = resolve;
        }),
      );
      audioSource = new MediaStreamAudioTrackSource(
        audioTrack,
        {
          ...recordingAudioConfig(),
          onEncodedPacket: () => audioReady(),
        },
        { timestampBase: 'synced-zero' },
      );
      sourceErrors.push(audioSource.errorPromise);
      output.addAudioTrack(audioSource);
    }
    const sourceFailure = Promise.race(sourceErrors);
    void sourceFailure.catch((error) => {
      if (!stopRequested) void failure(error);
    });
    await output.start();
    startedAt = performance.now();
    await withRecordingDeadline(
      Promise.race([Promise.all(readiness), sourceFailure]),
      startup.signal,
      10000,
    );
    if (stopRequested) return;
    await bridge.started(token, hasAudio, selected.codec);
    if (stopRequested) return;
    const thumb = document.createElement('canvas');
    thumb.width = 320;
    thumb.height = Math.max(1, Math.round((320 * video.videoHeight) / video.videoWidth));
    preview = setInterval(() => {
      if (stopRequested) return;
      thumb.getContext('2d')?.drawImage(video, 0, 0, thumb.width, thumb.height);
      bridge.preview(token, thumb.toDataURL('image/jpeg', 0.5), hasAudio);
    }, 1000);
  } catch (error) {
    if (stopRequested) cleanup();
    else await failure(error);
  }
}
void start();
