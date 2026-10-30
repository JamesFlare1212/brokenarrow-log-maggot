import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, RecordingState } from '@ba/contracts';
import type { Platform } from '../apps/server/src/ports';

vi.mock('../apps/server/src/config', async (original) => {
  const module = await original<typeof import('../apps/server/src/config')>();
  return {
    ...module,
    projectConfig: {
      ...module.projectConfig,
      network: { ...module.projectConfig.network, requestOffsetMs: 0, maxAttempts: 1 },
      background: { ...module.projectConfig.background, syncIntervalMs: 50 },
    },
  };
});
import { Application } from '../apps/server/src/app';

const root = resolve('.test-data/ban-synchronization-tests');
const directories: string[] = [];
const applications = new Set<Application>();
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
function platform(fetch: typeof globalThis.fetch): Platform {
  return {
    version: 'ban-sync-tests',
    http: { fetch },
    selectDirectory: async () => null,
    detectLogDirectory: async () => '',
    openPath: async () => {},
    openExternal: async () => {},
    notify: vi.fn(),
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
}
async function fixture(fetch: typeof globalThis.fetch, network = false) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  directories.push(directory);
  const events: AppEvent[] = [];
  const port = platform(fetch);
  const create = () => {
    const app = new Application(directory, port, (event) => events.push(event), network);
    applications.add(app);
    app.db.updateConfig({
      logDir: join(directory, 'logs'),
      decksDir: join(directory, 'decks'),
      replaySaveDir: join(directory, 'recordings'),
      analyticsEnabled: false,
      analyticsChoiceSaved: true,
      banPollEnabled: true,
      matchSyncEnabled: true,
    });
    return app;
  };
  return { app: create(), create, port, events };
}
afterEach(async () => {
  await Promise.all([...applications].map((app) => app.stop()));
  applications.clear();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    expect(resolve(directory).startsWith(root + sep)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
});
const remote = (name = 'Remote ban') =>
  Response.json({ leaderboard: [{ id: '9001', name, rating: 2100 }] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('authoritative ban synchronization', () => {
  it('shares manual requests and persists success and failure across service restarts', async () => {
    const held = deferred<Response>();
    let fail = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      fail ? new Response('', { status: 403 }) : held.promise,
    );
    const { app, create } = await fixture(fetch);
    const first = app.invoke('bans.sync', null);
    const second = app.invoke('bans.sync', null);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const pending = app.snapshot().banSync;
    expect(pending.phase).toBe('syncing');
    held.resolve(remote());
    expect(await first).toEqual(await second);
    const successful = app.snapshot().banSync;
    expect(successful).toMatchObject({
      phase: 'success',
      attemptId: pending.attemptId,
      error: null,
    });
    fail = true;
    await expect(app.invoke('bans.sync', null)).rejects.toThrow('403');
    const failed = app.snapshot().banSync;
    expect(failed).toMatchObject({ phase: 'error', lastSuccessAt: successful.lastSuccessAt });
    expect(failed.attemptId).not.toBe(successful.attemptId);
    expect(app.db.bans()).toHaveLength(1);
    await app.stop();
    const restarted = create();
    expect(restarted.snapshot().banSync).toEqual(failed);
    fail = false;
    // A fresh response is required because fetch responses are consumed once.
    fetch.mockImplementation(async () => remote());
    await restarted.invoke('bans.sync', null);
    expect(restarted.snapshot().banSync).toMatchObject({ phase: 'success', error: null });
  });
  it('normalizes an interrupted persisted attempt to an actionable failure', async () => {
    const { app, create } = await fixture(async () => remote());
    const status = {
      phase: 'syncing',
      attemptId: 'interrupted',
      lastAttemptAt: 10,
      lastSuccessAt: 5,
      error: null,
    };
    app.db.setState('banSync', status);
    await app.stop();
    const restarted = create();
    expect(restarted.snapshot().banSync).toEqual({
      ...status,
      phase: 'error',
      error: 'BAN_SYNC_INTERRUPTED',
    });
    await restarted.invoke('bans.sync', null);
    expect(restarted.snapshot().banSync.phase).toBe('success');
  });
  it('commits bans and the success timestamp together and rolls both back on storage failure', async () => {
    const { app } = await fixture(async () => remote());
    const save = app.db.saveBans.bind(app.db);
    vi.spyOn(app.db, 'saveBans').mockImplementation((list) => {
      save(list);
      throw new Error('Disk write failed');
    });
    await expect(app.invoke('bans.sync', null)).rejects.toThrow('Disk write failed');
    expect(app.db.bans()).toEqual([]);
    expect(app.db.state('lastBanSync', null)).toBeNull();
    expect(app.snapshot().banSync).toMatchObject({
      phase: 'error',
      lastSuccessAt: null,
      error: 'Disk write failed',
    });
    expect(app.db.state('banSync', null)).toEqual(app.snapshot().banSync);
  });
  it('keeps committed success when a desktop notification throws', async () => {
    const { app, port } = await fixture(async () => remote());
    app.db.observe([{ id: '9001', name: 'Observed' }], 1);
    vi.mocked(port.notify).mockImplementation(() => {
      throw new Error('Notification unavailable');
    });
    await expect(app.invoke('bans.sync', null)).resolves.toHaveLength(1);
    expect(app.snapshot().banSync.phase).toBe('success');
    expect(app.db.banAlerts()).toHaveLength(1);
  });
});
describe('independent scheduled synchronization', () => {
  it.each(['failed', 'held'] as const)(
    'saves matches while ban synchronization is %s, then recovers on a scheduled cycle',
    async (mode) => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      let recover = false;
      const held = deferred<Response>();
      const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
        const path = new URL(String(url));
        if (path.pathname === '/api/leaderboard/ban' && path.searchParams.get('limit') === '500')
          return recover
            ? remote()
            : mode === 'held'
              ? held.promise
              : new Response('', { status: 403 });
        if (path.pathname === '/api/players/matches')
          return Response.json({ matches: [{ matchId: '12345', data: { MapId: 1, Data: {} } }] });
        return Response.json({});
      });
      const { app, events } = await fixture(fetch, true);
      app.db.setState('activeAccountId', '123');
      await app.start();
      await vi.waitFor(() => expect(app.db.match('12345')).not.toBeNull());
      await vi.waitFor(() => expect(app.db.state('lastMatchSync', null)).not.toBeNull());
      expect(events.some((event) => event.type === 'matches')).toBe(true);
      if (mode === 'held') {
        expect(app.snapshot().banSync.phase).toBe('syncing');
        held.resolve(new Response('', { status: 403 }));
      }
      await vi.waitFor(() => expect(app.snapshot().banSync.phase).toBe('error'));
      await vi.waitFor(() =>
        expect(
          events.some((event) => event.type === 'error' && event.message.includes('403')),
        ).toBe(true),
      );
      recover = true;
      app.db.sql.prepare('DELETE FROM api_cache').run();
      const previousMatches = events.filter((event) => event.type === 'matches').length;
      await vi.advanceTimersByTimeAsync(50);
      await vi.waitFor(() => expect(app.snapshot().banSync.phase).toBe('success'));
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'matches').length).toBeGreaterThan(
          previousMatches,
        ),
      );
      expect(app.db.bans()).toHaveLength(1);
      expect(
        fetch.mock.calls.filter(([url]) => String(url).includes('stbid=123&limit=10')),
      ).toHaveLength(2);
    },
  );
  it.each([
    { bans: false, matches: true },
    { bans: true, matches: false },
  ])('honors independent switches: bans=$bans, matches=$matches', async ({ bans, matches }) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      String(url).includes('limit=500') ? remote() : Response.json({ matches: [] }),
    );
    const { app } = await fixture(fetch, true);
    app.db.updateConfig({ banPollEnabled: bans, matchSyncEnabled: matches });
    app.db.setState('activeAccountId', '123');
    await app.start();
    await vi.waitFor(() =>
      expect(
        bans
          ? app.snapshot().banSync.phase === 'success'
          : app.db.state('lastMatchSync', null) !== null,
      ).toBe(true),
    );
    expect(fetch.mock.calls.some(([url]) => String(url).includes('limit=500'))).toBe(bans);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('stbid=123&limit=10'))).toBe(
      matches,
    );
  });
});
