import { browserFixtureAccess, rpcSchemas } from '@ba/contracts';
import type {
  AppEvent,
  Bridge,
  Player,
  RpcInputs,
  RpcMethod,
  RpcOutputs,
  Session,
} from '@ba/contracts';
import { loadDevelopmentData, developmentPreview, type DevelopmentData } from './data';
import { createDevelopmentVideo } from './media';
import { previewCacheStats, previewEvent, previewResponse } from './cache-preview';

export type DevelopmentMode = 'captured' | 'empty' | 'demo';
export type DevelopmentRecording = 'idle' | 'recording' | 'error';
export const developmentLobbyPlayerCounts = [1, 2, 3, 4, 5] as const;
export type DevelopmentLobbyPlayerCount = (typeof developmentLobbyPlayerCounts)[number];
export interface DevelopmentSnapshot {
  locale: 'zh' | 'en';
  mode: DevelopmentMode;
  generation: number;
  pending: boolean;
  recording: DevelopmentRecording;
  lobbyPlayerCount: DevelopmentLobbyPlayerCount | null;
  hasLobbyRoster: boolean;
  cacheExpiryEnabled: boolean;
}
type WithoutRevision<T> = T extends unknown ? Omit<T, 'revision'> : never;
type Handlers = {
  [K in RpcMethod]?: (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
};

export function createDevelopmentRuntime(
  base: Bridge,
  options: { now?: () => number; createVideo?: () => Promise<string> } = {},
) {
  const now = options.now ?? Date.now;
  const createVideo = options.createVideo ?? createDevelopmentVideo;
  let snapshot: DevelopmentSnapshot = {
    locale: 'zh',
    mode: 'captured',
    generation: 0,
    pending: false,
    recording: 'idle',
    lobbyPlayerCount: null,
    hasLobbyRoster: false,
    cacheExpiryEnabled: false,
  };
  let local: DevelopmentData | null = null;
  let demoSession: Session | null = null;
  let rosterHydrated = false;
  let clock: ReturnType<typeof setInterval> | undefined;
  let video: Promise<string> | null = null;
  let cacheAfterClear: RpcOutputs['cache.stats'] | null = null;
  const cacheUsage = () => cacheAfterClear ?? local?.cache ?? base.invoke('cache.stats', null);
  let capturedRevision = 0;
  let capturedOffset = 0;
  type RosterEvent = Extract<AppEvent, { type: 'roster' }>;
  const rosters = {
    current: new Map<string, RosterEvent>(),
    previous: new Map<string, RosterEvent>(),
  };
  const rememberRoster = (event: AppEvent) => {
    if (event.type !== 'roster') return;
    const rows = rosters[event.context];
    const first = rows.values().next().value;
    if (first && (first.requestId !== event.requestId || first.generation !== event.generation))
      rows.clear();
    rows.set(event.player.id, event);
  };
  const observers = new Set<() => void>();
  const listeners = new Set<{ generation: number; callback: (event: AppEvent) => void }>();
  const data = () => {
    if (!local) throw new Error('Development scene is not initialized.');
    return local;
  };
  const publish = (patch: Partial<DevelopmentSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    observers.forEach((listener) => listener());
  };
  const notifyEvent = (value: AppEvent) => {
    listeners.forEach((listener) => {
      if (listener.generation === snapshot.generation)
        listener.callback(previewEvent(value, snapshot.cacheExpiryEnabled));
    });
  };
  const emit = (event: WithoutRevision<AppEvent>) => {
    const value = { ...event, revision: ++data().bootstrap.revision } as AppEvent;
    rememberRoster(value);
    notifyEvent(value);
  };
  const stopClock = () => {
    clearInterval(clock);
    clock = undefined;
  };
  const finishRecording = () => {
    const scene = data(),
      recording = scene.bootstrap.recording;
    if (recording.phase === 'recording') {
      scene.replays.unshift({
        id: `development-test-${now()}.webm`,
        fid: recording.fid,
        map: recording.map || 'Development recording',
        uploaderId: scene.bootstrap.session.localPlayerId,
        uploaderName: scene.bootstrap.session.localName || 'Development',
        teamId:
          scene.bootstrap.session.current?.players.find(
            (player) => player.id === scene.bootstrap.session.localPlayerId,
          )?.teamId ?? null,
        size: 2_000_000,
        createdAt: now(),
        durationSec: recording.seconds,
        test: true,
      });
      emit({ type: 'replays' });
    }
    scene.bootstrap.recording = { ...recording, phase: 'idle', sessionId: null, error: null };
    emit({ type: 'recording', recording: scene.bootstrap.recording });
    publish({ recording: 'idle' });
  };
  const ensureClock = () => {
    if (!local || local.bootstrap.recording.phase !== 'recording') {
      stopClock();
      return;
    }
    if (clock) return;
    clock = setInterval(() => {
      if (!local) return;
      const state = local.bootstrap;
      if (state.recording.phase === 'recording') {
        state.recording = { ...state.recording, seconds: state.recording.seconds + 1 };
        emit({ type: 'recording', recording: state.recording });
        emit({
          type: 'preview',
          sessionId: state.recording.sessionId!,
          dataUrl: developmentPreview,
          hasAudio: false,
        });
        if (state.recording.seconds >= 60) finishRecording();
      }
      ensureClock();
    }, 1000);
  };
  const setRecording = (phase: DevelopmentRecording) => {
    if (snapshot.mode === 'captured') return;
    if (phase === 'idle') {
      finishRecording();
      ensureClock();
      return;
    }
    const state = data().bootstrap;
    state.config = { ...state.config, replayEnabled: true };
    state.recording = {
      phase,
      sessionId: 'development-recording',
      fid: state.session.current?.fid ?? null,
      map: state.session.current?.map ?? '',
      sourceId: 'development-display',
      startedAt: now(),
      seconds: 0,
      hasAudio: false,
      error: phase === 'error' ? 'Development recording error' : null,
    };
    emit({ type: 'config', config: state.config });
    emit({ type: 'recording', recording: state.recording });
    if (phase === 'recording')
      emit({
        type: 'preview',
        sessionId: 'development-recording',
        dataUrl: developmentPreview,
        hasAudio: false,
      });
    publish({ recording: phase });
    ensureClock();
  };
  const publishRoster = (context: 'current' | 'previous', players: Player[], requestId: string) => {
    for (const player of players) {
      const report = data().reports[player.id];
      emit({
        type: 'roster',
        requestId,
        context,
        generation: data().bootstrap.session.generation,
        player,
        info: report
          ? {
              name: report.name,
              elo: report.elo,
              kd: report.kd,
              winRate: report.winRate,
              matchCount: report.matchCount,
              sampleCount: report.sampleCount,
              fallback: report.fallback,
              category: report.categories[0]?.key ?? null,
              topUnits: report.favUnits.map((unit) => unit.name).join(', '),
              updatedAt: report.updatedAt,
              stale: report.stale,
            }
          : null,
        error: null,
      });
    }
  };
  const setLobbyPlayerCount = (count: DevelopmentLobbyPlayerCount | null) => {
    if (snapshot.mode !== 'demo' || snapshot.pending || !demoSession?.current) return;
    const scene = data();
    const session = structuredClone(demoSession);
    session.generation = scene.bootstrap.session.generation + 1;
    if (count !== null) {
      session.phase = 'lobby';
      session.current = null;
      session.localDeck = '';
      session.lobbyPlayers = session.lobbyPlayers
        .slice(0, count)
        .map(({ id, name }) => ({ id, name, teamId: null }));
    }
    scene.bootstrap.session = session;
    emit({ type: 'session', session });
    if (scene.bootstrap.config.autoQueryCurrentMatch)
      publishRoster(
        'current',
        session.current?.players ?? session.lobbyPlayers,
        `development-session-${session.generation}`,
      );
    publish({ lobbyPlayerCount: count });
  };
  const requireSceneMatch = (fid: string) => {
    if (snapshot.mode === 'empty' && !data().matches.some((match) => match.fid === fid))
      throw new Error('Match is not in this scene.');
  };
  const handlers: Handlers = {
    'external.open': (input) => base.invoke('external.open', input),
    'app.bootstrap': () => {
      const bootstrap = structuredClone(data().bootstrap);
      if (!rosterHydrated && bootstrap.config.autoQueryCurrentMatch) {
        rosterHydrated = true;
        const generation = snapshot.generation;
        queueMicrotask(() => {
          if (
            snapshot.generation !== generation ||
            data().bootstrap.session.generation !== bootstrap.session.generation
          )
            return;
          publishRoster(
            'current',
            bootstrap.session.current?.players ?? bootstrap.session.lobbyPlayers,
            'development-initial-roster',
          );
        });
      }
      return bootstrap;
    },
    'config.update': (patch) => {
      const state = data().bootstrap;
      state.config = { ...state.config, ...patch };
      if (patch.replayEnabled === false) finishRecording();
      emit({ type: 'config', config: state.config });
      ensureClock();
      return state.config;
    },
    'matches.list': (input) =>
      data().matches.filter((match) => !input.accountId || match.localPlayerId === input.accountId),
    'matches.detail': (input) => {
      requireSceneMatch(input.fid);
      return base.invoke('matches.detail', input);
    },
    'matches.timeline': (input) => {
      requireSceneMatch(input.fid);
      return base.invoke('matches.timeline', input);
    },
    'matches.local': ({ id }) => {
      const match = data().matches.find((match) => match.id === id);
      if (!match) throw new Error('Local match not found');
      return match;
    },
    'matches.scan': () => null,
    'matches.add': async (input) => {
      const scene = data(),
        existing = scene.matches.find((match) => match.fid === input.fid);
      if (existing) return existing;
      const match = await base.invoke('matches.detail', { fid: input.fid, force: true });
      if (local !== scene) throw new Error('Development scene changed.');
      if (!scene.matches.some((row) => row.fid === match.fid)) scene.matches.unshift(match);
      emit({ type: 'matches' });
      return match;
    },
    'matches.delete': (input) => {
      const scene = data(),
        before = scene.matches.length;
      scene.matches = scene.matches.filter((match) => match.id !== input.id);
      emit({ type: 'matches' });
      return { removed: before !== scene.matches.length };
    },
    'accounts.list': () => data().accounts,
    'accounts.delete': (input) => {
      const scene = data(),
        before = scene.matches.length;
      scene.accounts = scene.accounts.filter((account) => account.id !== input.id);
      scene.matches = scene.matches.filter((match) => match.localPlayerId !== input.id);
      emit({ type: 'matches' });
      return { removedMatches: before - scene.matches.length };
    },
    'players.search': (input) =>
      snapshot.mode === 'empty'
        ? { source: 'local', players: [] }
        : base.invoke('players.search', input),
    'players.report': (input) =>
      (!input.force && data().reports[input.id]) || base.invoke('players.report', input),
    'players.profile': (input) => base.invoke('players.profile', input),
    'players.maggot': (input) => base.invoke('players.maggot', input),
    'session.query': async (input) => {
      const scene = data();
      const session = scene.bootstrap.session;
      const players =
        input.context === 'previous'
          ? (input.players ?? scene.matches.find((match) => match.fid === input.fid)?.players ?? [])
          : (session.current?.players ?? session.lobbyPlayers);
      const unique = [
        ...new Map(
          players
            .filter((player) => /^[1-9]\d*$/.test(player.id) && player.teamId !== 100)
            .map((player) => [player.id, player]),
        ).values(),
      ];
      const missing = unique.filter((player) => !scene.reports[player.id]);
      const results = await Promise.allSettled(
        missing.map((player) => base.invoke('players.report', { id: player.id })),
      );
      const cancelled =
        local !== scene || (input.context === 'current' && session !== scene.bootstrap.session);
      if (!cancelled) {
        for (const result of results)
          if (result.status === 'fulfilled') scene.reports[result.value.id] = result.value;
        publishRoster(input.context, unique, input.requestId);
      }
      return {
        requestId: input.requestId,
        queried: cancelled ? 0 : unique.filter((p) => scene.reports[p.id]).length,
        skipped: players.length - unique.length,
        cancelled,
      };
    },
    'bans.list': (input) => data().bans.filter((ban) => !input.metOnly || ban.encountered),
    'bans.sync': () => data().bans,
    'replays.list': () => data().replays,
    'replays.directory': () => ({
      dir: data().bootstrap.config.replaySaveDir,
      count: data().replays.length,
    }),
    'replays.delete': (input) => {
      const scene = data(),
        before = scene.replays.length;
      scene.replays = scene.replays.filter((replay) => replay.id !== input.name);
      emit({ type: 'replays' });
      return { removed: before !== scene.replays.length };
    },
    'replays.clean': (input) => {
      const scene = data(),
        before = scene.replays.length;
      scene.replays = scene.replays.filter(
        (replay) => input.days > 0 && replay.createdAt >= now() - input.days * 86400000,
      );
      emit({ type: 'replays' });
      return { removed: before - scene.replays.length };
    },
    'replays.play': async (input) => {
      if (!data().replays.some((replay) => replay.id === input.name))
        throw new Error('Development replay not found.');
      video ??= createVideo().catch((error) => {
        video = null;
        throw error;
      });
      return { url: await video };
    },
    'replays.test': () => {
      setRecording('recording');
      return null;
    },
    'replays.move': () => ({ moved: data().replays.length, failed: [] }),
    'displays.list': () => [
      {
        id: 'development-display',
        label: 'Development display · 1920 × 1080',
        thumbnail: developmentPreview,
      },
    ],
    'displays.thumbnail': () => (snapshot.mode === 'empty' ? null : developmentPreview),
    'directory.select': (input) =>
      `C:/Development/${input.kind === 'logs' ? 'GameLogs' : input.kind === 'decks' ? 'Decks' : 'Recordings'}`,
    'directory.detect': () => 'C:/Development/GameLogs',
    'decks.list': () => data().decks,
    'cache.stats': async () => previewCacheStats(await cacheUsage(), snapshot.cacheExpiryEnabled),
    'cache.clear': async ({ mode }) => {
      const generation = snapshot.generation;
      const stats = previewCacheStats(await cacheUsage(), snapshot.cacheExpiryEnabled);
      if (generation !== snapshot.generation) throw new Error('Development scene changed.');
      let removed = 0;
      for (const usage of Object.values(stats)) {
        const count = mode === 'all' ? usage.entries : usage.expired;
        if (count === 0) continue;
        usage.bytes = Math.round((usage.bytes * (usage.entries - count)) / usage.entries);
        usage.entries -= count;
        usage.expired = 0;
        removed += count;
      }
      if (removed) cacheAfterClear = stats;
      return { removed, stats };
    },
    'api.health': () => data().bootstrap.health,
    'updates.check': () => data().bootstrap.updates,
    'diagnostics.report': () => null,
  };
  const createBridge = (): Bridge => {
    const generation = snapshot.generation;
    return {
      async invoke<K extends RpcMethod>(method: K, input: RpcInputs[K]): Promise<RpcOutputs[K]> {
        if (generation !== snapshot.generation) throw new Error('Development scene changed.');
        const mode = snapshot.mode;
        const offset = capturedOffset;
        const handler = handlers[method] as
          ((value: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>) | undefined;
        if (mode !== 'captured' && !handler)
          throw new Error('This native operation is unavailable in the development preview.');
        const result =
          mode === 'captured' && method !== 'cache.stats' && method !== 'cache.clear'
            ? await base.invoke(method, input)
            : await handler!(rpcSchemas[method].parse(input) as RpcInputs[K]);
        if (generation !== snapshot.generation) throw new Error('Development scene changed.');
        if (method === 'app.bootstrap') {
          const bootstrap = result as RpcOutputs['app.bootstrap'];
          if (mode === 'captured')
            capturedRevision = Math.max(capturedRevision, bootstrap.revision);
          const locale = bootstrap.config.lang;
          if (locale !== snapshot.locale) publish({ locale });
        } else if (method === 'config.update') {
          const locale = (result as RpcOutputs['config.update']).lang;
          if (locale !== snapshot.locale) publish({ locale });
        }
        const value = previewResponse(method, result, snapshot.cacheExpiryEnabled);
        if (mode === 'captured' && method === 'app.bootstrap')
          (value as RpcOutputs['app.bootstrap']).revision += offset;
        return value;
      },
      subscribe(callback) {
        const listener = { generation, callback };
        listeners.add(listener);
        const unsubscribe = base.subscribe((event) => {
          if (generation === snapshot.generation && snapshot.mode === 'captured') {
            if (event.type === 'config' && event.config.lang !== snapshot.locale)
              publish({ locale: event.config.lang });
            capturedRevision = Math.max(capturedRevision, event.revision);
            rememberRoster(event);
            callback(
              previewEvent(
                { ...event, revision: event.revision + capturedOffset },
                snapshot.cacheExpiryEnabled,
              ),
            );
          }
        });
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      },
    };
  };
  const capturedAccess = {
    ...browserFixtureAccess,
    method: (method: RpcMethod) =>
      method === 'external.open' || browserFixtureAccess.method(method),
  };
  const simulatedAccess = {
    method: (method: RpcMethod) => Object.hasOwn(handlers, method),
    preference: () => true,
  };
  let api = createBridge();
  let bootstrapApi = api;
  return {
    get bootstrapApi() {
      return bootstrapApi;
    },
    get access() {
      return snapshot.mode === 'captured' ? capturedAccess : simulatedAccess;
    },
    get api() {
      return api;
    },
    controls: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        observers.add(listener);
        return () => {
          observers.delete(listener);
        };
      },
      async setMode(mode: DevelopmentMode) {
        if (snapshot.pending) return;
        publish({ pending: true });
        try {
          const baseState = await base.invoke('app.bootstrap', null);
          const next =
            mode === 'captured'
              ? null
              : await loadDevelopmentData(base, baseState, mode === 'empty', now());
          stopClock();
          local = next;
          demoSession = mode === 'demo' ? structuredClone(local!.bootstrap.session) : null;
          rosterHydrated = false;
          cacheAfterClear = null;
          capturedOffset = 0;
          capturedRevision = 0;
          rosters.current.clear();
          rosters.previous.clear();
          snapshot = {
            cacheExpiryEnabled: snapshot.cacheExpiryEnabled,
            locale: baseState.config.lang,
            mode,
            generation: snapshot.generation + 1,
            pending: false,
            recording: 'idle',
            lobbyPlayerCount: null,
            hasLobbyRoster: !!demoSession?.current,
          };
          bootstrapApi = api = createBridge();
          observers.forEach((listener) => listener());
        } catch (error) {
          publish({ pending: false });
          throw error;
        }
      },
      setCacheExpiryEnabled(enabled: boolean) {
        if (snapshot.pending || snapshot.cacheExpiryEnabled === enabled) return;
        api = createBridge();
        publish({ cacheExpiryEnabled: enabled });
        for (const rows of Object.values(rosters)) {
          for (const event of rows.values()) {
            if (!event.info) continue;
            const revision = local
              ? ++local.bootstrap.revision
              : capturedRevision + ++capturedOffset;
            notifyEvent({ ...event, revision });
          }
        }
      },
      setRecording,
      setLobbyPlayerCount,
    },
    dispose() {
      stopClock();
      if (video) void video.then((url) => URL.revokeObjectURL(url)).catch(() => {});
      video = null;
    },
  };
}
export type DevelopmentRuntime = ReturnType<typeof createDevelopmentRuntime>;
