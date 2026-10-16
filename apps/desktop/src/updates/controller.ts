import type { AppUpdater } from 'electron-updater';
import { initialUpdateState, type UpdateState } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export type UpdateEngine = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'allowPrerelease'
  | 'allowDowngrade'
  | 'channel'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
> & {
  on(event: 'download-progress' | 'error', listener: (value: unknown) => void): unknown;
  removeListener(event: 'download-progress' | 'error', listener: (value: unknown) => void): unknown;
};

interface UpdateOptions {
  version: string;
  mode: UpdateState['mode'];
  engine: UpdateEngine | null;
  emit(state: UpdateState): void;
  canInstall(): boolean;
  prepareInstall(targetVersion: string): Promise<void>;
  installFailed(error: string): void;
  now?: () => number;
  notAppliedVersion?: string | null;
}

// The same scheduler checks portable builds, but only installed builds may
// download/run an installer. No renderer-provided URLs or paths reach this layer.
export class UpdateController {
  private state: UpdateState;
  private action: 'check' | 'download' | 'install' | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private listeners: Array<['download-progress' | 'error', (value: unknown) => void]> = [];
  private disposed = false;
  private started = false;
  private prepared = false;
  private recoveryStarted = false;
  private installTimer: ReturnType<typeof setTimeout> | null = null;
  private autoInstallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: UpdateOptions) {
    this.state = initialUpdateState(options.version, options.mode);
    this.state.notAppliedVersion = options.notAppliedVersion ?? null;
    const engine = options.engine;
    if (!engine || options.mode === 'disabled') return;
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = false;
    engine.channel = 'latest';
    engine.allowPrerelease = false;
    // Setting channel also enables downgrades in electron-updater. Reset it.
    engine.allowDowngrade = false;
    this.listen('download-progress', (value) => {
      if (this.action !== 'download' || this.state.status !== 'downloading') return;
      const percent = (value as { percent?: unknown } | null)?.percent;
      if (typeof percent === 'number' && Number.isFinite(percent))
        this.set({ downloadPercent: Math.max(0, Math.min(100, Math.floor(percent))) });
    });
    this.listen('error', (error) => {
      if (this.action === 'install' && this.prepared) this.installFailure(error);
      // Check/download promises report their own failures. Always retain an
      // error listener: EventEmitter otherwise throws on asynchronous errors.
    });
  }

  status = (): UpdateState => ({ ...this.state });

  private set(patch: Partial<UpdateState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.options.emit(this.status());
  }

  private listen(event: 'download-progress' | 'error', listener: (value: unknown) => void): void {
    this.options.engine?.on(event, listener);
    this.listeners.push([event, listener]);
  }

  start(): void {
    if (this.started || this.disposed || this.state.mode === 'disabled') return;
    this.started = true;
    this.timers.push(setTimeout(() => void this.check(), 15_000));
    this.timers.push(setInterval(() => void this.check(), 4 * 60_000));
  }

  async check(): Promise<UpdateState> {
    const engine = this.options.engine;
    // Keep an already verified download installable; polling must not replace
    // the updater's selected version while it is waiting to be installed.
    if (
      !engine ||
      this.disposed ||
      this.state.mode === 'disabled' ||
      this.action ||
      this.state.status === 'downloaded'
    )
      return this.status();
    this.action = 'check';
    const previous = this.status();
    this.set({ status: 'checking', error: null, errorContext: null });
    try {
      const result = await engine.checkForUpdates();
      if (!result) throw new Error('Update check did not return a result');
      this.set({
        status: result.isUpdateAvailable ? 'available' : 'idle',
        availableVersion: result.isUpdateAvailable ? result.updateInfo.version : null,
        downloadPercent: null,
        checkedAt: (this.options.now ?? Date.now)(),
      });
    } catch (error) {
      this.set({
        ...previous,
        status: 'error',
        error: errorMessage(error),
        errorContext: 'check',
        checkedAt: (this.options.now ?? Date.now)(),
      });
    } finally {
      this.action = null;
    }
    return this.status();
  }

  async download(): Promise<UpdateState> {
    const engine = this.options.engine;
    if (
      !engine ||
      this.disposed ||
      this.state.mode !== 'installed' ||
      this.action ||
      !(
        this.state.status === 'available' ||
        (this.state.status === 'error' && this.state.errorContext === 'download')
      )
    )
      return this.status();
    this.action = 'download';
    this.set({ status: 'downloading', downloadPercent: 0, error: null, errorContext: null });
    try {
      const files = await engine.downloadUpdate();
      if (!files.length) throw new Error('Update download did not produce an installer');
      this.set({ status: 'downloaded', downloadPercent: 100 });
    } catch (error) {
      this.set({
        status: 'error',
        error: errorMessage(error),
        errorContext: 'download',
        downloadPercent: null,
      });
    } finally {
      this.action = null;
    }
    if (this.status().status === 'downloaded') this.autoInstall();
    return this.status();
  }

  private autoInstall(): void {
    if (this.disposed || this.state.status !== 'downloaded' || this.state.error) return;
    this.install();
    if (this.state.status === 'downloaded' && !this.autoInstallTimer) {
      this.autoInstallTimer = setTimeout(() => {
        this.autoInstallTimer = null;
        this.autoInstall();
      }, 1_000);
    }
  }

  install = (): UpdateState => {
    if (
      this.disposed ||
      this.state.mode !== 'installed' ||
      this.action ||
      this.state.status !== 'downloaded' ||
      !this.options.canInstall()
    )
      return this.status();
    this.action = 'install';
    this.set({ status: 'installing', error: null, errorContext: null });
    // Return the RPC first. Application.stop() waits for in-flight RPCs, so
    // awaiting shutdown from inside the install RPC would deadlock itself.
    this.installTimer = setTimeout(() => {
      this.installTimer = null;
      void this.applyInstall();
    }, 0);
    return this.status();
  };

  private async applyInstall(): Promise<void> {
    try {
      // A match/recording can start between the click and this scheduled turn.
      if (!this.options.canInstall()) {
        this.action = null;
        this.set({ status: 'downloaded' });
        this.autoInstall();
        return;
      }
      await this.options.prepareInstall(this.state.availableVersion!);
      if (this.disposed) return;
      this.prepared = true;
      this.options.engine!.quitAndInstall(true, true);
    } catch (error) {
      this.installFailure(error);
    }
  }

  private installFailure(error: unknown): void {
    if (this.recoveryStarted || this.disposed) return;
    this.recoveryStarted = true;
    this.set({
      status: this.prepared ? 'error' : 'downloaded',
      error: errorMessage(error),
      errorContext: 'install',
    });
    // The service may already be closed. The host relaunches a fresh instance
    // instead of leaving a window backed by a disposed database.
    this.options.installFailed(errorMessage(error));
    if (!this.prepared) {
      this.recoveryStarted = false;
      this.action = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    if (this.installTimer) clearTimeout(this.installTimer);
    if (this.autoInstallTimer) clearTimeout(this.autoInstallTimer);
    for (const [event, listener] of this.listeners)
      this.options.engine?.removeListener(event, listener);
    // A download being torn down may still emit an error before process exit.
    this.options.engine?.on('error', () => {});
    this.timers = [];
    this.listeners = [];
  }
}
