import { RECORDING_CODECS, type RecordingCodec } from '@ba/contracts';
import { normalizeRecordingQualityScore } from '@ba/shared';
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  type EncodedPacket,
  type AudioEncodingConfig,
  type VideoEncodingConfig,
} from 'mediabunny';

export function recordingAudioConfig(): AudioEncodingConfig {
  return {
    codec: 'aac',
    quality: new Quality({ bitrate: 128000 }),
  };
}

export async function prepareRecordingAudio(signal: AbortSignal): Promise<void> {
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  let encoded = false;
  const source = new AudioSampleSource({
    ...recordingAudioConfig(),
    onEncodedPacket: (packet) => {
      encoded ||= packet.byteLength > 0;
    },
  });
  output.addAudioTrack(source);
  const sample = new AudioSample({
    data: new Float32Array(4800 * 2),
    format: 'f32-planar',
    sampleRate: 48000,
    numberOfChannels: 2,
    numberOfFrames: 4800,
    timestamp: 0,
  });
  try {
    // Warm up AAC and validate packet output before any live samples are queued.
    await withRecordingDeadline(
      (async () => {
        await output.start();
        await source.add(sample);
        await output.finalize();
        if (!encoded) throw new Error('AAC encoding produced no audio packets');
      })(),
      signal,
      10000,
    );
  } finally {
    sample.close();
    if (output.state !== 'finalized') void output.cancel().catch(() => {});
  }
}

export interface RecordingEncoder {
  codec: RecordingCodec;
  config: VideoEncodingConfig;
}

export function recordingQuantizer(codec: RecordingCodec, score: number): number {
  const value = normalizeRecordingQualityScore(score);
  // AV1 uses a 0–255 qindex; AVC and HEVC use a 0–51 QP. These are not equal-quality scales.
  return codec === 'av1' ? value * 4 : value;
}

export function encoderCandidates(score: number): RecordingEncoder[] {
  const create = (
    codec: RecordingCodec,
    hardwareAcceleration: 'prefer-hardware' | 'prefer-software',
  ): RecordingEncoder => ({
    codec,
    config: {
      codec: codec === 'h264' ? 'avc' : codec,
      quality: new Quality({ quantizer: recordingQuantizer(codec, score) }),
      hardwareAcceleration,
      latencyMode: 'realtime',
      keyFrameInterval: 2,
    },
  });
  return [
    ...RECORDING_CODECS.map((codec) => create(codec, 'prefer-hardware')),
    create('av1', 'prefer-software'),
  ];
}

export async function withRecordingDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
  milliseconds = 5000,
): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    signal.throwIfAborted();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        abort = () =>
          reject(signal.reason ?? new DOMException('Recording cancelled', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(
          () => reject(new Error('Recording encoder probe timed out')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export async function probeRecordingEncoder(
  candidate: RecordingEncoder,
  dimensions: { width: number; height: number },
  fps: number,
  signal: AbortSignal,
): Promise<RecordingEncoder> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined')
    throw new Error('WebCodecs is unavailable');
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Encoder probe canvas is unavailable');
  context.fillStyle = '#456789';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let firstPacket: EncodedPacket | undefined;
  let decoderConfig: VideoDecoderConfig | undefined;
  let fullCodecString: string | undefined;
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const source = new VideoSampleSource({
    ...candidate.config,
    onEncoderConfig: (config) => {
      if (config.bitrateMode !== 'quantizer') throw new Error('Quantizer mode is unavailable');
      fullCodecString = config.codec;
    },
    onEncodedPacket: (packet, metadata) => {
      firstPacket ??= packet;
      decoderConfig ??= metadata?.decoderConfig;
    },
  });
  output.addVideoTrack(source, { frameRate: fps });
  let decoder: VideoDecoder | undefined;
  let active = true;
  try {
    await withRecordingDeadline(
      (async () => {
        await output.start();
        for (let index = 0; index < 3; index++) {
          signal.throwIfAborted();
          const sample = new VideoSample(canvas, { timestamp: index / fps, duration: 1 / fps });
          try {
            await source.add(sample);
          } finally {
            sample.close();
          }
        }
        await output.finalize();
        if (!active) return;
        signal.throwIfAborted();
        if (!firstPacket?.byteLength || !decoderConfig || !fullCodecString)
          throw new Error('Encoder did not produce a playable video packet');
        if (!(await VideoDecoder.isConfigSupported(decoderConfig)).supported)
          throw new Error('Recording playback is unavailable');
        if (!active) return;
        signal.throwIfAborted();
        let decoded = false;
        let decodeError: DOMException | undefined;
        decoder = new VideoDecoder({
          output: (frame) => {
            decoded = true;
            frame.close();
          },
          error: (error) => {
            decodeError = error;
          },
        });
        decoder.configure(decoderConfig);
        decoder.decode(firstPacket.toEncodedVideoChunk());
        await decoder.flush();
        if (decodeError) throw decodeError;
        if (!decoded) throw new Error('Recording playback produced no frames');
      })(),
      signal,
    );
    return { ...candidate, config: { ...candidate.config, fullCodecString } };
  } finally {
    active = false;
    if (decoder && decoder.state !== 'closed') decoder.close();
    if (output.state !== 'finalized') void output.cancel().catch(() => {});
    canvas.width = canvas.height = 1;
  }
}

export async function selectRecordingEncoder(
  score: number,
  dimensions: { width: number; height: number },
  fps: number,
  signal: AbortSignal,
  probe = probeRecordingEncoder,
): Promise<RecordingEncoder> {
  for (const candidate of encoderCandidates(score)) {
    signal.throwIfAborted();
    try {
      return await probe(candidate, dimensions, fps, signal);
    } catch (error) {
      signal.throwIfAborted();
      console.warn(
        `Recording encoder unavailable: ${candidate.codec} (${candidate.config.hardwareAcceleration})`,
        error,
      );
    }
  }
  throw new Error(
    'No available AV1, HEVC or H.264 encoder supports quality-based recording and playback at this resolution and frame rate. Try a lower resolution or frame rate.',
  );
}
