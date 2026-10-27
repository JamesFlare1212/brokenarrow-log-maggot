import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, Bridge, RpcInputs, RpcMethod, RpcOutputs } from '@ba/contracts';
import { fixtureBootstrap, capturedMatches } from './fixtures/ui';
import {
  createDevelopmentRuntime,
  developmentLobbyPlayerCounts,
} from '../apps/web/src/dev/runtime';

const runtimes: ReturnType<typeof createDevelopmentRuntime>[] = [];
function setup(
  matches: () => Promise<RpcOutputs['matches.list']> = async () => structuredClone(capturedMatches),
) {
  const calls: RpcMethod[] = [];
  const base: Bridge = {
    async invoke<K extends RpcMethod>(method: K, _input: RpcInputs[K]): Promise<RpcOutputs[K]> {
      calls.push(method);
      if (method === 'app.bootstrap') return structuredClone(fixtureBootstrap) as RpcOutputs[K];
      if (method === 'matches.list') return (await matches()) as RpcOutputs[K];
      throw new Error('Unexpected native request: ' + method);
    },
    subscribe: () => () => {},
  };
  const createVideo = vi.fn(async () => 'blob:development-preview');
  const runtime = createDevelopmentRuntime(base, { now: () => 1_800_000_000_000, createVideo });
  runtimes.push(runtime);
  return { runtime, calls, createVideo };
}
afterEach(() => {
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.useRealTimers();
});

describe('browser development scenes', () => {
  it.each(developmentLobbyPlayerCounts)(
    'simulates a %i-player pre-match party with matching teammate queries and roster events',
    async (count) => {
      const { runtime, calls } = setup();
      await runtime.controls.setMode('demo');
      const api = runtime.api;
      const initial = await api.invoke('app.bootstrap', null);
      const events: AppEvent[] = [];
      const unsubscribe = api.subscribe((event) => events.push(event));

      runtime.controls.setLobbyPlayerCount(count);

      const bootstrap = await api.invoke('app.bootstrap', null);
      expect(bootstrap.session).toMatchObject({
        phase: 'lobby',
        current: null,
        localDeck: '',
        localPlayerId: initial.session.localPlayerId,
        generation: initial.session.generation + 1,
      });
      expect(bootstrap.session.lobbyPlayers).toEqual(
        initial.session.lobbyPlayers.slice(0, count).map(({ id, name }) => ({
          id,
          name,
          teamId: null,
        })),
      );
      expect(new Set(bootstrap.session.lobbyPlayers.map((player) => player.id)).size).toBe(count);
      expect(runtime.controls.getSnapshot()).toMatchObject({
        mode: 'demo',
        lobbyPlayerCount: count,
      });
      expect(events[0]).toMatchObject({ type: 'session', session: bootstrap.session });
      const roster = events.filter((event) => event.type === 'roster');
      expect(roster.map((event) => event.player.id)).toEqual(
        bootstrap.session.lobbyPlayers.map((player) => player.id),
      );
      expect(roster.every((event) => event.generation === bootstrap.session.generation)).toBe(true);
      expect(roster.every((event) => event.info?.elo && event.info.sampleCount)).toBe(true);
      events.length = 0;
      const result = await api.invoke('session.query', {
        context: 'current',
        requestId: '00000000-0000-4000-8000-000000000002',
      });
      expect(result).toMatchObject({ queried: count, skipped: 0, cancelled: false });
      expect(events.filter((event) => event.type === 'roster')).toHaveLength(count);
      expect(await api.invoke('matches.list', {})).toHaveLength(72);
      expect(calls).toEqual(['app.bootstrap']);
      unsubscribe();
    },
  );

  it('grows and shrinks the lobby without losing players and restores the live match', async () => {
    const { runtime, calls } = setup();
    await runtime.controls.setMode('demo');
    const initial = await runtime.api.invoke('app.bootstrap', null);
    const generation = runtime.controls.getSnapshot().generation;
    runtime.controls.setRecording('error');
    runtime.controls.setApm('empty');
    for (const count of [5, 1, 3, 2, 4, 5, null] as const) {
      runtime.controls.setLobbyPlayerCount(count);
      const bootstrap = await runtime.api.invoke('app.bootstrap', null);
      expect(bootstrap.session.lobbyPlayers).toHaveLength(count ?? 10);
      expect(bootstrap.session.current).toEqual(count === null ? initial.session.current : null);
      expect(bootstrap.session.phase).toBe(count === null ? 'match' : 'lobby');
      expect(bootstrap.session.localDeck).toBe(count === null ? initial.session.localDeck : '');
      expect(bootstrap.session.lobbyPlayers.every((player) => player.teamId === null)).toBe(
        count !== null,
      );
      expect(runtime.controls.getSnapshot()).toMatchObject({
        generation,
        lobbyPlayerCount: count,
        recording: 'error',
        apm: 'empty',
      });
    }
    expect(calls).toEqual(['app.bootstrap']);
  });

  it('leaves automatic roster queries disabled when changing the lobby size', async () => {
    const { runtime } = setup();
    await runtime.controls.setMode('demo');
    await runtime.api.invoke('app.bootstrap', null);
    await runtime.api.invoke('config.update', { autoQueryCurrentMatch: false });
    const events: AppEvent[] = [];
    const unsubscribe = runtime.api.subscribe((event) => events.push(event));
    runtime.controls.setLobbyPlayerCount(2);
    expect(events.map((event) => event.type)).toEqual(['session']);
    expect(
      await runtime.api.invoke('session.query', {
        context: 'current',
        requestId: '00000000-0000-4000-8000-000000000003',
      }),
    ).toMatchObject({ queried: 2 });
    expect(events.filter((event) => event.type === 'roster')).toHaveLength(2);
    unsubscribe();
  });

  it('resets the lobby selection and ignores it outside demo mode', async () => {
    const { runtime, calls } = setup();
    runtime.controls.setLobbyPlayerCount(3);
    expect(await runtime.api.invoke('app.bootstrap', null)).toEqual(fixtureBootstrap);
    await runtime.controls.setMode('empty');
    runtime.controls.setLobbyPlayerCount(3);
    expect((await runtime.api.invoke('app.bootstrap', null)).session.lobbyPlayers).toEqual([]);
    await runtime.controls.setMode('demo');
    runtime.controls.setLobbyPlayerCount(3);
    const oldApi = runtime.api;
    await runtime.controls.setMode('demo');
    expect(runtime.controls.getSnapshot().lobbyPlayerCount).toBeNull();
    expect((await runtime.api.invoke('app.bootstrap', null)).session.current?.players).toHaveLength(
      10,
    );
    await expect(oldApi.invoke('app.bootstrap', null)).rejects.toThrow(
      'Development scene changed.',
    );
    await runtime.controls.setMode('captured');
    runtime.controls.setLobbyPlayerCount(3);
    expect(await runtime.api.invoke('app.bootstrap', null)).toEqual(fixtureBootstrap);
    expect(calls.every((method) => method === 'app.bootstrap')).toBe(true);
  });

  it('hydrates a complete live roster after bootstrap and queries only the requested previous players', async () => {
    const { runtime, calls } = setup();
    await runtime.controls.setMode('demo');
    const events: AppEvent[] = [];
    const unsubscribe = runtime.api.subscribe((event) => events.push(event));
    const bootstrap = await runtime.api.invoke('app.bootstrap', null);
    expect(bootstrap.session).toMatchObject({ phase: 'match', localDeck: 'Armored.deck' });
    expect(bootstrap.session.current).toMatchObject({ map: 'Dam', endedAt: null, fid: '9900100' });
    expect(bootstrap.watcher.live).toBe(true);
    const rows = events.filter((event) => event.type === 'roster');
    expect(rows).toHaveLength(10);
    expect(bootstrap.session.current!.players.filter((player) => player.teamId === 0)).toHaveLength(
      5,
    );
    expect(bootstrap.session.current!.players.filter((player) => player.teamId === 1)).toHaveLength(
      5,
    );
    expect(rows.every((row) => row.revision > bootstrap.revision)).toBe(true);
    for (const row of rows) {
      const report = await runtime.api.invoke('players.report', { id: row.player.id });
      expect(row.info).toMatchObject({ elo: report.elo, winRate: report.winRate, kd: report.kd });
      expect(row.info?.elo).toBeGreaterThan(0);
      expect(row.info?.sampleCount).toBeGreaterThan(0);
    }
    events.length = 0;
    const players = bootstrap.session.current!.players.slice(6, 8);
    const requestId = '00000000-0000-4000-8000-000000000001';
    expect(
      await runtime.api.invoke('session.query', { requestId, context: 'previous', players }),
    ).toMatchObject({
      requestId,
      queried: 2,
    });
    expect(events.filter((event) => event.type === 'roster').map((row) => row.player.id)).toEqual(
      players.map((player) => player.id),
    );
    expect(calls).toEqual(['app.bootstrap']);
    unsubscribe();
  });

  it('starts with repository fixtures and delegates their requests without generating demo data', async () => {
    const { runtime, calls, createVideo } = setup();
    expect(runtime.controls.getSnapshot().mode).toBe('captured');
    expect(await runtime.api.invoke('app.bootstrap', null)).toEqual(fixtureBootstrap);
    expect(await runtime.api.invoke('matches.list', {})).toEqual(capturedMatches);
    expect(createVideo).not.toHaveBeenCalled();
    expect(calls).toEqual(['app.bootstrap', 'matches.list']);
  });

  it('starts empty lists and keeps simulated mutations away from the captured service', async () => {
    const { runtime, calls } = setup();
    await runtime.controls.setMode('empty');
    const api = runtime.api;
    const bootstrap = await api.invoke('app.bootstrap', null);
    expect(bootstrap.session.lobbyPlayers).toEqual([]);
    expect(bootstrap.config.analyticsEnabled).toBe(false);
    expect(await api.invoke('matches.list', {})).toEqual([]);
    expect(await api.invoke('replays.list', null)).toEqual([]);
    expect(await api.invoke('accounts.list', null)).toEqual([]);
    const match = await api.invoke('matches.add', { fid: '9900007' });
    expect(match.fid).toBe('9900007');
    expect(await api.invoke('matches.list', {})).toHaveLength(1);
    expect(calls).toEqual(['app.bootstrap']);
    await runtime.controls.setMode('empty');
    expect(await runtime.api.invoke('matches.list', {})).toEqual([]);
  });

  it('provides replay and APM examples and advances only synthetic capture state', async () => {
    vi.useFakeTimers();
    const { runtime, calls } = setup();
    await runtime.controls.setMode('demo');
    const api = runtime.api,
      events: AppEvent[] = [];
    const unsubscribe = api.subscribe((event) => events.push(event));
    expect(await api.invoke('matches.list', {})).toHaveLength(72);
    expect(await api.invoke('replays.list', null)).toHaveLength(6);
    expect(await api.invoke('apm.history', null)).toHaveLength(2);
    runtime.controls.setRecording('recording');
    runtime.controls.setApm('active');
    vi.advanceTimersByTime(2000);
    const bootstrap = await api.invoke('app.bootstrap', null);
    expect(bootstrap.recording.seconds).toBe(2);
    expect(bootstrap.apm.durationSec).toBe(182);
    expect(bootstrap.apm.perSecond).toHaveLength(182);
    expect(events.some((event) => event.type === 'preview')).toBe(true);
    expect(events.filter((event) => event.type === 'apm')).toHaveLength(3);
    expect(events.map((event) => event.revision)).toEqual(
      [...events.map((event) => event.revision)].sort((a, b) => a - b),
    );
    runtime.controls.setRecording('idle');
    expect(await api.invoke('replays.list', null)).toHaveLength(7);
    runtime.controls.setApm('complete');
    expect((await api.invoke('app.bootstrap', null)).apm.status).toBe('complete');
    expect((await api.invoke('app.bootstrap', null)).apm.durationSec).toBe(182);
    expect(calls).toEqual(['app.bootstrap']);
    unsubscribe();
  });

  it('plays generated footage, deletes examples locally and restores them on reset', async () => {
    const { runtime, calls, createVideo } = setup();
    await runtime.controls.setMode('demo');
    const api = runtime.api,
      replays = await api.invoke('replays.list', null);
    expect(await api.invoke('replays.play', { name: replays[0]!.id })).toEqual({
      url: 'blob:development-preview',
    });
    await api.invoke('replays.play', { name: replays[1]!.id });
    expect(createVideo).toHaveBeenCalledTimes(1);
    await api.invoke('replays.delete', { name: replays[0]!.id });
    expect(await api.invoke('replays.list', null)).toHaveLength(5);
    await runtime.controls.setMode('demo');
    expect(await runtime.api.invoke('replays.list', null)).toHaveLength(6);
    expect(calls).toEqual(['app.bootstrap', 'app.bootstrap']);
  });

  it('rejects stale bridges and late responses after changing the scene', async () => {
    let resolve!: (matches: RpcOutputs['matches.list']) => void;
    const pending = new Promise<RpcOutputs['matches.list']>((done) => {
      resolve = done;
    });
    const { runtime, calls } = setup(() => pending);
    const oldApi = runtime.api;
    const request = oldApi.invoke('matches.list', {});
    await runtime.controls.setMode('empty');
    resolve(structuredClone(capturedMatches));
    await expect(request).rejects.toThrow('Development scene changed.');
    await expect(oldApi.invoke('config.update', { sidebarCollapsed: true })).rejects.toThrow(
      'Development scene changed.',
    );
    expect(await runtime.api.invoke('matches.list', {})).toEqual([]);
    expect(calls).toEqual(['matches.list', 'app.bootstrap']);
  });
});
