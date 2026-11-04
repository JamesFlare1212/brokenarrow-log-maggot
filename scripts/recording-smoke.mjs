import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electron from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: 'inherit',
  });
  const timer = setTimeout(() => {
    console.error('Recording smoke timed out');
    child.kill();
  }, 60000);
  child.once('exit', (code) => {
    clearTimeout(timer);
    process.exitCode = code ?? 1;
  });
  child.once('error', (error) => {
    clearTimeout(timer);
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const { app, BrowserWindow, ipcMain } = electron;
  void app.whenReady().then(async () => {
    let window;
    try {
      const mode = process.argv.find((arg) => arg.startsWith('--codec='))?.split('=')[1] ?? 'auto';
      if (!['auto', 'hevc', 'h264', 'software-av1'].includes(mode))
        throw new Error('Expected --codec=auto, hevc, h264 or software-av1');
      const parent = join(root, '.test-data', 'recording-smoke');
      await mkdir(parent, { recursive: true });
      const dir = await mkdtemp(join(parent, mode + '-'));
      const recording = join(dir, 'recording.mp4');
      const writer = createWriteStream(recording, { flags: 'wx' });
      const built = await readFile(join(root, 'apps/web/dist/recorder.html'), 'utf8');
      const script = built.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/)?.[1];
      if (!script) throw new Error('Build the recorder before running this smoke test');
      const renderer = pathToFileURL(resolve(root, 'apps/web/dist', script)).href;
      await writeFile(
        join(dir, 'fixture.js'),
        `
      const mode = ${JSON.stringify(mode)};
      const support = VideoEncoder.isConfigSupported.bind(VideoEncoder);
      VideoEncoder.isConfigSupported = async (config) => {
        if ((mode === 'software-av1' && config.hardwareAcceleration === 'prefer-hardware') ||
            (['hevc', 'h264'].includes(mode) && config.codec.startsWith('av01')) ||
            (mode === 'h264' && /^(hvc1|hev1)/.test(config.codec)))
          return { supported: false, config };
        return support(config);
      };
      window.encodingChecks = [];
      window.audioTiming = { count: 0 };
      const encodeAudio = AudioEncoder.prototype.encode;
      AudioEncoder.prototype.encode = function(data) {
        const timing = window.audioTiming;
        timing.firstTimestamp ??= data.timestamp;
        timing.firstWallTime ??= performance.now();
        timing.lastTimestamp = data.timestamp; timing.lastDuration = data.duration;
        timing.lastWallTime = performance.now(); timing.count++;
        return encodeAudio.call(this, data);
      };
      const configurations = new WeakMap();
      const configure = VideoEncoder.prototype.configure;
      VideoEncoder.prototype.configure = function(config) {
        configurations.set(this, config); return configure.call(this, config);
      };
      const encode = VideoEncoder.prototype.encode;
      const seen = new WeakSet();
      VideoEncoder.prototype.encode = function(frame, options) {
        if (!seen.has(this)) { seen.add(this); window.encodingChecks.push({ config: configurations.get(this), options }); }
        return encode.call(this, frame, options);
      };
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const context = canvas.getContext('2d'); let frame = 0;
      const draw = () => { context.fillStyle = '#345678'; context.fillRect(0, 0, 1280, 720);
        context.fillStyle = '#f0a030'; context.fillRect((frame++ * 10) % 1100, 180, 160, 160); };
      draw(); const timer = setInterval(draw, 1000 / 30);
      const audio = new AudioContext({ sampleRate: 48000 });
      const tone = (frequency) => { const oscillator = audio.createOscillator(); oscillator.frequency.value = frequency;
        const gain = audio.createGain(); gain.gain.value = 0.02; const target = audio.createMediaStreamDestination();
        oscillator.connect(gain).connect(target); oscillator.start(); return target.stream.getAudioTracks()[0]; };
      const system = tone(440), microphone = tone(880);
      const screen = canvas.captureStream(30); screen.addTrack(system);
      navigator.mediaDevices.getUserMedia = async ({ video }) => {
        await audio.resume(); return video === false ? new MediaStream([microphone]) : screen;
      };
      window.stopFixture = async () => { clearInterval(timer); screen.getTracks().forEach(track => track.stop());
        microphone.stop(); await audio.close(); };
    `,
      );
      await writeFile(
        join(dir, 'index.html'),
        `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:">
      <title>Recording smoke</title></head><body><video id="capture" muted autoplay playsinline></video>
      <script src="./fixture.js"></script><script type="module" src="${renderer}"></script></body></html>`,
      );
      let sequence = 0;
      let selected;
      let recordingDuration;
      let resolveDone;
      let rejectDone;
      const done = new Promise((resolveDoneValue, rejectDoneValue) => {
        resolveDone = resolveDoneValue;
        rejectDone = rejectDoneValue;
      });
      void done.catch(() => {});
      writer.on('error', rejectDone);
      ipcMain.handle('ba:recording:config', () => ({
        sessionId: 'smoke',
        sourceId: 'synthetic',
        quality: 720,
        fps: 30,
        qualityScore: 20,
        audio: 'default',
        microphone: true,
      }));
      ipcMain.handle('ba:recording:started', (_event, token, audio, codec) => {
        if (token !== 'smoke' || !audio || !['av1', 'hevc', 'h264'].includes(codec))
          throw new Error('Invalid recording readiness');
        selected = codec;
        setTimeout(() => window.webContents.send('ba:recording:stop', false), 4500);
      });
      ipcMain.handle('ba:recording:chunk', async (_event, token, index, data) => {
        if (token !== 'smoke' || index !== sequence++ || !data.byteLength)
          throw new Error('Invalid recording chunk');
        await new Promise((yes, no) =>
          writer.write(Buffer.from(data), (error) => (error ? no(error) : yes())),
        );
      });
      ipcMain.handle('ba:recording:finish', async (_event, token, seconds, audio) => {
        if (token !== 'smoke' || !audio || seconds < 4 || !sequence)
          throw new Error('Incomplete recording');
        recordingDuration = seconds;
        await new Promise((yes, no) => {
          writer.once('error', no);
          writer.end(yes);
        });
        resolveDone();
      });
      ipcMain.handle('ba:recording:failure', (_event, _token, message) =>
        rejectDone(new Error(message)),
      );
      window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: join(root, 'apps/desktop/dist/recorder-preload.cjs'),
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
          autoplayPolicy: 'no-user-gesture-required',
        },
      });
      window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error(event.message);
      });
      await window.loadFile(join(dir, 'index.html'));
      await done;
      if (recordingDuration > 6.5)
        throw new Error('Live audio took more than two seconds to become ready');
      const { Input, BufferSource, ALL_FORMATS } =
        await import('../apps/web/node_modules/mediabunny/dist/modules/src/index.js');
      const input = new Input({
        source: new BufferSource(await readFile(recording)),
        formats: ALL_FORMATS,
      });
      const videoTrack = await input.getPrimaryVideoTrack();
      const audioTrack = await input.getPrimaryAudioTrack();
      if (!videoTrack || !audioTrack)
        throw new Error('Recorded MP4 is missing a video or audio track');
      const videoDuration = await videoTrack.computeDuration();
      const audioDuration = await audioTrack.computeDuration();
      if (Math.abs(videoDuration - audioDuration) > 0.2)
        throw new Error(
          `Audio/video end times differ: video=${videoDuration}, audio=${audioDuration}; timing=${JSON.stringify(await window.webContents.executeJavaScript('window.audioTiming'))}`,
        );
      input.dispose();
      const checks = await window.webContents.executeJavaScript('window.encodingChecks');
      if (
        mode === 'software-av1' &&
        (selected !== 'av1' ||
          checks.some(
            ({ config }) =>
              config.hardwareAcceleration !== 'prefer-software' || !config.codec.startsWith('av01'),
          ))
      )
        throw new Error('Software fallback did not use AV1');
      if (
        !checks.length ||
        checks.some(
          ({ config, options }) =>
            config.bitrateMode !== 'quantizer' ||
            config.bitrate !== undefined ||
            !(
              options?.av1?.quantizer === 80 ||
              options?.hevc?.quantizer === 20 ||
              options?.avc?.quantizer === 20
            ),
        )
      )
        throw new Error('Quality scores did not reach the video encoder');
      await window.webContents.executeJavaScript('window.stopFixture()');
      const playback = await window.webContents.executeJavaScript(`(async () => {
      const video = document.createElement('video'); video.muted = true; document.body.append(video);
      const wait = (event) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Playback timed out: ' + event)), 10000);
        video.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error(video.error?.message)); }, { once: true });
      });
      const metadata = wait('loadedmetadata'); video.src = ${JSON.stringify(pathToFileURL(recording).href)}; await metadata;
      const sought = wait('seeked'); video.currentTime = 2; await sought; await video.play();
      await new Promise(resolve => video.requestVideoFrameCallback(resolve)); video.pause();
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight,
        time: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames };
    })()`);
      if (
        !Number.isFinite(playback.duration) ||
        playback.duration < 4 ||
        playback.width !== 1280 ||
        playback.height !== 720 ||
        playback.time < 2 ||
        playback.frames < 1
      )
        throw new Error('MP4 playback or seeking failed: ' + JSON.stringify(playback));
      console.log(
        'RECORDING_SMOKE_RESULT ' +
          JSON.stringify({
            mode,
            selected,
            recordingDuration,
            chunks: sequence,
            quantizerVerified: true,
            videoDuration,
            audioDuration,
            playback,
            file: recording,
          }),
      );
      window.destroy();
      app.quit();
    } catch (error) {
      console.error(error);
      window?.destroy();
      app.exit(1);
    }
  });
}
