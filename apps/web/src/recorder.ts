import type { RecorderBridge } from '@ba/contracts';
import { canvasSize } from '@ba/shared';
import './recorder.css';
const bridge = (window as unknown as { recorder: RecorderBridge }).recorder;
let stream: MediaStream | null = null,
  microphone: MediaStream | null = null,
  mixedAudio: MediaStream | null = null,
  audioContext: AudioContext | null = null,
  output: MediaStream | null = null,
  recorder: MediaRecorder | null = null,
  draw: ReturnType<typeof setInterval> | null = null,
  preview: ReturnType<typeof setInterval> | null = null,
  discard = false,
  stopRequested = false,
  queue: Promise<void> = Promise.resolve(),
  sequence = 0,
  startedAt = 0,
  token = '';
const audioSources: MediaStreamAudioSourceNode[] = [];
function cleanup() {
  if (draw) clearInterval(draw);
  if (preview) clearInterval(preview);
  draw = null;
  preview = null;
  stream?.getTracks().forEach((t) => t.stop());
  microphone?.getTracks().forEach((t) => t.stop());
  mixedAudio?.getTracks().forEach((t) => t.stop());
  output?.getTracks().forEach((t) => t.stop());
  audioSources.splice(0).forEach((source) => source.disconnect());
  if (audioContext) {
    void audioContext.close().catch(() => {});
    audioContext = null;
  }
}
const unsubscribe = bridge.stop((cancel) => {
  discard = cancel;
  stopRequested = true;
  if (draw) clearInterval(draw);
  if (preview) clearInterval(preview);
  if (recorder?.state === 'recording') recorder.stop();
  else cleanup();
});
window.addEventListener('beforeunload', () => {
  unsubscribe();
  cleanup();
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
    if (!stream)
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
    if (stopRequested) {
      cleanup();
      return;
    }
    if (config.audio === 'default' && config.microphone) {
      try {
        microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (error) {
        // Keep screen/system capture usable when no microphone is available or access is denied.
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
    const dimensions = canvasSize(config.quality, video.videoWidth, video.videoHeight),
      canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    output = canvas.captureStream(config.fps);
    const audioTracks = [...stream.getAudioTracks(), ...(microphone?.getAudioTracks() ?? [])];
    if (audioTracks.length > 1) {
      // MediaRecorder needs one mixed track to preserve both desktop and microphone audio.
      const context = new AudioContext();
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
      for (const track of mixedAudio.getAudioTracks()) output.addTrack(track);
    } else if (audioTracks[0]) output.addTrack(audioTracks[0]);
    const hasAudio = output.getAudioTracks().length > 0,
      mime =
        [
          ...(hasAudio ? ['video/webm;codecs=vp8,opus'] : []),
          'video/webm;codecs=vp8',
          'video/webm',
        ].find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';
    recorder = new MediaRecorder(output, {
      mimeType: mime,
      videoBitsPerSecond: config.bitrateMbps * 1e6,
      audioBitsPerSecond: 128000,
    });
    recorder.ondataavailable = (event) => {
      if (!event.data.size || discard) return;
      queue = queue.then(async () => {
        if (discard) return;
        const data = await event.data.arrayBuffer();
        await bridge.chunk(token, sequence++, data);
      });
    };
    recorder.onstop = () => {
      void (async () => {
        const duration = (performance.now() - startedAt) / 1000;
        cleanup();
        if (discard) return;
        await queue;
        await bridge.finish(token, duration, hasAudio);
      })().catch((error) => bridge.failure(token, String(error)));
    };
    recorder.onerror = (event) => {
      cleanup();
      void bridge.failure(
        token,
        event instanceof ErrorEvent ? event.message : 'MediaRecorder failed',
      );
    };
    recorder.start(1000);
    startedAt = performance.now();
    await bridge.started(token, hasAudio);
    if (stopRequested) return;
    draw = setInterval(() => {
      if (stopRequested) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }, 1000 / config.fps);
    const thumb = document.createElement('canvas');
    thumb.width = 320;
    thumb.height = Math.max(1, Math.round((320 * video.videoHeight) / video.videoWidth));
    preview = setInterval(() => {
      if (stopRequested) return;
      thumb.getContext('2d')?.drawImage(video, 0, 0, thumb.width, thumb.height);
      bridge.preview(token, thumb.toDataURL('image/jpeg', 0.5), hasAudio);
    }, 1000);
  } catch (error) {
    cleanup();
    if (!discard)
      await bridge.failure(token, error instanceof Error ? error.message : String(error));
  }
}
void start();
