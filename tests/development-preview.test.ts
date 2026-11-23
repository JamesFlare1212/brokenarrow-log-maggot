import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, Bridge, RpcInputs, RpcMethod, RpcOutputs } from '@ba/contracts';
import {
  capturedAccounts,
  capturedMatches,
  capturedPlayers,
  capturedProfiles,
  capturedReports,
  fixtureBootstrap,
} from './fixtures/ui';
import { createDevelopmentRuntime } from '../apps/web/src/dev/runtime';

type Reads = { [K in RpcMethod]?: (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]> };
const match = capturedMatches[0]!;
const id = fixtureBootstrap.activeAccountId!;
const requestId = '00000000-0000-4000-8000-000000000001';
const runtimes: ReturnType<typeof createDevelopmentRuntime>[] = [];
function setup(overrides: Reads = {}) {
  const calls: RpcMethod[] = [];
  const reads: Reads = {
    'app.bootstrap': () => fixtureBootstrap,
    'matches.list': () => capturedMatches,
    'accounts.list': () => capturedAccounts,
    'bans.list': () => [],
    'decks.list': () => ({ found: false, decksDir: '', backupsDir: '', decks: [], backups: [] }),
    'replays.list': () => [],
    'cache.stats': () => ({
      api: { entries: 13, expired: 13, bytes: 42 },
      snapshots: { entries: 1, expired: 0, bytes: 80 },
    }),
    'players.report': ({ id }) => {
      if (!capturedReports[id]) throw new Error('No captured player report');
      return capturedReports[id];
    },
    'players.profile': ({ id }) => capturedProfiles[id]!,
    'players.search': ({ query }) => ({
      players: capturedPlayers.filter((p) => p.id === query),
      source: 'local',
    }),
    'matches.detail': ({ fid }) => {
      const recorded = capturedMatches.find((m) => m.fid === fid);
      if (!recorded) throw new Error('No captured match');
      return recorded;
    },
    ...overrides,
  };
  const listeners = new Set<(event: AppEvent) => void>();
  const base: Bridge = {
    async invoke<K extends RpcMethod>(method: K, input: RpcInputs[K]): Promise<RpcOutputs[K]> {
      calls.push(method);
      const read = reads[method] as
        ((input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>) | undefined;
      if (!read) throw new Error('Unexpected fixture request: ' + method);
      return read(input);
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const createVideo = vi.fn(async () => 'blob:development-preview');
  const runtime = createDevelopmentRuntime(base, { now: () => 1_800_000_000_000, createVideo });
  runtimes.push(runtime);
  return {
    runtime,
    calls,
    createVideo,
    broadcast: (event: AppEvent) => listeners.forEach((fn) => fn(event)),
  };
}
afterEach(() => {
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.useRealTimers();
});

describe('fixture-backed development scenes', () => {
  it('starts in captured mode and does not preload simulations', async () => {
    const { runtime, calls, createVideo } = setup();
    expect(runtime.controls.getSnapshot().mode).toBe('captured');
    expect(await runtime.api.invoke('app.bootstrap', null)).toEqual(fixtureBootstrap);
    expect(await runtime.api.invoke('matches.list', {})).toEqual(capturedMatches);
    expect(calls).toEqual(['app.bootstrap', 'matches.list']);
    expect(createVideo).not.toHaveBeenCalled();
  });

  it('keeps archive facts intact while replaying a recorded 5v5 roster and reports', async () => {
    const { runtime } = setup();
    await runtime.controls.setMode('demo');
    const events: AppEvent[] = [];
    runtime.api.subscribe((e) => events.push(e));
    const { session, revision } = await runtime.api.invoke('app.bootstrap', null);
    expect(session).toMatchObject({
      phase: 'match',
      localPlayerId: id,
      localDeck: match.localDeck,
    });
    expect(session.current).toMatchObject({
      map: match.map,
      fid: match.fid,
      endedAt: null,
      winnerTeamId: null,
      outcome: 'unknown',
    });
    expect(session.current?.players.map((p) => p.id)).toEqual(match.players.map((p) => p.id));
    expect(await runtime.api.invoke('matches.list', {})).toEqual(capturedMatches);
    const rows = events.filter((e) => e.type === 'roster');
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.revision).toBeGreaterThan(revision);
      const report = capturedReports[row.player.id]!;
      expect(row.info).toMatchObject({
        elo: report.elo,
        kd: report.kd,
        stale: false,
        sampleCount: report.sampleCount,
      });
    }
    expect(await runtime.api.invoke('players.search', { query: id })).toMatchObject({
      players: [expect.objectContaining({ id })],
    });
    const profile = capturedProfiles[id]!;
    expect(await runtime.api.invoke('players.profile', { id, force: false })).toEqual({
      ...profile,
      info: profile.info && { ...profile.info, stale: false },
      recentError: profile.recentError === 'Recent matches are cached' ? null : profile.recentError,
    });
    for (const count of [1, 2, 3, 4, 5, 2, null] as const) {
      events.length = 0;
      runtime.controls.setLobbyPlayerCount(count);
      const { session: next } = await runtime.api.invoke('app.bootstrap', null);
      expect(next.phase).toBe(count === null ? 'match' : 'lobby');
      expect(next.lobbyPlayers).toHaveLength(count ?? 10);
      expect(next.lobbyPlayers[0]?.id).toBe(id);
      expect(next.current).toEqual(count === null ? session.current : null);
      if (count !== null) expect(next.lobbyPlayers.every((p) => p.teamId === null)).toBe(true);
      expect(events.filter((e) => e.type === 'roster')).toHaveLength(count ?? 10);
    }
    await runtime.api.invoke('config.update', { autoQueryCurrentMatch: false });
    events.length = 0;
    runtime.controls.setLobbyPlayerCount(3);
    expect(events.map((e) => e.type)).toEqual(['session']);
    expect(
      await runtime.api.invoke('session.query', {
        context: 'previous',
        requestId,
        players: match.players.slice(2, 4),
      }),
    ).toMatchObject({ queried: 2, skipped: 0, cancelled: false });
    expect(events.filter((e) => e.type === 'roster').map((e) => e.player.id)).toEqual(
      match.players.slice(2, 4).map((p) => p.id),
    );
  });

  it.each(['captured', 'demo'] as const)(
    'previews expiry in %s without rewriting fixtures',
    async (mode) => {
      const warning = 'Cached match data; BATrace is unavailable';
      const alreadyStale = mode === 'captured';
      const rawMatch = { ...match, warning: alreadyStale ? warning : undefined };
      const report = { ...capturedReports[id]!, stale: alreadyStale };
      const profile = {
        ...capturedProfiles[id]!,
        recentError: alreadyStale ? 'Recent matches are cached' : null,
      };
      const timeline = {
        status: 'unavailable',
        reason: 'missing-unit-data',
        data: null,
        source: alreadyStale ? 'stale' : 'cache',
        updatedAt: 1,
      } as const;
      const { runtime, calls } = setup({
        'matches.detail': () => rawMatch,
        'matches.timeline': () => timeline,
        'players.report': () => report,
        'players.profile': () => profile,
      });
      if (mode === 'demo') await runtime.controls.setMode(mode);
      const bootstrapApi = runtime.bootstrapApi;
      const api = runtime.api;
      const read = () =>
        Promise.all([
          runtime.api.invoke('matches.detail', { fid: match.fid!, force: false }),
          runtime.api.invoke('matches.timeline', { fid: match.fid!, force: false }),
          runtime.api.invoke('players.report', { id }),
          runtime.api.invoke('players.profile', { id, force: false }),
          runtime.api.invoke('cache.stats', null),
        ]);
      const [fresh, freshTimeline, freshReport, freshProfile, freshStats] = await read();
      expect(fresh.warning).toBeUndefined();
      expect(freshTimeline).toEqual({ ...timeline, source: 'cache' });
      expect(freshReport).toEqual({ ...report, stale: false });
      expect(freshProfile.info?.stale).toBe(false);
      expect(freshProfile.recentError).toBeNull();
      expect(freshStats.api).toEqual({ entries: 13, expired: 0, bytes: 42 });
      expect(await api.invoke('cache.clear', { mode: 'expired' })).toEqual({
        removed: 0,
        stats: freshStats,
      });

      runtime.controls.setCacheExpiryEnabled(true);
      expect(runtime.bootstrapApi).toBe(bootstrapApi);
      expect(runtime.api).not.toBe(api);
      const [expired, expiredTimeline, expiredReport, expiredProfile, expiredStats] = await read();
      expect(expired).toEqual({ ...rawMatch, warning });
      expect(expiredTimeline).toEqual({ ...timeline, source: 'stale' });
      expect(expiredReport).toEqual({ ...report, stale: true });
      expect(expiredProfile.info?.stale).toBe(true);
      expect(expiredProfile.recentError).toBe('Recent matches are cached');
      expect(expiredStats).toEqual({
        api: { entries: 13, expired: 13, bytes: 42 },
        snapshots: { entries: 1, expired: 1, bytes: 80 },
      });
      const cleared = await runtime.api.invoke('cache.clear', { mode: 'expired' });
      expect(cleared.removed).toBe(14);
      expect(cleared.stats).toEqual({
        api: { entries: 0, expired: 0, bytes: 0 },
        snapshots: { entries: 0, expired: 0, bytes: 0 },
      });
      expect(await runtime.api.invoke('cache.stats', null)).toEqual(cleared.stats);
      expect((await runtime.api.invoke('cache.clear', { mode: 'all' })).removed).toBe(0);
      runtime.controls.setCacheExpiryEnabled(false);
      expect((await read())[0]).toEqual(fresh);
      expect(calls).not.toContain('cache.clear');
      expect(rawMatch.warning).toBe(alreadyStale ? warning : undefined);
      expect(report.stale).toBe(alreadyStale);
      expect(profile.recentError).toBe(alreadyStale ? 'Recent matches are cached' : null);
    },
  );

  it('preserves real failures, local-only results, and data in independent tabs', async () => {
    const { runtime } = setup({
      'matches.detail': () => ({ ...match, warning: 'Match has no valid roster' }),
      'matches.timeline': () => ({
        status: 'unavailable',
        reason: 'unsupported-mode',
        source: 'local',
        data: null,
        updatedAt: null,
      }),
      'players.profile': () => ({
        ...capturedProfiles[id]!,
        info: null,
        recentError: 'Missing recent games',
      }),
      'players.report': () => {
        throw new Error('Capture is missing');
      },
    });
    for (const expired of [true, false]) {
      runtime.controls.setCacheExpiryEnabled(expired);
      expect(
        await runtime.api.invoke('matches.detail', { fid: match.fid!, force: false }),
      ).toMatchObject({ warning: 'Match has no valid roster' });
      expect(
        await runtime.api.invoke('matches.timeline', { fid: match.fid!, force: false }),
      ).toMatchObject({ source: 'local', reason: 'unsupported-mode' });
      expect(await runtime.api.invoke('players.profile', { id, force: false })).toMatchObject({
        info: null,
        recentError: 'Missing recent games',
      });
      await expect(runtime.api.invoke('players.report', { id })).rejects.toThrow(
        'Capture is missing',
      );
      expect(setup().runtime.controls.getSnapshot().cacheExpiryEnabled).toBe(false);
    }
  });

  it('updates the latest captured roster without losing subsequent native events', async () => {
    const { runtime, broadcast } = setup();
    const events: AppEvent[] = [];
    runtime.bootstrapApi.subscribe((event) => events.push(event));
    await runtime.bootstrapApi.invoke('app.bootstrap', null);
    const row = {
      type: 'roster',
      requestId,
      context: 'current',
      generation: 1,
      player: match.players[0]!,
      info: capturedProfiles[id]!.info!,
      error: null,
      revision: 10,
    } as const;
    broadcast(row);
    broadcast({ ...row, requestId: 'new', revision: 11, player: match.players[1]! });
    runtime.controls.setCacheExpiryEnabled(true);
    broadcast({ type: 'config', config: fixtureBootstrap.config, revision: 12 });
    expect(events.map((e) => e.revision)).toEqual([10, 11, 12, 13]);
    expect(events[1]).toMatchObject({ info: { stale: false } });
    expect(events[2]).toMatchObject({
      requestId: 'new',
      player: match.players[1],
      info: { stale: true },
    });
    expect(events[3]?.type).toBe('config');
  });

  it('leaves the running scene, lobby, and edited archive intact when flipping expiry', async () => {
    const { runtime } = setup();
    await runtime.controls.setMode('demo');
    runtime.controls.setLobbyPlayerCount(2);
    runtime.controls.setRecording('recording');
    await runtime.api.invoke('matches.delete', { id: match.id });
    const { session, recording } = await runtime.bootstrapApi.invoke('app.bootstrap', null);
    const { generation } = runtime.controls.getSnapshot();
    runtime.controls.setCacheExpiryEnabled(true);
    expect(runtime.controls.getSnapshot()).toMatchObject({
      generation,
      recording: 'recording',
      lobbyPlayerCount: 2,
    });
    expect(await runtime.bootstrapApi.invoke('app.bootstrap', null)).toMatchObject({
      session,
      recording,
    });
    expect(await runtime.api.invoke('matches.list', {})).not.toContainEqual(match);
  });

  it('keeps data edits in the tab; reset restores the fixture, not fabricated replacements', async () => {
    const { runtime, calls } = setup();
    await runtime.controls.setMode('demo');
    await runtime.api.invoke('matches.delete', { id: match.id });
    const stats = await runtime.api.invoke('cache.stats', null);
    expect(await runtime.api.invoke('cache.clear', { mode: 'all' })).toMatchObject({
      removed: stats.api.entries + stats.snapshots.entries,
    });
    expect(await runtime.api.invoke('matches.list', {})).not.toContainEqual(match);
    await runtime.controls.setMode('demo');
    expect(await runtime.api.invoke('matches.list', {})).toContainEqual(match);
    expect(await runtime.api.invoke('cache.stats', null)).toEqual(stats);
    expect(calls).not.toContain('matches.delete');
    expect(calls).not.toContain('cache.clear');
  });

  it('starts genuinely empty and only adds a match if its fixture exists', async () => {
    const { runtime, calls } = setup();
    await runtime.controls.setMode('empty');
    expect((await runtime.api.invoke('app.bootstrap', null)).session).toMatchObject({
      phase: 'idle',
      localPlayerId: null,
      current: null,
      lobbyPlayers: [],
    });
    expect(await runtime.api.invoke('accounts.list', null)).toEqual([]);
    expect(await runtime.api.invoke('matches.list', {})).toEqual([]);
    expect(await runtime.api.invoke('players.search', { query: id })).toMatchObject({
      players: [],
    });
    for (const method of ['matches.detail', 'matches.timeline'] as const) {
      await expect(runtime.api.invoke(method, { fid: match.fid!, force: false })).rejects.toThrow(
        'not in this scene',
      );
    }
    expect(calls).toEqual(['app.bootstrap']);
    await expect(runtime.api.invoke('matches.add', { fid: '0' })).rejects.toThrow(
      'No captured match',
    );
    expect(await runtime.api.invoke('matches.add', { fid: match.fid! })).toEqual(match);
    expect(await runtime.api.invoke('matches.list', {})).toEqual([match]);
    expect(calls).not.toContain('matches.add');
    await runtime.controls.setMode('empty');
    expect(await runtime.api.invoke('matches.list', {})).toEqual([]);
  });

  it('simulates recording, playback and deletion without native recording calls', async () => {
    vi.useFakeTimers();
    const { runtime, createVideo, calls } = setup();
    await runtime.controls.setMode('demo');
    const events: AppEvent[] = [];
    runtime.api.subscribe((e) => events.push(e));
    const before = await runtime.api.invoke('replays.list', null);
    runtime.controls.setRecording('recording');
    vi.advanceTimersByTime(2000);
    expect((await runtime.api.invoke('app.bootstrap', null)).recording).toMatchObject({
      seconds: 2,
      fid: match.fid,
      map: match.map,
    });
    expect(events.some((e) => e.type === 'preview')).toBe(true);
    runtime.controls.setRecording('idle');
    const replays = await runtime.api.invoke('replays.list', null);
    expect(replays).toHaveLength(before.length + 1);
    const name = replays[0]!.id;
    expect(await runtime.api.invoke('replays.play', { name })).toEqual({
      url: 'blob:development-preview',
    });
    await runtime.api.invoke('replays.play', { name });
    expect(createVideo).toHaveBeenCalledTimes(1);
    await runtime.api.invoke('replays.delete', { name });
    expect(await runtime.api.invoke('replays.list', null)).toEqual(before);
    runtime.controls.setRecording('error');
    expect((await runtime.api.invoke('app.bootstrap', null)).recording.phase).toBe('error');
    await runtime.controls.setMode('captured');
    expect((await runtime.api.invoke('app.bootstrap', null)).recording).toEqual(
      fixtureBootstrap.recording,
    );
    expect(calls).not.toContain('replays.delete');
    expect(calls).not.toContain('replays.test');
  });

  it('handles an incomplete corpus without inventing players or statistics', async () => {
    const noRoster = setup({ 'matches.list': () => [] }).runtime;
    await noRoster.controls.setMode('demo');
    noRoster.controls.setLobbyPlayerCount(5);
    expect((await noRoster.api.invoke('app.bootstrap', null)).session).toMatchObject({
      phase: 'idle',
      current: null,
      lobbyPlayers: [],
    });
    const { runtime } = setup({
      'players.report': () => {
        throw new Error('Not recorded');
      },
    });
    await runtime.controls.setMode('demo');
    const events: AppEvent[] = [];
    runtime.api.subscribe((e) => events.push(e));
    await runtime.api.invoke('app.bootstrap', null);
    const roster = events.filter((e) => e.type === 'roster');
    expect(roster).toHaveLength(10);
    expect(roster.every((e) => e.info === null)).toBe(true);
    await expect(runtime.api.invoke('players.report', { id })).rejects.toThrow('Not recorded');
  });

  it('leaves the current scene usable when loading the next fails', async () => {
    const { runtime } = setup({
      'matches.list': () => {
        throw new Error('Fixture unavailable');
      },
    });
    await runtime.controls.setMode('empty');
    const api = runtime.api;
    await expect(runtime.controls.setMode('demo')).rejects.toThrow('Fixture unavailable');
    expect(runtime.controls.getSnapshot()).toMatchObject({ mode: 'empty', pending: false });
    expect(runtime.api).toBe(api);
    expect(await api.invoke('matches.list', {})).toEqual([]);
  });

  it('rejects stale bridges and late responses after switching scenes', async () => {
    let resolve!: (matches: RpcOutputs['matches.list']) => void;
    const pending = new Promise<RpcOutputs['matches.list']>((done) => {
      resolve = done;
    });
    const { runtime } = setup({ 'matches.list': () => pending });
    const oldApi = runtime.api;
    const request = oldApi.invoke('matches.list', {});
    await runtime.controls.setMode('empty');
    resolve(capturedMatches);
    await expect(request).rejects.toThrow('Development scene changed.');
    await expect(oldApi.invoke('config.update', { sidebarCollapsed: true })).rejects.toThrow(
      'Development scene changed.',
    );
  });
});
