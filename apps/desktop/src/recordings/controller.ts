import { BrowserWindow, desktopCapturer, screen } from 'electron';
import { randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Display, Match, PublicConfig, RecorderConfig, RecordingState } from '@ba/contracts';
import { errorMessage } from '@ba/shared';
import { replayName } from '@ba/server';
import { patchDurationFile } from './webm';
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
    return sources.map((s) => {
      const d = displays.find((d) => String(d.id) === s.display_id);
      // Electron display bounds use device-independent pixels, not physical pixels.
      const width = d ? Math.round(d.bounds.width * d.scaleFactor) : 0;
      const height = d ? Math.round(d.bounds.height * d.scaleFactor) : 0;
      return {
        id: s.id,
        label: d ? `${d.label || 'Display'} · ${width}×${height}` : s.name,
        thumbnail: s.thumbnail.toDataURL(),
      };
    });
  }
  async thumbnail(id: string): Promise<string | null> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 640, height: 360 },
    });
    return (
      (
        sources.find((s) => s.id === id || s.display_id === id) || sources[0]
      )?.thumbnail.toDataURL() || null
    );
  }
  async start(match: Match, config: PublicConfig, test = false): Promise<void> {
    const generation = ++this.generation;
    if (this.current?.stopped) await this.current.done.catch(() => {});
    else await this.discardCurrent();
    if (generation !== this.generation) return;
    const token = randomUUID();
    this.update({
      phase: 'starting',
      sessionId: token,
      fid: match.fid,
      map: match.map,
      sourceId: '',
      startedAt: null,
      error: null,
      hasAudio: false,
    });
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
      });
      if (generation !== this.generation) return;
      const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const source =
        sources.find(
          (s) => s.id === config.replayDisplayId || s.display_id === config.replayDisplayId,
        ) ||
        sources.find((s) => s.display_id === String(cursor.id)) ||
        sources[0];
      if (!source) throw new Error('No display capture source');
      const dir = this.directory();
      await mkdir(dir, { recursive: true });
      if (generation !== this.generation) return;
      const part = join(dir, '.rec-part-' + token + '.webm');
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
        this.update({ phase: 'error', error: errorMessage(error), startedAt: null });
        if (this.current) await this.failCapture(this.current, errorMessage(error));
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
  ready(sender: number, token: string, hasAudio: boolean): void {
    const c = this.owner(sender, token);
    if (c.stopped) return;
    if (c.timer) clearTimeout(c.timer);
    c.timer = c.test ? setTimeout(() => void this.stop(), 60000) : null;
    c.startedAt = Date.now();
    c.hasAudio = hasAudio;
    this.update({
      phase: 'recording',
      sessionId: token,
      fid: c.match.fid,
      map: c.match.map,
      sourceId: c.config.sourceId,
      startedAt: c.startedAt,
      hasAudio,
    });
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
  preview(sender: number, token: string, dataUrl: string, hasAudio: boolean): void {
    const c = this.owner(sender, token);
    if (
      c.stopped ||
      this.state.phase !== 'recording' ||
      dataUrl.length > 300000 ||
      !dataUrl.startsWith('data:image/jpeg;base64,')
    )
      return;
    this.previewed(token, dataUrl, hasAudio);
  }
  async finish(sender: number, token: string, duration: number, hasAudio: boolean): Promise<void> {
    const c = this.owner(sender, token);
    if (!Number.isFinite(duration) || duration < 0 || duration > 86400)
      throw new Error('Invalid recording duration');
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
      await unlink(c.part);
      c.hasAudio = hasAudio;
      this.saved(name, duration, c.match);
      this.complete(c);
    } catch (error) {
      await this.failCapture(c, errorMessage(error));
      throw error;
    }
  }
  async failure(sender: number, token: string, message: string): Promise<void> {
    await this.failCapture(this.owner(sender, token), message.slice(0, 1000));
  }
  private complete(c: Capture): void {
    if (c.timer) clearTimeout(c.timer);
    if (this.current === c) {
      this.current = null;
      this.update({
        phase: 'idle',
        sessionId: null,
        fid: null,
        map: '',
        sourceId: '',
        startedAt: null,
        seconds: 0,
        error: null,
      });
    }
    if (!c.win.isDestroyed()) c.win.destroy();
    c.resolve();
  }
  private async failCapture(c: Capture, message: string): Promise<void> {
    if (this.current !== c) return;
    if (c.timer) clearTimeout(c.timer);
    this.current = null;
    c.writer.destroy();
    if (!c.win.isDestroyed()) c.win.destroy();
    await unlink(c.part).catch(() => {});
    await unlink(join(c.dir, '.rec-final-' + c.token + '.webm')).catch(() => {});
    this.update({ phase: 'error', error: message, startedAt: null, sessionId: null });
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
      c.stopped = true;
      this.update({ phase: 'stopping' });
      if (c.timer) clearTimeout(c.timer);
      c.timer = setTimeout(() => void this.failCapture(c, 'Saving the recording timed out'), 30000);
      c.win.webContents.send('ba:recording:stop', false);
    }
    await c.done;
  }
  private async discardCurrent(): Promise<void> {
    const c = this.current;
    if (c) {
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
      startedAt: null,
      seconds: 0,
      error: null,
    });
  }
  async abort(): Promise<void> {
    this.generation++;
    await this.discardCurrent();
  }
}
