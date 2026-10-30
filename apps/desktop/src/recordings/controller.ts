import { BrowserWindow, desktopCapturer, screen } from 'electron';
import { randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  recordingAudioSchema,
  type RecordingAudioState,
  type Display,
  type Match,
  type PublicConfig,
  type RecorderConfig,
  type RecordingState,
  type DisplayPreview,
} from '@ba/contracts';
import { errorMessage, object } from '@ba/shared';
import { replayName } from '@ba/server';
import { patchDurationFile } from './webm';
import { displayChoices, selectDisplay } from './displays';
interface Capture {
  token: string;
  generation: number;
  match: Match;
  config: RecorderConfig;
  win: BrowserWindow;
  writer: WriteStream;
  part: string;
  dir: string;
  nextSequence: number;
  queue: Promise<void>;
  done: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  stopped: boolean;
  hasAudio: boolean;
  audio?: RecordingAudioState;
  audioRetry?: {
    id: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  test: boolean;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}
export class RecordingController {
  private generation = 0;
  private current: Capture | null = null;
  private state: RecordingState = {
    phase: 'idle',
    sessionId: null,
    fid: null,
    map: '',
    sourceId: '',
    startedAt: null,
    seconds: 0,
    hasAudio: false,
    error: null,
  };
  constructor(
    private preload: string,
    private recorderPage: string,
    private directory: () => string,
    private changed: (state: RecordingState) => void,
    private saved: (name: string, duration: number, match: Match) => void,
    private previewed: (id: string, dataUrl: string, audio: boolean) => void,
  ) {}
  status(): RecordingState {
    return {
      ...this.state,
      seconds: this.state.startedAt ? Math.max(0, (Date.now() - this.state.startedAt) / 1000) : 0,
    };
  }
  private update(value: Partial<RecordingState>): void {
    this.state = { ...this.state, ...value };
    this.changed(this.status());
  }
  async displays(): Promise<Display[]> {
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 400, height: 225 },
      }),
      displays = screen.getAllDisplays();
    return displayChoices(sources, displays).map((choice, index) => ({
      id: choice.id,
      label: choice.label,
      thumbnail: sources[index]!.thumbnail.toDataURL(),
    }));
  }
  async thumbnail(id: string): Promise<string | null> {
    return (await this.displayPreview(id)).thumbnail;
  }
  async displayPreview(id: string): Promise<DisplayPreview> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 640, height: 360 },
    });
    const choices = displayChoices(sources, screen.getAllDisplays());
    const { source, target } = selectDisplay(
      sources,
      choices,
      id,
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id,
    );
    const thumbnail = source?.thumbnail.toDataURL() || null;
    return { ...target, thumbnail: thumbnail?.endsWith(',') ? null : thumbnail, displays: choices };
  }
  async start(match: Match, config: PublicConfig, test = false): Promise<void> {
    const generation = ++this.generation;
    if (this.current?.stopped) await this.current.done.catch(() => {});
    else await this.discardCurrent();
    if (generation !== this.generation) return;
    this.update({
      phase: 'starting',
      sessionId: match.sessionId,
      fid: match.fid,
      map: match.map,
      sourceId: '',
      display: undefined,
      startedAt: null,
      error: null,
      hasAudio: false,
      failure: null,
      audio: {
        system: { state: config.replayAudio === 'off' ? 'off' : 'starting', gap: false },
        microphone: {
          state: config.replayAudio === 'off' || !config.replayMicrophone ? 'off' : 'starting',
          gap: false,
        },
      },
      lastSavedName: undefined,
      audioRetryPending: false,
      audioRetryError: null,
    });
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
      });
      if (generation !== this.generation) return;
      const { source, target } = selectDisplay(
        sources,
        displayChoices(sources, screen.getAllDisplays()),
        config.replayDisplayId,
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id,
      );
      if (!source) throw new Error('No display capture source');
      this.update({ sourceId: source.id, display: target });
      const dir = this.directory();
      await mkdir(dir, { recursive: true });
      if (generation !== this.generation) return;
      const token = randomUUID(),
        part = join(dir, '.rec-part-' + token + '.webm');
      let resolve: () => void = () => {},
        reject: (e: Error) => void = () => {};
      const done = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void done.catch(() => {});
      const win = new BrowserWindow({
        show: true,
        x: -32000,
        y: -32000,
        width: 8,
        height: 8,
        frame: false,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
          preload: this.preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
          autoplayPolicy: 'no-user-gesture-required',
        },
      });
      const capture: Capture = {
        token,
        generation,
        match: structuredClone(match),
        config: {
          sessionId: token,
          sourceId: source.id,
          quality: config.replayQuality,
          fps: config.replayFps,
          bitrateMbps: config.replayBitrateMbps,
          audio: config.replayAudio,
          microphone: config.replayMicrophone,
        },
        win,
        writer: createWriteStream(part, { flags: 'wx' }),
        part,
        dir,
        nextSequence: 0,
        queue: Promise.resolve(),
        done,
        resolve,
        reject,
        stopped: false,
        hasAudio: false,
        test,
        startedAt: 0,
        timer: null,
      };
      this.current = capture;
      capture.writer.on('error', (error) => {
        void this.failCapture(capture, errorMessage(error));
      });
      win.webContents.on('render-process-gone', (_e, detail) => {
        void this.failCapture(capture, `Capture process stopped: ${detail.reason}`);
      });
      win.webContents.on('did-fail-load', (_e, code, description) => {
        if (code !== -3) void this.failCapture(capture, description);
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      capture.timer = setTimeout(() => {
        void this.failCapture(capture, 'Capture startup timed out');
      }, 30000);
      await win.loadFile(this.recorderPage);
      if (generation !== this.generation || this.current !== capture) {
        if (!win.isDestroyed()) win.destroy();
        return;
      }
    } catch (error) {
      if (generation === this.generation) {
        if (this.current) await this.failCapture(this.current, errorMessage(error));
        else
          this.update({
            phase: 'error',
            error: errorMessage(error),
            startedAt: null,
            failure: { kind: 'start', discarded: true },
          });
      }
      throw error;
    }
  }
  private owner(sender: number, token?: string): Capture {
    const capture = this.current;
    if (
      !capture ||
      capture.win.webContents.id !== sender ||
      (token !== undefined && capture.token !== token)
    )
      throw new Error('Expired capture session');
    return capture;
  }
  config(sender: number): RecorderConfig {
    return { ...this.owner(sender).config };
  }
  ready(sender: number, token: string, hasAudio: boolean, audio?: RecordingAudioState): void {
    const c = this.owner(sender, token);
    if (c.stopped) return;
    const sourceAudio = audio ? this.validateAudio(c, audio) : undefined;
    if (c.timer) clearTimeout(c.timer);
    c.timer = c.test ? setTimeout(() => void this.stop(), 60000) : null;
    c.startedAt = Date.now();
    c.audio = sourceAudio;
    c.hasAudio = c.audio
      ? Object.values(c.audio).some((source) => source.state === 'active')
      : hasAudio;
    this.update({
      phase: 'recording',
      sessionId: token,
      fid: c.match.fid,
      map: c.match.map,
      sourceId: c.config.sourceId,
      startedAt: c.startedAt,
      hasAudio: c.hasAudio,
      audio: c.audio,
    });
  }
  private validateAudio(c: Capture, value: RecordingAudioState): RecordingAudioState {
    const audio = recordingAudioSchema.parse(value);
    for (const source of ['system', 'microphone'] as const) {
      const requested =
        c.config.audio === 'default' && (source === 'system' || c.config.microphone);
      if (!requested) {
        if (audio[source].state !== 'off' || audio[source].gap)
          throw new Error('Unrequested recording audio source');
      } else if (audio[source].state === 'off')
        throw new Error('Missing requested recording audio status');
      audio[source].gap ||=
        !!c.audio?.[source].gap || ['unavailable', 'muted', 'ended'].includes(audio[source].state);
    }
    return audio;
  }
  audio(sender: number, token: string, value: RecordingAudioState, retryId?: string): void {
    const c = this.owner(sender, token);
    if (c.stopped || this.state.phase !== 'recording') return;
    const next = this.validateAudio(c, value);
    if (JSON.stringify(next) !== JSON.stringify(c.audio)) {
      c.audio = next;
      c.hasAudio = Object.values(c.audio).some((source) => source.state === 'active');
      this.update({
        audio: c.audio,
        hasAudio: c.hasAudio,
        audioRetryError: Object.values(c.audio).every((source) =>
          ['active', 'off'].includes(source.state),
        )
          ? null
          : this.state.audioRetryError,
      });
    }
    if (retryId && c.audioRetry?.id === retryId) {
      const pending = c.audioRetry;
      c.audioRetry = undefined;
      clearTimeout(pending.timer);
      const missing = Object.values(c.audio!).some(
        (source) => !['active', 'off'].includes(source.state),
      );
      this.update({
        audioRetryPending: false,
        audioRetryError: missing ? 'RECORDING_AUDIO_UNAVAILABLE' : null,
      });
      if (missing) pending.reject(new Error('RECORDING_AUDIO_UNAVAILABLE'));
      else pending.resolve();
    }
  }
  async retryAudio(sessionId: string): Promise<void> {
    const c = this.current;
    if (
      !c ||
      c.token !== sessionId ||
      c.stopped ||
      this.state.phase !== 'recording' ||
      c.config.audio === 'off' ||
      !c.audio ||
      Object.values(c.audio).every((source) => ['active', 'off'].includes(source.state))
    )
      throw new Error('RECORDING_AUDIO_RETRY_UNAVAILABLE');
    if (c.audioRetry) throw new Error('RECORDING_AUDIO_RETRY_PENDING');
    this.update({ audioRetryPending: true, audioRetryError: null });
    await new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        if (c.audioRetry?.id !== id) return;
        c.audioRetry = undefined;
        if (this.current === c)
          this.update({
            audioRetryPending: false,
            audioRetryError: 'RECORDING_AUDIO_RETRY_TIMEOUT',
          });
        reject(new Error('RECORDING_AUDIO_RETRY_TIMEOUT'));
      }, 30000);
      c.audioRetry = { id, resolve, reject, timer };
      c.win.webContents.send('ba:recording:retry-audio', id);
    });
  }
  private cancelAudioRetry(c: Capture): void {
    if (!c.audioRetry) return;
    clearTimeout(c.audioRetry.timer);
    c.audioRetry.reject(new Error('RECORDING_AUDIO_RETRY_UNAVAILABLE'));
    c.audioRetry = undefined;
  }
  async chunk(sender: number, token: string, sequence: number, data: ArrayBuffer): Promise<void> {
    const c = this.owner(sender, token);
    if (
      sequence !== c.nextSequence ||
      !Number.isInteger(sequence) ||
      !(data instanceof ArrayBuffer) ||
      !data.byteLength ||
      data.byteLength > 16 * 1024 * 1024
    )
      throw new Error('Invalid recording chunk');
    c.nextSequence++;
    c.queue = c.queue.then(
      () =>
        new Promise<void>((resolve, reject) =>
          c.writer.write(Buffer.from(data), (error) => (error ? reject(error) : resolve())),
        ),
    );
    await c.queue;
  }
  preview(
    sender: number,
    token: string,
    dataUrl: string,
    hasAudio: boolean,
    audio?: RecordingAudioState,
  ): void {
    const c = this.owner(sender, token);
    if (
      c.stopped ||
      this.state.phase !== 'recording' ||
      dataUrl.length > 300000 ||
      !dataUrl.startsWith('data:image/jpeg;base64,')
    )
      return;
    if (audio) this.audio(sender, token, audio);
    this.previewed(token, dataUrl, c.audio ? c.hasAudio : hasAudio);
  }
  async finish(
    sender: number,
    token: string,
    duration: number,
    hasAudio: boolean,
    audio?: RecordingAudioState,
  ): Promise<void> {
    const c = this.owner(sender, token);
    if (!Number.isFinite(duration) || duration < 0 || duration > 86400)
      throw new Error('Invalid recording duration');
    if (audio) c.audio = this.validateAudio(c, audio);
    try {
      await c.queue;
      await new Promise<void>((resolve, reject) => {
        c.writer.once('error', reject);
        c.writer.end(resolve);
      });
      if (!(await stat(c.part)).size) throw new Error('No recording data');
      const me = c.match.players.find((p) => p.id === c.match.localPlayerId),
        name =
          (c.test ? 'test_' : '') +
          replayName({
            fid: c.test ? null : c.match.fid,
            id: c.test ? '0' : c.match.localPlayerId,
            name: c.test ? 'Recording test' : me?.name || c.match.localPersona,
            teamId: me?.teamId ?? null,
            mapId: c.match.mapId,
          }),
        final = join(c.dir, '.rec-final-' + c.token + '.webm');
      await patchDurationFile(c.part, final, duration);
      await rename(final, join(c.dir, name));
      let warning: string | null = null;
      try {
        await unlink(c.part);
      } catch (error) {
        warning = errorMessage(error);
      }
      c.hasAudio = hasAudio;
      try {
        this.saved(name, duration, c.match);
      } catch (error) {
        warning = errorMessage(error);
      }
      this.complete(c, name);
      if (warning && this.generation === c.generation)
        this.update({
          error: warning,
          failure: { kind: 'metadata', discarded: false, savedName: name },
        });
    } catch (error) {
      await this.failCapture(c, errorMessage(error));
      throw error;
    }
  }
  async failure(sender: number, token: string, message: string): Promise<void> {
    await this.failCapture(this.owner(sender, token), message.slice(0, 1000));
  }
  private complete(c: Capture, name: string): void {
    this.cancelAudioRetry(c);
    if (c.timer) clearTimeout(c.timer);
    if (this.current === c) {
      this.current = null;
      this.update({
        phase: 'idle',
        sessionId: null,
        fid: null,
        map: '',
        sourceId: '',
        display: undefined,
        startedAt: null,
        seconds: 0,
        error: null,
        failure: null,
        audio: c.audio,
        lastSavedName: name,
        hasAudio: false,
        audioRetryPending: false,
        audioRetryError: null,
      });
    }
    if (!c.win.isDestroyed()) c.win.destroy();
    c.resolve();
  }
  private async failCapture(c: Capture, message: string): Promise<void> {
    if (this.current !== c) return;
    this.cancelAudioRetry(c);
    if (c.timer) clearTimeout(c.timer);
    this.current = null;
    c.writer.destroy();
    if (!c.writer.closed) await new Promise<void>((resolve) => c.writer.once('close', resolve));
    if (!c.win.isDestroyed()) c.win.destroy();
    let discarded = true;
    for (const file of [c.part, join(c.dir, '.rec-final-' + c.token + '.webm')]) {
      try {
        await unlink(file);
      } catch (error) {
        if (object(error).code !== 'ENOENT') discarded = false;
      }
    }
    if (this.generation === c.generation && this.current === null)
      this.update({
        phase: 'error',
        error: message,
        startedAt: null,
        sessionId: null,
        failure: { kind: !c.startedAt ? 'start' : c.stopped ? 'save' : 'capture', discarded },
        audioRetryPending: false,
        audioRetryError: null,
      });
    c.reject(new Error(message));
  }
  async stop(match?: Match): Promise<void> {
    const c = this.current;
    if (!c) {
      this.generation++;
      if (this.state.phase === 'starting')
        this.update({ phase: 'idle', startedAt: null, sessionId: null });
      return;
    }
    if (match && match.sessionId === c.match.sessionId) c.match = structuredClone(match);
    if (!c.startedAt) {
      await this.abort();
      return;
    }
    if (!c.stopped) {
      this.cancelAudioRetry(c);
      c.stopped = true;
      this.update({ phase: 'stopping', audioRetryPending: false, audioRetryError: null });
      if (c.timer) clearTimeout(c.timer);
      c.timer = setTimeout(() => void this.failCapture(c, 'Saving the recording timed out'), 30000);
      c.win.webContents.send('ba:recording:stop', false);
    }
    await c.done;
  }
  private async discardCurrent(): Promise<void> {
    const c = this.current;
    if (c) {
      this.cancelAudioRetry(c);
      this.current = null;
      if (c.timer) clearTimeout(c.timer);
      if (!c.win.isDestroyed()) {
        c.win.webContents.send('ba:recording:stop', true);
        c.win.destroy();
      }
      c.writer.destroy();
      if (!c.writer.closed) await new Promise<void>((resolve) => c.writer.once('close', resolve));
      await unlink(c.part).catch(() => {});
      c.resolve();
    }
    this.update({
      phase: 'idle',
      sessionId: null,
      fid: null,
      map: '',
      sourceId: '',
      display: undefined,
      startedAt: null,
      seconds: 0,
      error: null,
      failure: null,
      audio: undefined,
      lastSavedName: undefined,
      hasAudio: false,
      audioRetryPending: false,
      audioRetryError: null,
    });
  }
  async abort(): Promise<void> {
    this.generation++;
    await this.discardCurrent();
  }
}
