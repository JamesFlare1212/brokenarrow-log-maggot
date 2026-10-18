import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, ApmState, RecordingState } from '@ba/contracts';
import type { Platform } from '../apps/server/src/ports';
import { initialApmState } from '@ba/contracts';
import { ApmController } from '../apps/desktop/src/apm';
import type { InputFrame } from '../apps/desktop/src/apm/windows-input';

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
  const apm: ApmState = initialApmState('idle');
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
    apm: {
      status: () => apm,
      start: vi.fn(),
      updateMatch: vi.fn(),
      stop: vi.fn(),
      disable: vi.fn(),
    },
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

describe('application telemetry', () => {
  it.each([true, false])(
    'captures startup failures before service start only with saved consent: %s',
    async (consent) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ status: 'Ok' }));
      const p = platform(fetchImpl);
      p.telemetry = { enabled: true, distribution: 'installed' };
      const app = application(p, [], true);
      app.db.updateConfig({
        telemetryEnabled: consent,
        telemetryConsentConfirmed: true,
        telemetryConsentVersion: 3,
      });
      app.reportError('startup', new TypeError('private startup detail'));
      const outbox = app.db.state<
        { payload: { event: string; properties: Record<string, unknown> } }[]
      >('telemetry:outbox:v1', []);
      expect(outbox.some((item) => item.payload.event === '$exception')).toBe(consent);
      if (consent) {
        expect(
          outbox.find((item) => item.payload.event === '$exception')?.payload.properties,
        ).toMatchObject({ source: 'startup', $exception_level: 'fatal' });
        expect(app.db.state<{ fatal?: boolean }>('telemetry:run:v1', {}).fatal).toBe(true);
      }
      expect(JSON.stringify(outbox)).not.toContain('private startup detail');
    },
  );

  it.each(['unsupported', 'disabled', 'offline', 'no-network'] as const)(
    'never sends telemetry in %s mode even with a saved opt-in',
    async (mode) => {
      vi.useFakeTimers();
      const fetchImpl = vi.fn<typeof fetch>();
      const p = platform(fetchImpl);
      if (mode !== 'unsupported')
        p.telemetry = { enabled: mode !== 'disabled', distribution: 'installed' };
      p.http.offline = mode === 'offline';
      const app = application(p, [], mode !== 'no-network');
      try {
        await app.invoke('config.update', { telemetryEnabled: true });
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('applies consent immediately and keeps raw RPC inputs and error messages private', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ status: 'Ok' }));
    const p = platform(fetchImpl);
    p.telemetry = { enabled: true, distribution: 'installed' };
    const app = application(p, [], true);
    try {
      await app.invoke('config.update', { telemetryEnabled: true, lang: 'ru' });
      await expect(
        app.invoke('replays.play', { name: 'private-player-recording.webm' }),
      ).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const bodies = fetchImpl.mock.calls.flatMap(([, init]) =>
        JSON.parse(String(init?.body)).batch.map((event: unknown) => JSON.stringify(event)),
      );
      expect(bodies[0]).toContain('"language":"ru"');
      expect(bodies[1]).toContain('"operation":"recording_play"');
      expect(bodies[1]).toContain('"result":"failure"');
      expect(bodies.join('')).not.toMatch(/private-player|\.webm|in-memory-lifecycle/);
      await app.invoke('config.update', { telemetryEnabled: false });
      await expect(
        app.invoke('replays.play', { name: 'private-player-recording.webm' }),
      ).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('probes health at startup and publishes recovery after ten minutes independently of hourly sync', async () => {
  vi.useFakeTimers();
  let available = false;
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    available ? Response.json({ ok: true }) : new Response('missing', { status: 404 }),
  );
  const events: AppEvent[] = [];
  const app = application(platform(fetchImpl), events, true);
  const requests = vi.spyOn(app.client, 'get').mockImplementation(async () => {
    if (!available) throw Object.assign(new Error('Unavailable'), { status: 404 });
    return { value: { ok: true }, source: 'network', at: Date.now() };
  });
  app.db.updateConfig({ banPollEnabled: false, matchSyncEnabled: false });
  app.db.setState('health', { state: 'ok', at: Date.now(), checks: [] });
  try {
    expect(app.snapshot().health.state).toBe('unknown');
    await app.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.snapshot().health.state).toBe('down');
    expect(events.some((event) => event.type === 'health' && event.health.state === 'down')).toBe(
      true,
    );
    available = true;
    await vi.advanceTimersByTimeAsync(55_000);
    expect(app.snapshot().health.state).toBe('down');
    expect(requests).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(539_999);
    expect(app.snapshot().health.state).toBe('down');
    expect(requests).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(app.snapshot().health.state).toBe('ok');
    expect(events.some((event) => event.type === 'health' && event.health.state === 'ok')).toBe(
      true,
    );
    expect(requests).toHaveBeenCalledTimes(12);
  } finally {
    await app.stop();
    vi.useRealTimers();
  }
});

it('publishes business request health changes without waiting for a scheduled probe', async () => {
  let available = false;
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    available ? Response.json({ players: [] }) : new Response('Forbidden', { status: 403 }),
  );
  const events: AppEvent[] = [];
  const app = application(platform(fetchImpl), events);
  await app.invoke('players.search', { query: 'first' });
  expect(app.snapshot().health.state).toBe('down');
  available = true;
  await app.invoke('players.search', { query: 'second' });
  expect(app.snapshot().health.state).toBe('ok');
  expect(
    events.filter((event) => event.type === 'health').map((event) => event.health.state),
  ).toEqual(['down', 'ok']);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
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

it('keeps the app open after downloading and settles the install RPC before closing the database', async () => {
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
    expect((await app.invoke('updates.download', null)).status).toBe('downloaded');
    expect(engine.quitAndInstall).not.toHaveBeenCalled();
    await expect(app.invoke('app.bootstrap', null)).resolves.toBeTruthy();
    expect((await app.invoke('updates.install', null)).status).toBe('installing');
    await vi.waitFor(() => expect(engine.quitAndInstall).toHaveBeenCalledWith(true, true));
    expect(p.recordings.stop).toHaveBeenCalled();
    await expect(app.invoke('app.bootstrap', null)).rejects.toThrow('Application closed');
  } finally {
    controller.dispose();
  }
});

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
        ([input, init]) =>
          new URL(String(input)).hostname === 'bot.batrace.top' &&
          new Headers(init?.headers).get('X-Client') === 'brokenarrow-log-maggot',
      ),
    ).toBe(true);
    const closedAt = close.mock.invocationCallOrder[0]!;
    expect(write.mock.invocationCallOrder.every((order) => order < closedAt)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

function measuredApm(finalization = Promise.resolve()) {
  let receive!: (frame: InputFrame) => void;
  const controller = new ApmController(
    () => ({
      start: (frame) => {
        receive = frame;
        frame({ type: 'ready', elapsedMs: 0, focusedMs: 0, focused: true, seconds: [] });
      },
      stop: async () => {
        await finalization;
        receive({
          type: 'stopped',
          elapsedMs: 2000,
          focusedMs: 2000,
          focused: true,
          seconds: [[1, 3]],
        });
      },
    }),
    () => 0,
    () => 1000000,
  );
  return controller;
}

describe('APM application lifecycle', () => {
  it('serializes rapid match events and saves the final aggregate with a late FID', async () => {
    const p = platform(vi.fn<typeof fetch>());
    p.apm = measuredApm();
    const events: AppEvent[] = [];
    const app = application(p, events);
    app.db.updateConfig({ inputHookEnabled: true });
    app.parser.feed([
      'Log: Start loading battle... map: Dam, scenario: Test',
      'Log: FID:123',
      'Log: GameController dispose called',
      'Log: [NET_ROOM] Connection closed. FightId=123 LiveTime: 300 sec',
    ]);
    await vi.waitFor(() => expect(p.apm.status().status).toBe('complete'));
    expect(await app.invoke('apm.history', null)).toEqual([
      expect.objectContaining({
        status: 'complete',
        fid: '123',
        totalActions: 3,
        durationSec: 2,
        partial: false,
        focused: false,
        matchDurationSec: 300,
      }),
    ]);
    expect(
      events.some(
        (event) =>
          event.type === 'apm' && event.apm.status === 'complete' && event.apm.fid === '123',
      ),
    ).toBe(true);
  });

  it('publishes and checkpoints interrupted capture on log reset', async () => {
    const p = platform(vi.fn<typeof fetch>());
    p.apm = measuredApm();
    const events: AppEvent[] = [];
    const app = application(p, events);
    app.db.updateConfig({ inputHookEnabled: true });
    app.parser.feed(['Log: Start loading battle... map: Dam, scenario: Test']);
    await vi.waitFor(() => expect(p.apm.status().status).toBe('active'));
    app.parser.reset();
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'apm' && event.apm.status === 'complete')).toBe(
        true,
      ),
    );
    expect(app.db.apmHistory()[0]).toMatchObject({
      partial: true,
      interrupted: true,
      totalActions: 3,
    });
  });

  it('keeps an active capture when recovery and match-start paths identify the same session', async () => {
    const p = platform(vi.fn<typeof fetch>());
    p.apm = measuredApm();
    const start = vi.spyOn(p.apm, 'start');
    const app = application(p);
    app.db.updateConfig({ inputHookEnabled: true });
    vi.spyOn(app.watcher, 'status').mockReturnValue({ ...app.watcher.status(), live: true });
    vi.spyOn(app.parser, 'isRecoveredMatch').mockReturnValue(true);
    app.parser.feed(['Log: Start loading battle... map: Dam, scenario: Test']);
    await vi.waitFor(() => expect(p.apm.status().status).toBe('active'));
    const id = p.apm.status().captureId;
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(start).toHaveBeenCalledOnce();
    expect(p.apm.status().captureId).toBe(id);
  });

  it('marks capture enabled mid-match as partial and saves it before disabling', async () => {
    const p = platform(vi.fn<typeof fetch>());
    p.apm = measuredApm();
    const app = application(p);
    vi.spyOn(app.watcher, 'status').mockReturnValue({ ...app.watcher.status(), live: true });
    app.parser.feed(['Log: Start loading battle... map: Dam, scenario: Test']);
    await app.invoke('config.update', { inputHookEnabled: true });
    expect(p.apm.status()).toMatchObject({ status: 'active', partial: true });
    await app.invoke('config.update', { inputHookEnabled: false });
    expect(p.apm.status().status).toBe('disabled');
    expect(app.db.apmHistory()[0]).toMatchObject({
      status: 'complete',
      partial: true,
      totalActions: 3,
    });
  });

  it('waits for the last native batch before closing SQLite on shutdown', async () => {
    const finalization = deferred<void>();
    const p = platform(vi.fn<typeof fetch>());
    p.apm = measuredApm(finalization.promise);
    const app = application(p);
    const close = vi.spyOn(app.db, 'close');
    app.db.updateConfig({ inputHookEnabled: true });
    app.parser.feed(['Log: Start loading battle... map: Dam, scenario: Test']);
    await vi.waitFor(() => expect(p.apm.status().status).toBe('active'));
    const stopping = app.stop();
    try {
      await Promise.resolve();
      expect(close).not.toHaveBeenCalled();
    } finally {
      finalization.resolve();
    }
    await stopping;
    expect(p.apm.status()).toMatchObject({ totalActions: 3, partial: true });
    expect(close).toHaveBeenCalledOnce();
  });
});
