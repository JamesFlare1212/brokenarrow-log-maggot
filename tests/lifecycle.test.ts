import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, RecordingState, PlayerReport } from '@ba/contracts';
import { rpcSchemas } from '@ba/contracts';
import type { Platform } from '../apps/server/src/ports';

vi.mock('../apps/server/src/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../apps/server/src/config')>();
  return {
    ...original,
    projectConfig: {
      ...original.projectConfig,
      network: { ...original.projectConfig.network, requestOffsetMs: 0 },
    },
  };
});

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
import { emptyMatch, emptyPlayer } from '@ba/shared';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function platform(fetchImpl: typeof fetch): Platform {
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
    recordings: {
      status: () => recording,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      displays: vi.fn(async () => []),
      thumbnail: vi.fn(async () => null),
      displayPreview: async (id) => ({
        requestedId: id,
        sourceId: null,
        label: null,
        selection: 'unavailable',
        thumbnail: null,
        displays: [],
      }),
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

describe('local match detail references', () => {
  const localMatch = (id: string) => ({
    ...emptyMatch(id, 1000),
    map: 'Dam',
    localPlayerId: '111',
    localPersona: 'First account',
    winnerTeamId: 0 as const,
    mode: 'ranked' as const,
    players: [
      { ...emptyPlayer('111', 'First account'), teamId: 0 as const },
      { ...emptyPlayer('222', 'Second account'), teamId: 1 as const },
    ],
  });
  for (const prefix of ['local', 'legacy']) {
    it.each([false, true])(
      `reads ${prefix} detail without network, writes or events (force=%s)`,
      async (force) => {
        const fetcher = vi.fn<typeof fetch>(),
          events: AppEvent[] = [];
        const app = application(platform(fetcher), events);
        const id = `${prefix}:stored-session`;
        app.db.saveMatch({
          ...localMatch(id),
          warning: 'Old imported network warning',
          warningCode: 'batrace-cache',
        });
        const before = app.db.match(id),
          version = app.db.historyVersion(id);
        const save = vi.spyOn(app.db, 'saveMatch'),
          remote = vi.spyOn(app.client, 'match');
        const value = await app.invoke('matches.detail', { fid: id, force, accountId: null });
        expect(value).toMatchObject({ id, fid: null, map: 'Dam', localPlayerId: '111' });
        expect(value.players.map((player) => player.id)).toEqual(['111', '222']);
        expect(value.warning).toBeUndefined();
        expect(value.warningCode).toBeUndefined();
        expect(app.db.match(id)).toEqual(before);
        expect(app.db.historyVersion(id)).toBe(version);
        expect(save).not.toHaveBeenCalled();
        expect(remote).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
        expect(events).toEqual([]);
      },
    );
    it(`projects the selected account without changing the saved ${prefix} perspective`, async () => {
      const fetcher = vi.fn<typeof fetch>(),
        app = application(platform(fetcher));
      const id = `${prefix}:perspective`;
      app.db.saveMatch(localMatch(id));
      const before = app.db.match(id);
      expect(
        await app.invoke('matches.detail', { fid: id, force: true, accountId: '222' }),
      ).toMatchObject({
        localPlayerId: '222',
        localPersona: 'Second account',
        outcome: 'loss',
      });
      await expect(app.invoke('matches.detail', { fid: id, accountId: '999' })).rejects.toThrow(
        'MATCH_PERSPECTIVE_UNAVAILABLE',
      );
      expect(app.db.match(id)).toEqual(before);
      expect(fetcher).not.toHaveBeenCalled();
    });
    it(`reports missing ${prefix} records and recovers after storage is restored`, async () => {
      const fetcher = vi.fn<typeof fetch>(),
        events: AppEvent[] = [],
        app = application(platform(fetcher), events);
      const id = `${prefix}:restored`;
      await expect(app.invoke('matches.detail', { fid: id })).rejects.toThrow(
        'LOCAL_MATCH_UNAVAILABLE',
      );
      app.db.saveMatch(localMatch(id));
      expect((await app.invoke('matches.detail', { fid: id })).map).toBe('Dam');
      app.db.deleteMatch(id);
      await expect(app.invoke('matches.detail', { fid: id, force: true })).rejects.toThrow(
        'LOCAL_MATCH_UNAVAILABLE',
      );
      expect(fetcher).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });
  }
  it('reads a stored local key without using its separately known online ID', async () => {
    const fetcher = vi.fn<typeof fetch>(),
      app = application(platform(fetcher));
    const id = 'local:linked-online-id';
    app.db.saveMatch({ ...localMatch(id), fid: '91001' });
    expect(await app.invoke('matches.detail', { fid: id, force: true })).toMatchObject({
      id,
      fid: '91001',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([false, true])('preserves the numeric online query path (force=%s)', async (force) => {
    const fetcher = vi.fn<typeof fetch>(),
      app = application(platform(fetcher));
    const remote = vi
      .spyOn(app.client, 'match')
      .mockRejectedValue(new Error('Controlled online failure'));
    await expect(app.invoke('matches.detail', { fid: '91001', force })).rejects.toThrow(
      'Controlled online failure',
    );
    expect(remote).toHaveBeenCalledExactlyOnceWith('91001', force);
  });
  it.each([
    '',
    'arbitrary',
    'local:',
    'legacy:',
    'local:bad\nid',
    'legacy:bad\u0000id',
    'local:' + 'x'.repeat(123),
    '1'.repeat(33),
    '../outside',
    '1e2',
    'https://example.invalid',
    '123\n',
    '123\r',
    'local:bad\n',
    'legacy:bad\r',
    'local:bad\u2028',
    'local:bad\u0085',
  ])('rejects malformed detail reference %j before any online request', async (fid) => {
    const fetcher = vi.fn<typeof fetch>(),
      app = application(platform(fetcher));
    const remote = vi.spyOn(app.client, 'match');
    expect(rpcSchemas['matches.detail'].safeParse({ fid }).success).toBe(false);
    await expect(app.invoke('matches.detail', { fid })).rejects.toThrow();
    expect(remote).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps online-only operations and account identifiers numeric', async () => {
    const fetcher = vi.fn<typeof fetch>(),
      app = application(platform(fetcher));
    await expect(app.invoke('matches.add', { fid: 'local:session' })).rejects.toThrow();
    await expect(
      app.invoke('matches.detail', { fid: 'local:session', accountId: 'local:account' }),
    ).rejects.toThrow();
    await expect(app.invoke('players.profile', { id: 'legacy:player' })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('saved configuration confirmation', () => {
  it.each([false, true])(
    'publishes a versioned read without rewriting consent=%s',
    async (enabled) => {
      const fetcher = vi.fn<typeof fetch>();
      const value = platform(fetcher);
      const events: AppEvent[] = [];
      const app = application(value, events);
      app.db.updateConfig({ analyticsEnabled: enabled, analyticsChoiceSaved: true });
      const before = app.db.config();
      const write = vi.spyOn(app.db, 'updateConfig');
      const first = await app.invoke('config.read', null);
      const second = await app.invoke('config.read', null);
      expect(first.config).toEqual(before);
      expect(second.config).toEqual(before);
      expect(second.revision).toBeGreaterThan(first.revision);
      expect(events.filter((event) => event.type === 'config')).toEqual([
        { type: 'config', config: before, revision: first.revision },
        { type: 'config', config: before, revision: second.revision },
      ]);
      expect(write).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(value.recordings.start).not.toHaveBeenCalled();
      expect(app.db.config()).toEqual(before);
    },
  );
});

describe('ban alert snapshots and acknowledgement', () => {
  it('includes already published notifications in an equally current bootstrap snapshot', async () => {
    const events: AppEvent[] = [];
    const app = application(platform(vi.fn()), events);
    app.db.observe([{ id: '123', name: 'Observed player' }], 1);
    const newly = app.db.saveBans([
      {
        id: '123',
        name: 'Observed player',
        steamId: '',
        rating: 2000,
        firstSeenAt: 1,
        lastSeenAt: 2,
        encountered: true,
      },
    ]);
    app.event({ type: 'bans', list: app.db.bans(), newly, alerts: app.db.banAlerts() });
    const snapshot = await app.invoke('app.bootstrap', null);
    expect(snapshot.revision).toBe(events.at(-1)!.revision);
    expect(snapshot.banAlerts).toEqual(app.db.banAlerts());
    expect(snapshot.banAlerts[0]!.players[0]!.id).toBe('123');
  });
  it('publishes an authoritative inbox after an idempotent exact-batch acknowledgement', async () => {
    const events: AppEvent[] = [];
    const app = application(platform(vi.fn()), events);
    app.db.observe(
      [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ],
      1,
    );
    for (const id of ['1', '2'])
      app.db.saveBans([
        {
          id,
          name: id,
          steamId: '',
          rating: 2000,
          firstSeenAt: 1,
          lastSeenAt: 2,
          encountered: true,
        },
      ]);
    const [first, second] = app.db.banAlerts();
    await app.invoke('bans.acknowledgeAlerts', { ids: [first!.id] });
    await app.invoke('bans.acknowledgeAlerts', { ids: [first!.id] });
    expect(events.at(-1)).toMatchObject({ type: 'banAlerts', alerts: [second] });
    expect(app.snapshot().banAlerts).toEqual([second]);
    expect(app.db.bans()).toHaveLength(2);
  });
});

describe('concurrent room queries', () => {
  const players = [
    { id: '1', name: 'First player', teamId: 0 as const },
    { id: '2', name: 'Second player', teamId: 1 as const },
    { id: '3', name: 'Cached player', teamId: 1 as const },
  ];
  const analysis = { matchCount: 1, trend: { points: [] }, mapPerformance: [] };

  it('starts independent lookups together and publishes cached and faster players first', async () => {
    const first = deferred<Response>(),
      second = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>((url) =>
      String(url).includes('stbid=1') ? first.promise : second.promise,
    );
    const events: AppEvent[] = [];
    const app = application(platform(fetchImpl), events);
    app.db.saveCache('analysis:3', analysis, 21600000);
    const request = app.invoke('session.query', {
      context: 'previous',
      requestId: randomUUID(),
      players: [...players, players[1]!, { id: '4', name: '[Bot]', teamId: 0 }],
    });
    const roster = () => events.filter((event) => event.type === 'roster');
    try {
      await vi.waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(roster().map((event) => event.player.id)).toEqual(['3']);
      });
      expect(events[0]).toMatchObject({ type: 'rosterQuery', pendingIds: ['1', '2', '3'] });
      expect(app.snapshot().rosters?.previous.pendingIds).toEqual(['1', '2']);
      expect(Object.keys(app.snapshot().rosters!.previous.rows)).toEqual(['3']);
      second.resolve(Response.json(analysis));
      await vi.waitFor(() => expect(roster().map((event) => event.player.id)).toEqual(['3', '2']));
      first.resolve(Response.json(analysis));
      expect(await request).toMatchObject({ queried: 3, skipped: 2, cancelled: false });
      expect(roster().map((event) => event.player.id)).toEqual(['3', '2', '1']);
      expect(app.snapshot().rosters?.previous.pendingIds).toEqual([]);
    } finally {
      first.resolve(Response.json(analysis));
      second.resolve(Response.json(analysis));
      await request;
    }
  });

  it('publishes one player failure without blocking another pending player', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('stbid=2')
        ? pending.promise
        : new Response('Forbidden', { status: 403 }),
    );
    const events: AppEvent[] = [];
    const app = application(platform(fetchImpl), events);
    const request = app.invoke('session.query', {
      context: 'previous',
      requestId: randomUUID(),
      players: players.slice(0, 2),
    });
    try {
      await vi.waitFor(() =>
        expect(events.find((event) => event.type === 'roster')).toMatchObject({
          player: { id: '1' },
          info: null,
          error: expect.stringContaining('403'),
        }),
      );
      pending.resolve(Response.json(analysis));
      expect(await request).toMatchObject({ queried: 1, cancelled: false });
      expect(events.filter((event) => event.type === 'roster')).toHaveLength(2);
    } finally {
      pending.resolve(Response.json(analysis));
      await request;
    }
  });

  it('shares pending lookups with a replacement query and suppresses the old results', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(async () => (await pending.promise).clone());
    const events: AppEvent[] = [];
    const app = application(platform(fetchImpl), events);
    const oldId = randomUUID(),
      nextId = randomUUID();
    const previous = app.invoke('session.query', {
      context: 'previous',
      requestId: oldId,
      players: players.slice(0, 2),
    });
    try {
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      const next = app.invoke('session.query', {
        context: 'previous',
        requestId: nextId,
        players: players.slice(0, 2),
      });
      pending.resolve(Response.json(analysis));
      const results = await Promise.all([previous, next]);
      expect(results[0]).toMatchObject({ queried: 0, cancelled: true });
      expect(results[1]).toMatchObject({ queried: 2, cancelled: false });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const roster = events.filter((event) => event.type === 'roster');
      expect(roster).toHaveLength(2);
      expect(roster.every((event) => event.requestId === nextId)).toBe(true);
    } finally {
      pending.resolve(Response.json(analysis));
      await previous;
    }
  });

  it('suppresses concurrent current-room results after the session generation changes', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(async () => (await pending.promise).clone());
    const events: AppEvent[] = [];
    const app = application(platform(fetchImpl), events);
    app.parser.feed([
      'Log: Start loading battle... map: Dam, scenario: Test',
      'Log: Room: (GameRoom|123), Client: (First player|1)',
      'Log: Room: (GameRoom|123), Client: (Second player|2)',
    ]);
    const request = app.invoke('session.query', { context: 'current', requestId: randomUUID() });
    try {
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      app.parser.reset();
      pending.resolve(Response.json(analysis));
      expect(await request).toMatchObject({ queried: 0, cancelled: true });
      expect(events.filter((event) => event.type === 'roster')).toEqual([]);
    } finally {
      pending.resolve(Response.json(analysis));
      await request;
    }
  });
});

describe('bounded automatic room retry', () => {
  async function fixture() {
    const events: AppEvent[] = [];
    const app = application(
      platform(
        vi.fn(async () =>
          Response.json({ matchCount: 1, trend: { points: [] }, mapPerformance: [] }),
        ),
      ),
      events,
    );
    const template = await app.invoke('players.report', { id: '2' });
    const control = { available: false };
    const analyzer = Reflect.get(app, 'analyzer') as { report(id: string): Promise<PlayerReport> };
    const report = vi.spyOn(analyzer, 'report').mockImplementation(async (id) => {
      if (id === '1' && !control.available) throw new Error('Transient room failure');
      return { ...template, id, elo: id === '1' ? 2200 : 1800 };
    });
    Reflect.set(app, 'network', true);
    const watcher = vi.spyOn(app.watcher, 'status').mockReturnValue({
      ...app.watcher.status(),
      live: true,
      error: null,
      checking: false,
      recovering: false,
    });
    app.db.updateConfig({ autoQueryCurrentMatch: true });
    const start = () =>
      app.parser.feed([
        'Log: [LOBBY] Enter to lobby (id: 1776). Status Pending',
        'Log: Incoming client First:1 to lobby (id: 1776)',
        'Log: Incoming client Second:2 to lobby (id: 1776)',
      ]);
    return { app, events, report, control, watcher, start };
  }
  it('retries only the failed player once after five seconds and retains successful rows', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    try {
      f.start();
      await vi.advanceTimersByTimeAsync(250);
      const initial = f.app.snapshot().rosters!.current;
      expect(initial.rows['1']?.error).toBe('Transient room failure');
      expect(initial.rows['2']?.info?.elo).toBe(1800);
      expect(initial.retryAt).toBe(Date.now() + 5000);
      f.control.available = true;
      await vi.advanceTimersByTimeAsync(4999);
      expect(f.report.mock.calls.map(([id]) => id)).toEqual(['1', '2']);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.report.mock.calls.map(([id]) => id)).toEqual(['1', '2', '1']);
      expect(f.app.snapshot().rosters!.current).toMatchObject({
        retryAt: null,
        pendingIds: [],
        rows: { '1': { error: null, info: { elo: 2200 } }, '2': { info: { elo: 1800 } } },
      });
      await vi.advanceTimersByTimeAsync(20000);
      expect(f.report).toHaveBeenCalledTimes(3);
    } finally {
      await f.app.stop();
      vi.useRealTimers();
    }
  });
  it('stops after a second failure even when unchanged room events keep arriving', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    try {
      f.start();
      await vi.advanceTimersByTimeAsync(5250);
      expect(f.report.mock.calls.filter(([id]) => id === '1')).toHaveLength(2);
      expect(f.app.snapshot().rosters!.current.retryAt).toBeNull();
      for (let n = 0; n < 3; n++) {
        f.app.parser.feed(['Log: Incoming client First:1 to lobby (id: 1776)']);
        await vi.advanceTimersByTimeAsync(10000);
      }
      expect(f.report.mock.calls.filter(([id]) => id === '1')).toHaveLength(2);
    } finally {
      await f.app.stop();
      vi.useRealTimers();
    }
  });
  it('lets manual current-room refresh cancel the pending automatic retry', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    try {
      f.start();
      await vi.advanceTimersByTimeAsync(250);
      f.control.available = true;
      await f.app.invoke('session.query', { context: 'current', requestId: randomUUID() });
      expect(f.app.snapshot().rosters!.current.retryAt).toBeNull();
      await vi.advanceTimersByTimeAsync(10000);
      expect(f.report.mock.calls.filter(([id]) => id === '1')).toHaveLength(2);
      expect(f.report.mock.calls.filter(([id]) => id === '2')).toHaveLength(2);
    } finally {
      await f.app.stop();
      vi.useRealTimers();
    }
  });
  for (const cancellation of ['room', 'reset', 'preference', 'watcher', 'shutdown'] as const) {
    it(`cancels a pending retry on ${cancellation}`, async () => {
      const f = await fixture();
      vi.useFakeTimers();
      try {
        f.start();
        await vi.advanceTimersByTimeAsync(250);
        if (cancellation === 'room')
          f.app.parser.feed(['Log: [LOBBY] Enter to lobby (id: 99). Status Pending']);
        if (cancellation === 'reset') f.app.parser.reset();
        if (cancellation === 'preference')
          await f.app.invoke('config.update', { autoQueryCurrentMatch: false });
        if (cancellation === 'watcher') {
          const watcher = { ...f.app.watcher.status(), live: false, error: 'Log unavailable' };
          f.watcher.mockReturnValue(watcher);
          f.app.event({ type: 'watcher', watcher });
        }
        if (cancellation === 'shutdown') await f.app.stop();
        await vi.advanceTimersByTimeAsync(10000);
        expect(f.report).toHaveBeenCalledTimes(2);
        if (cancellation !== 'shutdown')
          expect(f.app.snapshot().rosters!.current.retryAt).toBeNull();
      } finally {
        await f.app.stop();
        vi.useRealTimers();
      }
    });
  }
  it('keeps the current-room retry independent of a previous-match query', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    try {
      f.start();
      await vi.advanceTimersByTimeAsync(250);
      f.control.available = true;
      await f.app.invoke('session.query', {
        context: 'previous',
        requestId: randomUUID(),
        players: [{ id: '1', name: 'First', teamId: 0 }],
        fid: '10',
      });
      expect(f.app.snapshot().rosters!.current.retryAt).not.toBeNull();
      await vi.advanceTimersByTimeAsync(5000);
      expect(f.report.mock.calls.filter(([id]) => id === '1')).toHaveLength(3);
      expect(f.app.snapshot().rosters!.current.rows['1']?.info?.elo).toBe(2200);
    } finally {
      await f.app.stop();
      vi.useRealTimers();
    }
  });
  it('does not schedule an automatic retry after its initial query was superseded manually', async () => {
    const f = await fixture();
    const pending = deferred<PlayerReport>();
    f.report.mockImplementationOnce(() => pending.promise);
    vi.useFakeTimers();
    try {
      f.start();
      await vi.advanceTimersByTimeAsync(250);
      f.control.available = true;
      await f.app.invoke('session.query', { context: 'current', requestId: randomUUID() });
      pending.reject(new Error('Superseded automatic failure'));
      await vi.advanceTimersByTimeAsync(10000);
      expect(f.app.snapshot().rosters!.current.retryAt).toBeNull();
      expect(
        f.events.filter((event) => event.type === 'rosterRetry' && event.retryAt !== null),
      ).toHaveLength(0);
    } finally {
      pending.resolve({} as PlayerReport);
      await f.app.stop();
      vi.useRealTimers();
    }
  });
});

describe('current roster identity', () => {
  it('publishes start and completion state for a parser-triggered automatic query', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ matchCount: 1, trend: { points: [] }, mapPerformance: [] }),
    );
    const events: AppEvent[] = [];
    const app = application(platform(fetchImpl), events);
    Reflect.set(app, 'network', true);
    vi.spyOn(app.watcher, 'status').mockReturnValue({
      ...app.watcher.status(),
      live: true,
      error: null,
      checking: false,
    });
    app.db.updateConfig({ autoQueryCurrentMatch: true });
    app.parser.feed([
      'Log: [LOBBY] Enter to lobby (id: 1776). Status Pending',
      'Log: Incoming client First:1 to lobby (id: 1776)',
    ]);
    await vi.waitFor(() =>
      expect(events.filter((event) => event.type === 'roster')).toHaveLength(1),
    );
    const starts = events.filter((event) => event.type === 'rosterQuery');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ context: 'current', pendingIds: ['1'] });
    expect(app.snapshot().rosters?.current).toMatchObject({
      requestId: starts[0]!.requestId,
      sourceKey: starts[0]!.sourceKey,
      pendingIds: [],
    });
    expect(app.snapshot().rosters?.current.rows['1']?.info).toBeTruthy();
  });
  it('cancels late results when membership changes within one generation', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(async () => (await pending.promise).clone());
    const events: AppEvent[] = [];
    const app = application(platform(fetchImpl), events);
    app.parser.feed([
      'Log: Start loading battle... map: Dam, scenario: Test',
      'Log: Room: (GameRoom|123), Client: (First player|1)',
      'Log: Room: (GameRoom|123), Client: (Second player|2)',
    ]);
    const generation = app.parser.snapshot().generation;
    const request = app.invoke('session.query', { context: 'current', requestId: randomUUID() });
    try {
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      expect(app.snapshot().rosters?.current.pendingIds).toHaveLength(2);
      app.parser.feed(['Log: Room: (GameRoom|123), Client: (Third player|3)']);
      expect(app.parser.snapshot().generation).toBe(generation);
      expect(app.snapshot().rosters?.current.pendingIds).toEqual([]);
      pending.resolve(Response.json({ matchCount: 1, trend: { points: [] }, mapPerformance: [] }));
      expect(await request).toMatchObject({ queried: 0, cancelled: true });
      expect(events.filter((event) => event.type === 'roster')).toEqual([]);
    } finally {
      pending.resolve(Response.json({}));
      await request;
    }
  });
});

describe('application cache management', () => {
  it('exposes cache usage and cleanup through validated native RPCs without network requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const app = application(platform(fetchImpl));
    app.db.saveCache('info:1', { name: 'Old' }, 1, Date.now() - 1000);
    app.db.saveCache('info:2', { name: 'Fresh' }, 21600000);
    expect((await app.invoke('cache.stats', null)).api).toMatchObject({ entries: 2, expired: 1 });
    const expired = await app.invoke('cache.clear', { mode: 'expired' });
    expect(expired.removed).toBe(1);
    expect(expired.stats.api).toMatchObject({ entries: 1, expired: 0 });
    await expect(app.invoke('cache.clear', {})).rejects.toThrow();
    expect((await app.invoke('cache.clear', { mode: 'all' })).removed).toBe(1);
    expect((await app.invoke('cache.stats', null)).api.bytes).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('application analytics', () => {
  it('counts live match starts while excluding recovered logs, metadata, and repeated room notifications', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({}));
    const p = platform(fetchImpl);
    p.analytics = { enabled: true, distribution: 'installed' };
    const app = application(p, [], true);
    try {
      await app.invoke('config.update', { analyticsEnabled: true });
      const start = 'Log: Start loading battle... map: Dam, scenario: Test';
      app.parser.reset('private-game.log');
      app.parser.feed([start, 'Log: GameController dispose called'], true);
      app.parser.recovered();
      app.parser.feed([
        start,
        'Log: [NET_ROOM] GameRoom entered, fight id: 9227650',
        'Log: [NET_ROOM] GameRoom entered, fight id: 9227650',
        'Log: FID:9227650',
      ]);
      app.parser.feed(['Log: TOTAL POINTS: 100', 'Log: GameController dispose called']);
      app.parser.feed([
        'Log: Room entered - GameRoom, fight id: 9227651',
        start,
        'Log: [NET_ROOM] GameRoom entered, fight id: 9227651',
      ]);
      await vi.advanceTimersByTimeAsync(1000);
      const matches = fetchImpl.mock.calls
        .flatMap(([, init]) => JSON.parse(String(init?.body)))
        .filter((event) => event.eventName === 'match_started');
      expect(matches).toHaveLength(2);
      expect(JSON.stringify(matches)).not.toMatch(/private-game|9227650|9227651|Dam|Test/);
      app.parser.reset('private-game.log');
      app.parser.feed([start], true);
      app.parser.recovered();
      await app.invoke('config.update', { analyticsEnabled: false });
      app.parser.feed(['Log: GameController dispose called', start]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(
        fetchImpl.mock.calls
          .flatMap(([, init]) => JSON.parse(String(init?.body)))
          .filter((event) => event.eventName === 'match_started'),
      ).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([true, false])(
    'captures startup failures before service start only with saved consent: %s',
    async (consent) => {
      vi.useFakeTimers();
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({}));
      const p = platform(fetchImpl);
      p.analytics = { enabled: true, distribution: 'installed' };
      const app = application(p, [], true);
      app.db.updateConfig({
        analyticsEnabled: consent,
        analyticsChoiceSaved: true,
      });
      app.reportError('startup', new TypeError('private startup detail'));
      await vi.advanceTimersByTimeAsync(1000);
      const errors = fetchImpl.mock.calls
        .flatMap(([, init]) => JSON.parse(String(init?.body)))
        .filter((event) => event.eventName === 'app_error');
      expect(errors).toHaveLength(consent ? 1 : 0);
      if (consent)
        expect(errors[0].props).toMatchObject({ source: 'startup', error_level: 'fatal' });
      expect(JSON.stringify(errors)).not.toContain('private startup detail');
      vi.useRealTimers();
    },
  );

  it.each(['unsupported', 'disabled', 'offline', 'no-network'] as const)(
    'never sends analytics in %s mode even with a saved opt-in',
    async (mode) => {
      vi.useFakeTimers();
      const fetchImpl = vi.fn<typeof fetch>();
      const p = platform(fetchImpl);
      if (mode !== 'unsupported')
        p.analytics = { enabled: mode !== 'disabled', distribution: 'installed' };
      p.http.offline = mode === 'offline';
      const app = application(p, [], mode !== 'no-network');
      try {
        await app.invoke('config.update', { analyticsEnabled: true });
        app.parser.feed(['Log: Start loading battle... map: Dam, scenario: Test']);
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('applies consent immediately and keeps raw RPC inputs and error messages private', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({}));
    const p = platform(fetchImpl);
    p.analytics = { enabled: true, distribution: 'installed' };
    const app = application(p, [], true);
    try {
      await app.invoke('config.update', { analyticsEnabled: true, lang: 'en' });
      await expect(
        app.invoke('replays.play', { name: 'private-player-recording.webm' }),
      ).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const bodies = fetchImpl.mock.calls.flatMap(([, init]) =>
        JSON.parse(String(init?.body)).map((event: unknown) => JSON.stringify(event)),
      );
      expect(bodies[0]).toContain('"locale":"en"');
      expect(bodies[1]).toContain('"operation":"recording_play"');
      expect(bodies[1]).toContain('"result":"failure"');
      expect(bodies.join('')).not.toMatch(/private-player|\.webm|in-memory-lifecycle/);
      await app.invoke('config.update', { analyticsEnabled: false });
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
    app.db.updateConfig({ logDir: logs, replayEnabled: true });
    await app.start();
    await app.invoke('matches.scan', null);
    expect(app.db.matches()).toHaveLength(2);
    expect(p.recordings.start).not.toHaveBeenCalled();
    await app.watcher.poll();
    const session = app.parser.snapshot();
    const aborts = vi.mocked(p.recordings.abort).mock.calls.length;
    await appendFile(join(logs, 'history', 'old.txt'), lines('103'));
    await app.invoke('matches.scan', null);
    expect(app.db.matches()).toHaveLength(3);
    expect(app.parser.snapshot()).toEqual(session);
    expect(p.recordings.abort).toHaveBeenCalledTimes(aborts);
    expect(p.recordings.start).not.toHaveBeenCalled();
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
  it.each(['starting', 'recording', 'stopping'] as const)(
    'disables future recording without stopping the current %s capture',
    async (phase) => {
      const p = platform(vi.fn<typeof fetch>()),
        app = application(p);
      app.db.updateConfig({ replayEnabled: true });
      Object.assign(p.recordings.status(), { phase, sessionId: 'reviewed-capture' });
      expect((await app.invoke('config.update', { replayEnabled: false })).replayEnabled).toBe(
        false,
      );
      expect(p.recordings.stop).not.toHaveBeenCalled();
      expect(p.recordings.status().phase).toBe(phase);
    },
  );
  it('waits for explicit stop completion against the reviewed capture', async () => {
    const p = platform(vi.fn<typeof fetch>()),
      app = application(p),
      held = deferred<void>();
    const status = p.recordings.status();
    Object.assign(status, { phase: 'recording', sessionId: 'reviewed-capture' });
    p.recordings.stop = vi.fn(async () => {
      status.phase = 'stopping';
      await held.promise;
      status.phase = 'idle';
      status.sessionId = null;
    });
    let finished = false;
    const stopping = app
      .invoke('replays.stop', { sessionId: 'reviewed-capture' })
      .then((result) => {
        finished = true;
        return result;
      });
    await vi.waitFor(() => expect(p.recordings.stop).toHaveBeenCalledTimes(1));
    expect(finished).toBe(false);
    held.resolve();
    expect((await stopping).phase).toBe('idle');
  });
  it.each(['another capture', 'already ended'] as const)(
    'rejects a stale stop target: %s',
    async (scenario) => {
      const p = platform(vi.fn<typeof fetch>()),
        app = application(p);
      Object.assign(p.recordings.status(), {
        phase: scenario === 'another capture' ? 'recording' : 'idle',
        sessionId: scenario === 'another capture' ? 'new-capture' : null,
      });
      await expect(app.invoke('replays.stop', { sessionId: 'reviewed-capture' })).rejects.toThrow(
        'RECORDING_TARGET_CHANGED',
      );
      expect(p.recordings.stop).not.toHaveBeenCalled();
    },
  );
  function liveCaptureApplication() {
    const p = platform(vi.fn<typeof fetch>()),
      events: AppEvent[] = [],
      app = application(p, events);
    vi.spyOn(app.parser, 'snapshot').mockReturnValue({
      ...app.parser.snapshot(),
      current: emptyMatch('live-session'),
      recovering: false,
    });
    vi.spyOn(app.watcher, 'status').mockReturnValue({ ...app.watcher.status(), live: true });
    return { p, events, app };
  }
  it('returns a committed preference when capture startup fails and keeps the capture outcome separate', async () => {
    const { p, events, app } = liveCaptureApplication();
    app.db.updateConfig({ replayEnabled: false });
    p.recordings.start = vi.fn(async () => {
      Object.assign(p.recordings.status(), { phase: 'error', error: 'Controlled startup failure' });
      throw new Error('Controlled startup failure');
    });
    expect((await app.invoke('config.update', { replayEnabled: true })).replayEnabled).toBe(true);
    expect(app.db.config().replayEnabled).toBe(true);
    expect(p.recordings.status().phase).toBe('error');
    expect(events.some((event) => event.type === 'config' && event.config.replayEnabled)).toBe(
      true,
    );
    expect(
      events.some(
        (event) => event.type === 'error' && event.message === 'Controlled startup failure',
      ),
    ).toBe(true);
    await app.invoke('config.update', { replayEnabled: true });
    expect(p.recordings.start).toHaveBeenCalledTimes(1);
  });
  it('re-enables automatic recording without replacing a capture that was allowed to finish', async () => {
    const { p, app } = liveCaptureApplication();
    app.db.updateConfig({ replayEnabled: false });
    Object.assign(p.recordings.status(), { phase: 'recording', sessionId: 'kept-capture' });
    await app.invoke('config.update', { replayEnabled: true });
    expect(p.recordings.start).not.toHaveBeenCalled();
    expect(p.recordings.status().sessionId).toBe('kept-capture');
  });
  it('restarts a failed live capture once and rejects overlapping retry requests', async () => {
    const { p, app } = liveCaptureApplication(),
      held = deferred<void>();
    app.db.updateConfig({ replayEnabled: true });
    Object.assign(p.recordings.status(), { phase: 'error', error: 'Earlier failure' });
    p.recordings.start = vi.fn(async () => {
      await held.promise;
      Object.assign(p.recordings.status(), {
        phase: 'recording',
        sessionId: 'new-capture',
        error: null,
      });
    });
    const first = app.invoke('replays.retry', null);
    await vi.waitFor(() => expect(p.recordings.start).toHaveBeenCalledTimes(1));
    await expect(app.invoke('replays.retry', null)).rejects.toThrow('RECORDING_RETRY_UNAVAILABLE');
    held.resolve();
    expect((await first).sessionId).toBe('new-capture');
  });
  it.each([
    'disabled',
    'no match',
    'offline watcher',
    'watcher error',
    'ended match',
    'already recording',
  ] as const)('rejects an unavailable recording retry: %s', async (condition) => {
    const { p, app } = liveCaptureApplication();
    app.db.updateConfig({ replayEnabled: condition !== 'disabled' });
    Object.assign(p.recordings.status(), {
      phase: condition === 'already recording' ? 'recording' : 'error',
    });
    if (condition === 'no match')
      vi.mocked(app.parser.snapshot).mockReturnValue({ ...app.parser.snapshot(), current: null });
    if (condition === 'offline watcher')
      vi.mocked(app.watcher.status).mockReturnValue({ ...app.watcher.status(), live: false });
    if (condition === 'watcher error')
      vi.mocked(app.watcher.status).mockReturnValue({
        ...app.watcher.status(),
        error: 'Controlled read failure',
      });
    if (condition === 'ended match')
      vi.mocked(app.parser.snapshot).mockReturnValue({
        ...app.parser.snapshot(),
        current: { ...app.parser.snapshot().current!, endedAt: 1700000060000 },
      });
    await expect(app.invoke('replays.retry', null)).rejects.toThrow('RECORDING_RETRY_UNAVAILABLE');
    expect(p.recordings.start).not.toHaveBeenCalled();
  });
  it('does not reset other settings or stop recording and input when changing language', async () => {
    const p = platform(vi.fn<typeof fetch>());
    const events: AppEvent[] = [];
    const app = application(p, events);
    const before = app.db.updateConfig({
      logDir: 'custom-logs',
      decksDir: 'custom-decks',
      theme: 'forest',
      replayEnabled: true,
      replaySaveDir: 'custom-recordings',
    });
    const watch = vi.spyOn(app.watcher, 'start');

    const config = await app.invoke('config.update', { lang: 'en' });

    expect(config).toEqual({ ...before, lang: 'en' });
    expect(app.snapshot().config).toEqual(config);
    expect(events).toContainEqual({ type: 'config', config, revision: 1 });
    expect(watch).not.toHaveBeenCalled();
    expect(p.recordings.stop).not.toHaveBeenCalled();
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
    app.db.updateConfig({ replayEnabled: true });
    const close = vi.spyOn(app.db, 'close');
    const stopping = app.stop();
    await stopStarted.promise;
    app.parser.feed([
      'Log: GetPersonaName Zola',
      'Log: Start loading battle... map: Dam, scenario: Test',
    ]);
    await expect(app.invoke('app.bootstrap', null)).rejects.toThrow('Application closed');
    expect(p.recordings.start).not.toHaveBeenCalled();
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
