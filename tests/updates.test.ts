import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult } from 'electron-updater';
import { UpdateController, type UpdateEngine } from '../apps/desktop/src/updates/controller';
import { readInstallRecord, writeInstallRecord } from '../apps/desktop/src/updates/install-record';

function result(available = true): UpdateCheckResult {
  const info = { version: '4.0.1', files: [], releaseDate: '2026-10-15', path: '', sha512: '' };
  return { isUpdateAvailable: available, updateInfo: info, versionInfo: info };
}
class Engine extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  channel: string | null = null;
  checkForUpdates = vi.fn<UpdateEngine['checkForUpdates']>(async () => result());
  downloadUpdate = vi.fn<UpdateEngine['downloadUpdate']>(async () => ['installer.exe']);
  quitAndInstall = vi.fn<UpdateEngine['quitAndInstall']>();
}
const controllers: UpdateController[] = [];
const directories: string[] = [];
function fixture(mode: 'installed' | 'portable' | 'disabled' = 'installed') {
  const engine = new Engine();
  const emit = vi.fn();
  const canInstall = vi.fn(() => true);
  const prepareInstall = vi.fn(async (_version: string) => {});
  const installFailed = vi.fn();
  const controller = new UpdateController({
    version: '4.0.0',
    mode,
    engine,
    emit,
    canInstall,
    prepareInstall,
    installFailed,
  });
  controllers.push(controller);
  return { engine, controller, emit, canInstall, prepareInstall, installFailed };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('desktop updates', () => {
  it('checks after 15 seconds and every four minutes, without downloading or installing', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.start();
    f.controller.start();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(f.engine.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.engine.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(f.controller.status().status).toBe('available');
    await vi.advanceTimersByTimeAsync(225_000);
    expect(f.engine.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(f.engine.autoDownload).toBe(false);
    expect(f.engine.autoInstallOnAppQuit).toBe(false);
    expect(f.engine.allowPrerelease).toBe(false);
    expect(f.engine.allowDowngrade).toBe(false);
    expect(f.engine.downloadUpdate).not.toHaveBeenCalled();
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
  });

  it('does no work in development, smoke or disabled builds', async () => {
    vi.useFakeTimers();
    const f = fixture('disabled');
    f.controller.start();
    await vi.advanceTimersByTimeAsync(300_000);
    await f.controller.check();
    await f.controller.download();
    f.controller.install();
    expect(f.controller.status().status).toBe('disabled');
    expect(f.engine.checkForUpdates).not.toHaveBeenCalled();
    expect(f.engine.downloadUpdate).not.toHaveBeenCalled();
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
  });

  it('checks portable versions but never downloads/runs an NSIS installer', async () => {
    const f = fixture('portable');
    await f.controller.check();
    expect(f.controller.status().availableVersion).toBe('4.0.1');
    await f.controller.download();
    f.controller.install();
    expect(f.engine.downloadUpdate).not.toHaveBeenCalled();
    expect(f.prepareInstall).not.toHaveBeenCalled();
  });

  it('serializes checks and downloads, clamps progress and keeps verified downloads ready across polls', async () => {
    const f = fixture();
    f.canInstall.mockReturnValue(false);
    const checking = deferred<UpdateCheckResult>();
    f.engine.checkForUpdates.mockReturnValueOnce(checking.promise);
    const first = f.controller.check();
    await f.controller.check();
    await f.controller.download();
    expect(f.engine.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(f.engine.downloadUpdate).not.toHaveBeenCalled();
    checking.resolve(result());
    await first;
    const download = deferred<string[]>();
    f.engine.downloadUpdate.mockReturnValueOnce(download.promise);
    const pending = f.controller.download();
    await f.controller.download();
    await f.controller.check();
    f.engine.emit('download-progress', { percent: 42.9 });
    expect(f.controller.status().downloadPercent).toBe(42);
    f.engine.emit('download-progress', { percent: Number.NaN });
    expect(f.controller.status().downloadPercent).toBe(42);
    f.engine.emit('download-progress', { percent: 120 });
    expect(f.controller.status().downloadPercent).toBe(100);
    download.resolve(['installer.exe']);
    await pending;
    await f.controller.check();
    expect(f.engine.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(f.engine.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(f.controller.status().status).toBe('downloaded');
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
  });

  it('recovers from network and download failures without installing partial files', async () => {
    const f = fixture();
    f.engine.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await f.controller.check();
    expect(f.controller.status()).toMatchObject({
      status: 'error',
      errorContext: 'check',
      error: 'offline',
    });
    await f.controller.check();
    f.engine.downloadUpdate.mockRejectedValueOnce(new Error('checksum mismatch'));
    await f.controller.download();
    f.controller.install();
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
    expect(f.controller.status()).toMatchObject({ status: 'error', errorContext: 'download' });
    await f.controller.download();
    expect(f.controller.status().status).toBe('installing');
  });

  it('clears an old offered version when a check reports no update', async () => {
    const f = fixture();
    await f.controller.check();
    f.engine.checkForUpdates.mockResolvedValueOnce(result(false));
    await f.controller.check();
    expect(f.controller.status()).toMatchObject({ status: 'idle', availableVersion: null });
  });

  it('returns the install RPC before shutdown, waits for cleanup, and installs exactly once', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.controller.check();
    await f.controller.download();
    const cleanup = deferred<void>();
    f.prepareInstall.mockReturnValueOnce(cleanup.promise);
    expect(f.controller.install().status).toBe('installing');
    f.controller.install();
    expect(f.prepareInstall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.prepareInstall).toHaveBeenCalledWith('4.0.1');
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
    cleanup.resolve();
    await Promise.resolve();
    expect(f.engine.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
  });

  it('blocks installation during a match/recording, including one starting just after the click', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.canInstall.mockReturnValue(false);
    await f.controller.check();
    await f.controller.download();
    expect(f.controller.install().status).toBe('downloaded');
    f.canInstall.mockReturnValue(true);
    f.controller.install();
    f.canInstall.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.status().status).toBe('downloaded');
    expect(f.prepareInstall).not.toHaveBeenCalled();
  });

  it('automatically installs a completed download after the download RPC settles', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.controller.check();
    expect((await f.controller.download()).status).toBe('installing');
    expect(f.prepareInstall).not.toHaveBeenCalled();
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.prepareInstall).toHaveBeenCalledExactlyOnceWith('4.0.1');
    expect(f.engine.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
  });

  it('automatically resumes installation when the match or recording ends, including startup races', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.canInstall.mockReturnValue(false);
    await f.controller.check();
    await f.controller.download();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.controller.status().status).toBe('downloaded');
    expect(f.prepareInstall).not.toHaveBeenCalled();
    f.canInstall.mockReturnValueOnce(true).mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(f.controller.status().status).toBe('downloaded');
    expect(f.prepareInstall).not.toHaveBeenCalled();
    f.canInstall.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(f.engine.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
  });

  it('cancels deferred automatic installation on disposal', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.canInstall.mockReturnValue(false);
    await f.controller.check();
    await f.controller.download();
    f.controller.dispose();
    f.canInstall.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.prepareInstall).not.toHaveBeenCalled();
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps the verified download retryable when preparation fails before closing services', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.controller.check();
    await f.controller.download();
    f.prepareInstall.mockRejectedValueOnce(new Error('disk full'));
    f.controller.install();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.status()).toMatchObject({ status: 'downloaded', errorContext: 'install' });
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
    f.controller.install();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.engine.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('handles asynchronous installer errors once and requests host recovery', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.controller.check();
    await f.controller.download();
    f.engine.quitAndInstall.mockImplementation(() => {
      f.engine.emit('error', new Error('Access denied'));
    });
    f.controller.install();
    await vi.advanceTimersByTimeAsync(0);
    f.engine.emit('error', new Error('Another error'));
    expect(f.installFailed).toHaveBeenCalledExactlyOnceWith('Access denied');
    expect(f.controller.status()).toMatchObject({ status: 'error', errorContext: 'install' });
  });

  it('stops timers, scheduled installs and late download events on disposal', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.controller.check();
    await f.controller.download();
    f.controller.install();
    f.controller.start();
    f.controller.dispose();
    f.emit.mockClear();
    f.engine.emit('download-progress', { percent: 12 });
    f.engine.emit('error', new Error('late error'));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.emit).not.toHaveBeenCalled();
    expect(f.prepareInstall).not.toHaveBeenCalled();
    expect(f.engine.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe('update install record', () => {
  it('detects an unapplied update across restarts and clears the record after the version changes', async () => {
    const dir = await mkdtemp(resolve('.test-data/update-'));
    directories.push(dir);
    const file = join(dir, 'install.json');
    expect(await readInstallRecord(file, '4.0.0')).toBeNull();
    await writeInstallRecord(file, '4.0.0', '4.0.1');
    expect(await readInstallRecord(file, '4.0.0')).toBe('4.0.1');
    expect(await readInstallRecord(file, '4.0.0')).toBe('4.0.1');
    expect(await readInstallRecord(file, '4.0.1')).toBeNull();
    expect(await readInstallRecord(file, '4.0.0')).toBeNull();
  });
});
