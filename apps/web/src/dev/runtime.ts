import { rpcSchemas } from '@ba/contracts';
import type {
  AppEvent,
  Bridge,
  Player,
  PlayerReport,
  RpcInputs,
  RpcMethod,
  RpcOutputs,
  Session,
} from '@ba/contracts';
import { createDevelopmentData, developmentPreview, type DevelopmentData } from './data';
import { createDevelopmentVideo } from './media';

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
}
type WithoutRevision<T> = T extends unknown ? Omit<T, 'revision'> : never;
type Handlers = {
  [K in RpcMethod]?: (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
};

/** Scene overrides live only in this browser tab; captured fixtures remain untouched. */
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
  };
  let local: DevelopmentData | null = null;
  let demoSession: Session | null = null;
  let rosterHydrated = false;
  let clock: ReturnType<typeof setInterval> | undefined;
  let video: Promise<string> | null = null;
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
  const emit = (event: WithoutRevision<AppEvent>) => {
    const value = { ...event, revision: ++data().bootstrap.revision } as AppEvent;
    listeners.forEach((listener) => {
      if (listener.generation === snapshot.generation) listener.callback(structuredClone(value));
    });
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
        teamId: 0,
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
      fid: data().matches[0]?.fid ?? null,
      map: 'Dam',
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
  const reportFor = (id: string): PlayerReport =>
    data().reports[id] ?? {
      id,
      name: data().bans.find((ban) => ban.id === id)?.name ?? `Development player #${id}`,
      level: 1,
      fallback: false,
      matchCount: 0,
      sampleCount: 0,
      elo: null,
      kd: null,
      dmr: null,
      winRate: null,
      wins: 0,
      losses: 0,
      updatedAt: now(),
      stale: false,
      ratingTrend: [],
      recentMatches: [],
      favUnits: [],
      categories: [],
      mapStats: [],
      style: null,
    };
  const publishRoster = (context: 'current' | 'previous', players: Player[], requestId: string) => {
    for (const player of players) {
      const report = reportFor(player.id);
      emit({
        type: 'roster',
        requestId,
        context,
        generation: data().bootstrap.session.generation,
        player,
        info: {
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
        },
        error: null,
      });
    }
  };
  const setLobbyPlayerCount = (count: DevelopmentLobbyPlayerCount | null) => {
    if (snapshot.mode !== 'demo' || snapshot.pending || !demoSession) return;
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
  const handlers: Handlers = {
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
      const match = data().matches.find((match) => match.fid === input.fid);
      if (!match) throw new Error('Development match not found.');
      return match;
    },
    'matches.scan': () => null,
    'matches.add': (input) => {
      const scene = data(),
        existing = scene.matches.find((match) => match.fid === input.fid);
      if (existing) return existing;
      const match = {
        ...createDevelopmentData(scene.bootstrap, false, now()).matches[0]!,
        id: `development-added-${input.fid}`,
        fid: input.fid,
      };
      scene.matches.unshift(match);
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
    'players.search': (input) => ({
      source: 'local',
      players: data().players.filter((player) =>
        `${player.name} ${player.id}`.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()),
      ),
    }),
    'players.report': (input) => reportFor(input.id),
    'players.profile': (input) => {
      const scene = data(),
        report = reportFor(input.id);
      return {
        id: input.id,
        name: report.name,
        names: [],
        firstSeen: now() - 86400000,
        lastSeen: now(),
        encounters: [],
        banned: scene.bans.find((ban) => ban.id === input.id) ?? null,
        recentMatches: scene.matches
          .filter((match) => match.players.some((player) => player.id === input.id))
          .slice(0, 6),
        recentError: null,
        latestElo: report.elo,
        info: {
          name: report.name,
          elo: report.elo,
          kd: report.kd,
          winRate: report.winRate,
          matchCount: report.matchCount,
          sampleCount: report.sampleCount,
          category: null,
          topUnits: 'M1A2 Abrams',
          updatedAt: now(),
          stale: false,
        },
      };
    },
    'players.maggot': (input) => ({
      id: input.id,
      complete: true,
      index: 0.55,
      averageRank: 3,
      trend: 'flat',
      rows: [],
      calls: 0,
      warning: null,
    }),
    'session.query': (input) => {
      const scene = data(),
        requestId = input.requestId ?? `development-roster-${scene.bootstrap.revision}`;
      const players =
        input.context === 'previous'
          ? (input.players ?? scene.matches.find((match) => match.fid === input.fid)?.players ?? [])
          : (scene.bootstrap.session.current?.players ?? scene.bootstrap.session.lobbyPlayers);
      publishRoster(input.context, players, requestId);
      return { requestId, queried: players.length, skipped: 0, cancelled: false };
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
    'cache.stats': () => data().cache,
    'cache.clear': (input) => {
      const scene = data();
      let removed = 0;
      for (const usage of Object.values(scene.cache)) {
        const count = input.mode === 'all' ? usage.entries : usage.expired;
        removed += count;
        usage.bytes = usage.entries
          ? Math.round((usage.bytes * (usage.entries - count)) / usage.entries)
          : 0;
        usage.entries -= count;
        usage.expired = 0;
      }
      return { removed, stats: scene.cache };
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
        const handler = handlers[method] as
          ((value: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>) | undefined;
        if (mode !== 'captured' && !handler)
          throw new Error('This native operation is unavailable in the development preview.');
        const result =
          mode === 'captured'
            ? await base.invoke(method, input)
            : await handler!(rpcSchemas[method].parse(input) as RpcInputs[K]);
        if (generation !== snapshot.generation) throw new Error('Development scene changed.');
        if (method === 'app.bootstrap') {
          const locale = (result as RpcOutputs['app.bootstrap']).config.lang;
          if (locale !== snapshot.locale) publish({ locale });
        } else if (method === 'config.update') {
          const locale = (result as RpcOutputs['config.update']).lang;
          if (locale !== snapshot.locale) publish({ locale });
        }
        return structuredClone(result);
      },
      subscribe(callback) {
        const listener = { generation, callback };
        listeners.add(listener);
        const unsubscribe = base.subscribe((event) => {
          if (generation === snapshot.generation && snapshot.mode === 'captured') {
            if (event.type === 'config' && event.config.lang !== snapshot.locale)
              publish({ locale: event.config.lang });
            callback(event);
          }
        });
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      },
    };
  };
  let api = createBridge();
  return {
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
          stopClock();
          local =
            mode === 'captured' ? null : createDevelopmentData(baseState, mode === 'empty', now());
          demoSession = mode === 'demo' ? structuredClone(local!.bootstrap.session) : null;
          rosterHydrated = false;
          snapshot = {
            locale: baseState.config.lang,
            mode,
            generation: snapshot.generation + 1,
            pending: false,
            recording: 'idle',
            lobbyPlayerCount: null,
          };
          api = createBridge();
          observers.forEach((listener) => listener());
        } catch (error) {
          publish({ pending: false });
          throw error;
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
