import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, ApmState, RecordingState } from '@ba/contracts';
import type { Platform } from '../apps/server/src/ports';
import { InputCounter, type Hook } from '../apps/desktop/src/apm';

// Application keeps its real repositories and SQL behavior; only the DB location changes.
vi.mock('../apps/server/src/storage/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('../apps/server/src/storage/database')>();
  return {
    ...original,
    Database: class extends original.Database {
      constructor(_file: string) {
        super(':memory:');
      }
    },
  };
});
import { Application } from '../apps/server/src/app';
import { UpdateController, type UpdateEngine } from '../apps/desktop/src/updates/controller';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function platform(fetchImpl: typeof fetch): Platform {
  const apm: ApmState = {
    status: 'idle',
    totalActions: 0,
    durationSec: 0,
    apm: 0,
    peak: 0,
    perMinute: [],
    focused: false,
    fid: null,
  };
  const recording: RecordingState = {
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
  return {
    version: '4.0.0',
    http: { fetch: fetchImpl },
    selectDirectory: vi.fn(async () => null),
    detectLogDirectory: vi.fn(async () => ''),
    openPath: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    notify: vi.fn(),
    apm: { status: () => apm, start: vi.fn(), stop: vi.fn(), disable: vi.fn() },
    recordings: {
      status: () => recording,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      displays: vi.fn(async () => []),
      thumbnail: vi.fn(async () => null),
      playback: vi.fn(async () => 'ba-replay://fixture'),
    },
  };
}
const applications = new Set<Application>();
function application(value: Platform, events: AppEvent[] = [], network = false) {
  const app = new Application(
    'in-memory-lifecycle-fixture-' + randomUUID(),
    value,
    (event) => events.push(event),
    network,
  );
  applications.add(app);
  return app;
}
afterEach(async () => {
  await Promise.all([...applications].map((app) => app.stop()));
  applications.clear();
});

it('imports historical logs on startup and directory change without replacing the live session or running historical effects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ba-archive-lifecycle-'));
  const p = platform(vi.fn<typeof fetch>());
  const events: AppEvent[] = [];
  const app = application(p, events);
  const lines = (fid: string) =>
    `Log: Start loading battle... map: Dam, scenario: Test\nLog: FID:${fid}\nLog: GameController dispose called\n`;
  try {
    const logs = join(dir, 'logs');
    await mkdir(join(logs, 'history'), { recursive: true });
    await writeFile(join(logs, 'Gamelog__latest.log'), lines('101'));
    await writeFile(join(logs, 'history', 'old.txt'), lines('102'));
    app.db.updateConfig({ logDir: logs, replayEnabled: true, inputHookEnabled: true });
    await app.start();
    await app.invoke('matches.scan', null);
    expect(app.db.matches()).toHaveLength(2);
    expect(p.recordings.start).not.toHaveBeenCalled();
    expect(p.apm.start).not.toHaveBeenCalled();
    await app.watcher.poll();
    const session = app.parser.snapshot();
    const aborts = vi.mocked(p.recordings.abort).mock.calls.length;
    await appendFile(join(logs, 'history', 'old.txt'), lines('103'));
    await app.invoke('matches.scan', null);
    expect(app.db.matches()).toHaveLength(3);
    expect(app.parser.snapshot()).toEqual(session);
    expect(p.recordings.abort).toHaveBeenCalledTimes(aborts);
    expect(p.recordings.start).not.toHaveBeenCalled();
    expect(p.apm.start).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'matches')).toBe(true);
    const other = join(dir, 'other');
    await mkdir(other);
    await writeFile(join(other, 'old.log'), lines('104'));
    await app.invoke('config.update', { logDir: other });
    await app.invoke('matches.scan', null);
    expect(app.db.matches()).toHaveLength(4);
  } finally {
    await app.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

it('reports automatic archive scan failures and leaves manual scans available for retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ba-archive-error-'));
  const events: AppEvent[] = [];
  const app = application(platform(vi.fn<typeof fetch>()), events);
  try {
    const missing = join(dir, 'logs');
    app.db.updateConfig({ logDir: missing });
    await app.start();
    await vi.waitFor(() =>
      expect(
        events.some((event) => event.type === 'error' && event.message.includes(missing)),
      ).toBe(true),
    );
    await expect(app.invoke('matches.scan', null)).rejects.toThrow();
    await mkdir(missing);
    await expect(app.invoke('matches.scan', null)).resolves.toBeNull();
  } finally {
    await app.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

it('settles the update install RPC before draining application tasks and closing the database', async () => {
  const p = platform(vi.fn<typeof fetch>());
  const app = application(p);
  const info = { version: '4.0.1', files: [], path: '', sha512: '', releaseDate: '' };
  const engine = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    channel: 'latest',
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: info,
      versionInfo: info,
    })),
    downloadUpdate: vi.fn(async () => ['installer.exe']),
    quitAndInstall: vi.fn(),
  }) satisfies UpdateEngine;
  const controller = new UpdateController({
    version: p.version,
    mode: 'installed',
    engine,
    emit: (updates) => app.event({ type: 'updates', updates }),
    canInstall: () => true,
    prepareInstall: () => app.stop(),
    installFailed: vi.fn(),
  });
  p.updates = controller;
  try {
    await controller.check();
    await controller.download();
    expect((await app.invoke('updates.install', null)).status).toBe('installing');
    await vi.waitFor(() => expect(engine.quitAndInstall).toHaveBeenCalledWith(true, true));
    expect(p.recordings.stop).toHaveBeenCalled();
    await expect(app.invoke('app.bootstrap', null)).rejects.toThrow('Application closed');
  } finally {
    controller.dispose();
  }
});

class FakeHook extends EventEmitter implements Hook {
  start = vi.fn();
  stop = vi.fn();
}

describe('configuration updates', () => {
  it('does not reset other settings or stop recording and input when changing language', async () => {
    const p = platform(vi.fn<typeof fetch>());
    const events: AppEvent[] = [];
    const app = application(p, events);
    const before = app.db.updateConfig({
      logDir: 'custom-logs',
      decksDir: 'custom-decks',
      theme: 'forest',
      replayEnabled: true,
      inputHookEnabled: true,
      replaySaveDir: 'custom-recordings',
    });
    const watch = vi.spyOn(app.watcher, 'start');

    const config = await app.invoke('config.update', { lang: 'en' });

    expect(config).toEqual({ ...before, lang: 'en' });
    expect(app.snapshot().config).toEqual(config);
    expect(events).toContainEqual({ type: 'config', config, revision: 1 });
    expect(watch).not.toHaveBeenCalled();
    expect(p.recordings.stop).not.toHaveBeenCalled();
    expect(p.apm.disable).not.toHaveBeenCalled();
  });
});

describe('input-hook lifecycle', () => {
  it('counts one click after every enable/disable cycle and detaches every listener', () => {
    const hook = new FakeHook();
    const count = vi.fn();
    const counter = new InputCounter(hook, count);
    for (let cycle = 0; cycle < 3; cycle++) {
      counter.start();
      counter.start();
      expect(hook.listenerCount('mousedown')).toBe(1);
      hook.emit('mousedown', { button: 1 });
      expect(count).toHaveBeenCalledTimes(cycle + 1);
      counter.stop();
      expect(hook.listenerCount('mousedown')).toBe(0);
      expect(hook.listenerCount('keydown')).toBe(0);
      expect(hook.listenerCount('keyup')).toBe(0);
    }
    expect(hook.start).toHaveBeenCalledTimes(3);
    expect(hook.stop).toHaveBeenCalledTimes(3);
  });

  it('counts a held key once, then counts a fresh press after release', () => {
    const hook = new FakeHook();
    const count = vi.fn();
    const counter = new InputCounter(hook, count);
    counter.start();
    hook.emit('keydown', { keycode: 30 });
    hook.emit('keydown', { keycode: 30 });
    hook.emit('keydown', { keycode: 30 });
    expect(count).toHaveBeenCalledTimes(1);
    hook.emit('keyup', { keycode: 30 });
    hook.emit('keydown', { keycode: 30 });
    expect(count).toHaveBeenCalledTimes(2);
    counter.stop();
    counter.start();
    hook.emit('keydown', { keycode: 30 });
    expect(count).toHaveBeenCalledTimes(3);
    counter.stop();
  });

  it('cleans up listeners after a native start failure', () => {
    const hook = new FakeHook();
    hook.start.mockImplementationOnce(() => {
      throw new Error('Native start failed');
    });
    const counter = new InputCounter(hook, vi.fn());
    expect(() => counter.start()).toThrow('Native start failed');
    expect(hook.listenerCount('mousedown')).toBe(0);
    expect(hook.listenerCount('keydown')).toBe(0);
    counter.start();
    expect(hook.listenerCount('mousedown')).toBe(1);
    counter.stop();
  });
});

describe('application shutdown', () => {
  it('rejects new work and ignores live log starts while recording finalization is pending', async () => {
    const p = platform(
      vi.fn<typeof fetch>(async () => {
        throw new Error('No networking in this test');
      }),
    );
    const finalization = deferred<void>();
    const stopStarted = deferred<void>();
    p.recordings.stop = vi.fn(async () => {
      stopStarted.resolve();
      await finalization.promise;
    });
    const app = application(p);
    app.db.updateConfig({ replayEnabled: true, inputHookEnabled: true });
    const close = vi.spyOn(app.db, 'close');
    const stopping = app.stop();
    await stopStarted.promise;
    app.parser.feed([
      'Log: GetPersonaName Zola',
      'Log: Start loading battle... map: Dam, scenario: Test',
    ]);
    await expect(app.invoke('app.bootstrap', null)).rejects.toThrow('Application closed');
    expect(p.recordings.start).not.toHaveBeenCalled();
    expect(p.apm.start).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    finalization.resolve();
    await stopping;
    expect(close).toHaveBeenCalledTimes(1);
    await app.stop();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight RPC before closing SQL and never writes a late cache or snapshot', async () => {
    const started = deferred<void>();
    let signal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal;
      started.resolve();
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return reject(new Error('Missing abort signal'));
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    });
    const events: AppEvent[] = [];
    const app = application(platform(fetchImpl), events);
    const close = vi.spyOn(app.db, 'close');
    const cache = vi.spyOn(app.db, 'saveCache');
    const snapshot = vi.spyOn(app.db, 'saveSnapshot');
    const request = app.invoke('players.report', { id: '8863' });
    const rejected = expect(request).rejects.toThrow();
    await started.promise;
    await Promise.all([app.stop(), rejected]);
    expect(signal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(cache).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'error')).toEqual([]);
  });

  it('lets a cancelled foreground health probe settle before closing SQL', async () => {
    const started = deferred<void>();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      started.resolve();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error('Missing abort signal'));
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const app = application(platform(fetchImpl));
    const close = vi.spyOn(app.db, 'close');
    const write = vi.spyOn(app.db, 'setState');
    const probe = app.invoke('api.health', { force: true });
    const settled = probe.then(
      () => null,
      (error) => error,
    );
    await started.promise;
    await app.stop();
    const error: unknown = await settled;
    if (error instanceof Error) expect(error.message).not.toMatch(/closed|not open/i);
    const closedAt = close.mock.invocationCallOrder[0]!;
    expect(write.mock.invocationCallOrder.every((order) => order < closedAt)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('also drains the scheduled background health probe before closing SQL', async () => {
    vi.useFakeTimers();
    const started = deferred<void>();
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/players/search?q=test')) {
        started.resolve();
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return reject(new Error('Missing abort signal'));
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      if (url.includes('/api/leaderboard/ban')) return Response.json({ leaderboard: [] });
      return Response.json({ ok: true });
    });
    const app = application(platform(fetchImpl), [], true);
    const close = vi.spyOn(app.db, 'close');
    const write = vi.spyOn(app.db, 'setState');
    try {
      await app.start();
      await vi.advanceTimersByTimeAsync(3_600_000);
      await started.promise;
      await app.stop();
    } finally {
      vi.useRealTimers();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
    expect(
      fetchImpl.mock.calls.every(
        ([input]) => new URL(String(input)).hostname === 'app.batrace.top',
      ),
    ).toBe(true);
    const closedAt = close.mock.invocationCallOrder[0]!;
    expect(write.mock.invocationCallOrder.every((order) => order < closedAt)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
