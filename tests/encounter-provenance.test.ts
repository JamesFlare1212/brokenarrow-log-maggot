import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, Ban, RecordingState } from '@ba/contracts';
import { emptyMatch, emptyPlayer } from '@ba/shared';
import type { Platform } from '../apps/server/src/ports';
vi.mock('../apps/server/src/config', async (original) => {
  const module = await original<typeof import('../apps/server/src/config')>();
  return {
    ...module,
    projectConfig: {
      ...module.projectConfig,
      network: { ...module.projectConfig.network, requestOffsetMs: 0, maxAttempts: 1 },
    },
  };
});
import { Application } from '../apps/server/src/app';
import { Database } from '../apps/server/src/storage/database';
const root = resolve('.test-data/encounter-provenance-tests');
const applications: Application[] = [],
  databases: Database[] = [],
  directories: string[] = [];
const idle: RecordingState = {
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
const ban = (id = '90001'): Ban => ({
  id,
  name: 'Lookup target',
  steamId: '',
  rating: 2100,
  firstSeenAt: 10,
  lastSeenAt: 20,
  encountered: false,
});
const searchPlayer = (id = '90001', name = 'Lookup target') => ({
  id,
  name,
  rating: 2100,
  level: 4,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function directory() {
  await mkdir(root, { recursive: true });
  const value = await mkdtemp(join(root, 'case-'));
  directories.push(value);
  return value;
}
async function fixture(fetch: typeof globalThis.fetch, onEvent?: (event: AppEvent) => void) {
  const dir = await directory(),
    events: AppEvent[] = [];
  const notify = vi.fn();
  const port: Platform = {
    version: 'encounter-provenance',
    http: { fetch },
    selectDirectory: async () => null,
    detectLogDirectory: async () => '',
    openPath: async () => {},
    openExternal: async () => {},
    notify,
    recordings: {
      status: () => idle,
      start: async () => {},
      stop: async () => {},
      abort: async () => {},
      displays: async () => [],
      thumbnail: async () => null,
      playback: async () => '',
      displayPreview: async (requestedId) => ({
        requestedId,
        sourceId: null,
        label: null,
        selection: 'unavailable',
        thumbnail: null,
        displays: [],
      }),
    },
  };
  const create = () => {
    const app = new Application(
      dir,
      port,
      (event) => {
        events.push(event);
        onEvent?.(event);
      },
      false,
    );
    applications.push(app);
    app.db.updateConfig({
      logDir: join(dir, 'logs'),
      decksDir: join(dir, 'decks'),
      replaySaveDir: join(dir, 'recordings'),
      replayEnabled: false,
      autoQueryCurrentMatch: false,
      banPollEnabled: false,
      matchSyncEnabled: false,
      analyticsEnabled: false,
      analyticsChoiceSaved: true,
    });
    return app;
  };
  return { app: create(), create, dir, events, notify };
}
function database(file = ':memory:') {
  const db = new Database(file);
  databases.push(db);
  return db;
}
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.stop()));
  for (const db of databases.splice(0)) db.close();
  for (const dir of directories.splice(0)) {
    expect(resolve(dir).startsWith(root + sep)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  }
});

describe('committed account identity events', () => {
  it.each([false, true])(
    'publishes first and additional identities after commit (existing=%s)',
    async (existing) => {
      let reader: DatabaseSync | undefined;
      const committed: string[] = [];
      const { app, dir, events } = await fixture(
        async () => Response.json({}),
        (event) => {
          if (event.type !== 'accounts' || !reader) return;
          expect(event.list.map((account) => account.id).sort()).toEqual(
            reader
              .prepare('SELECT id FROM accounts ORDER BY id')
              .all()
              .map((row) => row.id),
          );
          expect(
            JSON.parse(
              String(
                reader.prepare('SELECT value FROM app_state WHERE key=?').get('activeAccountId')
                  ?.value,
              ),
            ),
          ).toBe(event.activeAccountId);
          committed.push(event.activeAccountId!);
        },
      );
      if (existing) app.db.observeAccount('1', 'Alpha');
      const logs = join(dir, 'logs');
      await mkdir(logs);
      const log = join(logs, 'Gamelog__current.log');
      await writeFile(log, 'Log: GetPersonaName Bravo\nLog: Incoming client Bravo:2 to lobby\n');
      reader = new DatabaseSync(join(dir, 'assistant.sqlite'), { readOnly: true });
      try {
        app.watcher.start(logs);
        await app.invoke('logs.refresh', null);
        await vi.waitFor(() => expect(committed).toContain('2'));
        expect(await app.invoke('accounts.list', null)).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: '2', name: 'Bravo' })]),
        );
        const plan = await app.invoke('accounts.planDelete', { id: '2' });
        await app.invoke('accounts.delete', { token: plan.token });
        expect(
          events
            .filter((event) => event.type === 'accounts')
            .at(-1)
            ?.list.some((account) => account.id === '2'),
        ).toBe(false);
        await appendFile(log, 'Log: Incoming client Bravo:2 to lobby\n');
        await app.invoke('logs.refresh', null);
        await vi.waitFor(() =>
          expect(
            events
              .filter((event) => event.type === 'accounts')
              .at(-1)
              ?.list.some((account) => account.id === '2'),
          ).toBe(true),
        );
      } finally {
        reader.close();
        reader = undefined;
      }
    },
  );
});
describe('search history without game observations', () => {
  it.each(['network', 'cache', 'stale', 'local'] as const)(
    'retains useful %s lookup data without an encounter or notification',
    async (mode) => {
      let online = true;
      const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
        if (String(url).includes('/api/leaderboard/ban'))
          return Response.json({ leaderboard: [searchPlayer()] });
        return online
          ? Response.json({ players: [searchPlayer()] })
          : new Response('', { status: 403 });
      });
      const { app, notify } = await fixture(fetch);
      await app.invoke('players.search', { query: 'Lookup' });
      if (mode === 'cache') await app.invoke('players.search', { query: 'Lookup' });
      if (mode === 'stale') {
        app.db.sql.prepare('UPDATE api_cache SET expires_at=0').run();
        online = false;
        await app.invoke('players.search', { query: 'Lookup' });
      }
      if (mode === 'local') {
        app.db.clearCache('all');
        online = false;
        expect(await app.invoke('players.search', { query: 'Lookup' })).toEqual({
          source: 'local',
          players: [searchPlayer()],
        });
      }
      expect(app.db.localSearch('Lookup')).toEqual([searchPlayer()]);
      expect(app.db.player('90001')).toBeNull();
      expect(app.db.hasGameObservation('90001')).toBe(false);
      expect(app.db.encounters('90001')).toEqual([]);
      await app.invoke('bans.sync', null);
      expect(app.db.bans(true)).toEqual([]);
      expect(app.db.bans()[0]).toMatchObject({
        encountered: false,
        lastEncounterAt: null,
        unverifiedObservation: false,
      });
      expect(app.db.banAlerts()).toEqual([]);
      expect(notify).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'keeps a late search separate across restart, HTTP failure=%s',
    async (failure) => {
      const held = deferred<Response>();
      const { app, create, notify } = await fixture(async (url) =>
        String(url).includes('/api/leaderboard/ban')
          ? Response.json({ leaderboard: [searchPlayer()] })
          : String(url).includes('Alpha')
            ? held.promise
            : Response.json({ players: [searchPlayer('90002', 'Bravo')] }),
      );
      const old = app.invoke('players.search', { query: 'Alpha' });
      await app.invoke('players.search', { query: 'Bravo' });
      held.resolve(
        failure ? new Response('', { status: 403 }) : Response.json({ players: [searchPlayer()] }),
      );
      await old;
      await app.stop();
      const next = create();
      await next.invoke('bans.sync', null);
      expect(next.db.bans(true)).toEqual([]);
      expect(next.db.banAlerts()).toEqual([]);
      expect(notify).not.toHaveBeenCalled();
      expect(next.db.localSearch('Bravo')[0]?.id).toBe('90002');
      expect(next.db.localSearch('Lookup').some((player) => player.id === '90001')).toBe(!failure);
    },
  );
  it('preserves lookup aliases and newer metadata without changing genuine encounter time or name', () => {
    const db = database();
    db.observe([{ id: '90001', name: 'Game name' }], 100);
    db.rememberSearchPlayers([searchPlayer('90001', 'Older lookup')], 200);
    db.rememberSearchPlayers([searchPlayer('90001', 'Newest lookup')], 400);
    db.rememberSearchPlayers([searchPlayer('90001', 'Late cached alias')], 300);
    expect(db.localSearch('Older lookup')[0]).toMatchObject({
      id: '90001',
      name: 'Newest lookup',
      rating: 2100,
    });
    expect(db.localSearch('Late cached alias')[0]?.id).toBe('90001');
    expect(db.player('90001')).toMatchObject({
      name: 'Game name',
      firstSeen: 100,
      lastSeen: 100,
      unverifiedObservation: false,
    });
    expect(db.player('90001')?.names.map((name) => name.name)).toEqual(['Game name']);
  });
  it('rolls back lookup metadata and does not emit game evidence on a failed enclosing transaction', () => {
    const db = database();
    expect(() =>
      db.transaction(() => {
        db.rememberSearchPlayers([searchPlayer()], 100);
        throw new Error('Rollback');
      }),
    ).toThrow('Rollback');
    expect(db.localSearch('Lookup')).toEqual([]);
    expect(db.hasGameObservation('90001')).toBe(false);
  });
  it.each([false, true])(
    'only observes a viewed API match with local participant evidence: local=%s',
    async (local) => {
      const data: Record<string, unknown> = { '90001': { Name: 'Target', TeamId: 1 } };
      if (local) data['1'] = { Name: 'Actual local', TeamId: 0 };
      const { app } = await fixture(async () =>
        Response.json({ matchInfo: { Data: data, MapId: 1 } }),
      );
      app.db.observeAccount('1', 'Actual local');
      app.db.setState('activeAccountId', '1');
      await app.invoke('matches.detail', { fid: '12345' });
      expect(app.db.hasGameObservation('90001')).toBe(local);
      if (local) expect(app.db.player('90001')).toMatchObject({ lastSeen: 0 });
    },
  );
});
describe('legacy observation migration', () => {
  it('preserves old metadata, reconstructs supported evidence, qualifies unknown observations and archives misleading alerts', async () => {
    const dir = await directory(),
      file = join(dir, 'legacy.sqlite');
    const db = database(file);
    db.sql
      .prepare('INSERT INTO players VALUES(?,?,?,?,1)')
      .run('90001', 'Old searched name', 100, 9000);
    db.sql
      .prepare('INSERT INTO player_names VALUES(?,?,?,?)')
      .run('90001', 'Old searched name', 100, 9000);
    db.saveMatch(
      {
        ...emptyMatch('12345'),
        source: 'log',
        startedAt: 500,
        endedAt: 800,
        players: [emptyPlayer('90002', 'Real game target')],
      },
      false,
    );
    db.ensurePlayer('90003', 'Legacy encounter');
    db.sql
      .prepare('INSERT INTO legacy_encounters VALUES(?,?,?,?,?)')
      .run('e', '90003', null, 2000, JSON.stringify({ id: 'e', at: 2000 }));
    db.saveBans([ban('90001'), ban('90002'), ban('90003')]);
    const inbox = [{ id: 'old-inbox', createdAt: 9000, players: [ban('90001'), ban('90002')] }];
    db.setState('banAlerts', inbox);
    db.setState('encounterEvidence:v1', false);
    const metadata = db.sql.prepare('SELECT * FROM players ORDER BY id').all(),
      names = db.sql.prepare('SELECT * FROM player_names ORDER BY player_id').all();
    databases.splice(databases.indexOf(db), 1);
    db.close();
    const next = database(file);
    expect(next.sql.prepare('SELECT * FROM players ORDER BY id').all()).toEqual(metadata);
    expect(next.sql.prepare('SELECT * FROM player_names ORDER BY player_id').all()).toEqual(names);
    expect(next.bans().find((row) => row.id === '90001')).toMatchObject({
      encountered: false,
      lastEncounterAt: null,
      unverifiedObservation: true,
    });
    expect(next.player('90001')).toMatchObject({
      name: 'Old searched name',
      firstSeen: null,
      lastSeen: null,
      unverifiedObservation: true,
    });
    expect(next.localSearch('Old searched name')[0]?.id).toBe('90001');
    expect(
      next
        .bans(true)
        .map((row) => row.id)
        .sort(),
    ).toEqual(['90002', '90003']);
    expect(next.bans().find((row) => row.id === '90002')?.lastEncounterAt).toBe(800);
    expect(next.bans().find((row) => row.id === '90003')?.lastEncounterAt).toBe(2000);
    expect(next.banAlerts()[0]?.players.map((player) => player.id)).toEqual(['90002']);
    expect(next.state('banAlertsBeforeEncounterEvidence', null)).toEqual(inbox);
  });
  it('does not promote old observations from an API match whose local account was absent', async () => {
    const db = database();
    db.observeAccount('1', 'Actual local');
    db.saveMatch(
      {
        ...emptyMatch('12345'),
        source: 'api',
        localPlayerId: '1',
        players: [emptyPlayer('90001', 'Remote target')],
        endedAt: 1000,
      },
      false,
    );
    db.rebuildGameObservations();
    expect(db.hasGameObservation('90001')).toBe(false);
  });
  it('retains verified encounter evidence after deleting its stored match', () => {
    const db = database();
    db.saveMatch({
      ...emptyMatch('12345'),
      source: 'log',
      players: [emptyPlayer('90001', 'Real target')],
      endedAt: 1000,
    });
    db.deleteMatch('12345');
    expect(db.hasGameObservation('90001')).toBe(true);
    db.saveBans([ban()]);
    expect(db.bans(true)).toHaveLength(1);
  });
});
describe('committed encounter invalidation', () => {
  it('publishes archive-scan observations through the real application callback', async () => {
    const { app, dir, events } = await fixture(async () => Response.json({}));
    const logs = join(dir, 'logs');
    await mkdir(logs);
    app.db.saveBans([ban()]);
    app.event({ type: 'matches' });
    events.length = 0;
    await writeFile(
      join(logs, 'Gamelog__archive.log'),
      'Log: GetPersonaName Local\nLog: Start loading battle... map: Dam, scenario: Test\nLog: FID:12345\nLog: Player list:\nID: 1, Name: Local, Team: Alpha\nID: 90001, Name: Target, Team: Bravo\nLog: Exit lobby\n',
    );
    await app.invoke('matches.scan', null);
    expect(app.db.hasGameObservation('90001')).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'bans' && event.list.some((row) => row.id === '90001' && row.encountered),
      ),
    ).toBe(true);
  });
  it('reconstructs missing evidence when reviewed history is restored', async () => {
    const { app, events } = await fixture(async () => Response.json({}));
    app.db.saveMatch(
      {
        ...emptyMatch('12345'),
        source: 'log',
        endedAt: 1000,
        players: [emptyPlayer('90001', 'Restored target')],
      },
      false,
    );
    app.db.saveBans([ban()]);
    const plan = await app.invoke('matches.planDelete', { id: '12345' });
    const removed = await app.invoke('matches.delete', { token: plan.token });
    if (!removed.backup) throw new Error('Missing recovery backup');
    expect(app.db.hasGameObservation('90001')).toBe(false);
    events.length = 0;
    await app.invoke('history.restore', {
      name: removed.backup.name,
      version: removed.backup.version,
    });
    expect(app.db.bans(true)[0]?.lastEncounterAt).toBe(1000);
    expect(
      events.some(
        (event) =>
          event.type === 'bans' && event.list.some((row) => row.id === '90001' && row.encountered),
      ),
    ).toBe(true);
  });
  it('publishes an updated local ban list after actual lobby file reads without synchronization', async () => {
    const { app, dir, events } = await fixture(async () => {
      throw new Error('No network expected');
    });
    const logs = join(dir, 'logs');
    await mkdir(logs);
    const log = join(logs, 'Gamelog__current.log');
    await writeFile(log, 'Log: GetPersonaName Local\n');
    app.db.saveBans([ban()]);
    app.watcher.start(logs);
    await app.invoke('logs.refresh', null);
    await vi.waitFor(() => expect(app.watcher.status().recovering).toBe(false));
    events.length = 0;
    const reader = new DatabaseSync(join(dir, 'assistant.sqlite'), { readOnly: true });
    try {
      await appendFile(log, 'Log: Incoming client Real target:90001 to lobby\n');
      await app.invoke('logs.refresh', null);
      await vi.waitFor(() =>
        expect(
          events.some(
            (event) =>
              event.type === 'bans' &&
              event.list.some((row) => row.id === '90001' && row.encountered),
          ),
        ).toBe(true),
      );
      expect(
        reader.prepare('SELECT last_seen FROM game_observations WHERE player_id=?').get('90001')
          ?.last_seen,
      ).toBeGreaterThan(0);
      const first = app.db.bans(true)[0]!.lastEncounterAt!;
      await appendFile(log, 'Log: Incoming client Updated target:90001 to lobby\n');
      await app.invoke('logs.refresh', null);
      await vi.waitFor(() => expect(app.db.bans(true)[0]!.lastEncounterAt!).toBeGreaterThan(first));
      expect(
        events.filter((event) => event.type === 'bans').every((event) => event.newly.length === 0),
      ).toBe(true);
      expect(events.filter((event) => event.type === 'bans').at(-1)).toMatchObject({
        list: [expect.objectContaining({ id: '90001', encountered: true })],
      });
    } finally {
      reader.close();
    }
  });
  it('deduplicates unchanged encounter snapshots on match events and reflects newly committed matches', async () => {
    const { app, events } = await fixture(async () => Response.json({}));
    app.db.saveBans([ban()]);
    app.event({ type: 'matches' });
    events.length = 0;
    app.event({ type: 'matches' });
    app.event({ type: 'matches' });
    expect(events.filter((event) => event.type === 'bans')).toEqual([]);
    app.db.saveMatch({
      ...emptyMatch('12345'),
      source: 'log',
      players: [emptyPlayer('90001', 'Real target')],
      endedAt: 1000,
    });
    app.event({ type: 'matches' });
    expect(events.filter((event) => event.type === 'bans')).toHaveLength(1);
    expect(app.db.bans(true)[0]?.lastEncounterAt).toBe(1000);
  });
});
