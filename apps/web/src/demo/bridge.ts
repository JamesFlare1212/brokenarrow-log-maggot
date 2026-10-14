import type {
  AppEvent,
  Bridge,
  Bootstrap,
  RpcInputs,
  RpcMethod,
  RpcOutputs,
  Match,
  PlayerReport,
  MiniInfo,
  Replay,
} from '@ba/contracts';
import { configSchema } from '@ba/contracts';
import { emptyMatch, emptyPlayer, determineOutcome, summarizeMaggot } from '@ba/shared';
const now = Date.now();
export const demoPlayers = Array.from({ length: 10 }, (_, i) => ({
  ...emptyPlayer(
    String(8863 + i),
    ['Zola', 'Luna', 'Arrow', 'Fox', 'Echo', 'Atlas', 'Nova', 'River', 'Orion', 'Pilot'][i] ||
      'Player',
  ),
  teamId: i < 5 ? (0 as const) : (1 as const),
  oldRating: 2100 + i * 42,
  newRating: 2100 + i * 42 + (i < 5 ? 14 : -14),
  destructionScore: 6500 + i * 400,
  lossesScore: 3800 + i * 150,
  objectivesCaptured: 2 + (i % 3),
  killed: 10 + i,
  damageDealt: 30000 + i * 1900,
  damageReceived: 23000 + i * 1100,
  dlRatio: 1.4,
  supplyPoints: 18000,
  exp: 3200 + i * 100,
  medals: 2,
}));
export function demoMatch(id: string, index = 0): Match {
  const m = emptyMatch(id, now - (index + 1) * 86400000 - 2700000);
  return {
    ...m,
    sessionId: 'demo-' + id,
    mapId: [22, 7, 9][index % 3] || 22,
    map: ['Ignalina Powerplant', 'Dam', 'Airport'][index % 3] || 'Dam',
    players: demoPlayers.map((p) => ({ ...p })),
    localPlayerId: '8863',
    localPersona: 'Zola',
    endedAt: now - (index + 1) * 86400000,
    durationSec: 2700,
    durationSource: 'api',
    mode: 'ranked',
    winnerTeamId: 0,
    outcome: 'win',
    eloBefore: 2100,
    eloAfter: 2114,
    source: 'api',
    updatedAt: now,
  };
}
export function demoReport(id: string): PlayerReport {
  const player = demoPlayers.find((p) => p.id === id) || demoPlayers[0]!,
    wins = 8;
  return {
    id,
    name: player.name,
    level: 40,
    fallback: false,
    matchCount: 64,
    elo: player.newRating,
    kd: 1.65,
    dmr: 1.34,
    winRate: 67,
    wins,
    losses: 4,
    updatedAt: now,
    stale: false,
    recentMatches: Array.from({ length: 12 }, (_, i) => ({
      matchId: String(8049993 - i),
      won: i % 3 !== 0,
      eloDelta: i % 3 !== 0 ? 14 : -12,
      kd: 1.5,
      dmr: 1.25,
      destruction: 8400,
      losses: 5100,
      objectives: 3,
      endTime: now - i * 86400000,
    })),
    favUnits: [
      { name: 'M1A2 Abrams', value: 184000, spawn: 52, roi: 1.8 },
      { name: 'Bradley', value: 86000, spawn: 64, roi: 1.4 },
      { name: 'AH-64', value: 68000, spawn: 30, roi: 1.6 },
    ],
    categories: [
      { key: 'Armor', pct: 43 },
      { key: 'Infantry', pct: 31 },
      { key: 'Support', pct: 18 },
    ],
    mapStats: [
      { mapId: 7, name: 'Dam', matchCount: 22, winRate: 68 },
      { mapId: 22, name: 'Ignalina Powerplant', matchCount: 18, winRate: 61 },
    ],
    style: 'Balanced',
  };
}
const mini = (id: string): MiniInfo => {
  const r = demoReport(id);
  return {
    elo: r.elo,
    kd: r.kd,
    winRate: r.winRate,
    matchCount: r.matchCount,
    category: r.categories[0]?.key || null,
    topUnits: r.favUnits.map((u) => u.name).join(', '),
    updatedAt: now,
    stale: false,
  };
};
export const demoBootstrap: Bootstrap = {
  revision: 0,
  config: configSchema.parse({
    logDir: 'C:\\Steam\\broken_arrow\\GameLogs',
    theme: 'dark',
    banCardVisible: true,
  }),
  session: {
    generation: 1,
    phase: 'match',
    localName: 'Zola',
    localPlayerId: '8863',
    accountKey: 'persona:Zola',
    loginSeen: true,
    localDeck: 'Armored push',
    lobbyId: '100',
    lobbyPlayers: [],
    current: { ...demoMatch('8050000'), startedAt: now - 600000, endedAt: null },
    recovering: false,
  },
  watcher: {
    dir: 'C:\\Steam\\broken_arrow\\GameLogs',
    file: 'Gamelog__2026_10_14.log',
    listening: true,
    recovering: false,
    error: null,
    live: true,
  },
  usage: { used24h: 38, limit24h: 400, attempts: 38 },
  recording: {
    phase: 'idle',
    sessionId: null,
    fid: null,
    map: '',
    sourceId: '',
    startedAt: null,
    seconds: 0,
    hasAudio: false,
    error: null,
  },
  apm: {
    status: 'disabled',
    totalActions: 0,
    durationSec: 0,
    apm: 0,
    peak: 0,
    perMinute: [],
    focused: false,
    fid: null,
  },
  health: { state: 'ok', at: now, checks: [] },
  version: {
    current: '4.0.0',
  },
  migration: { completed: true, imported: {}, warnings: [], backupDir: null },
  deckAlert: null,
};
async function demoVideo(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(10),
    recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }),
    chunks: Blob[] = [];
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onerror = () => reject(new Error('Demo media unavailable'));
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })));
    };
    let n = 0;
    const frame = () => {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#67e8f9';
      ctx.font = '24px sans-serif';
      ctx.fillText('Demo recording · local playback', 50, 90);
      ctx.fillStyle = '#34d399';
      ctx.fillRect(50 + n * 6, 180, 90, 20);
    };
    frame();
    recorder.start();
    const timer = setInterval(() => {
      n++;
      frame();
      if (n >= 20) {
        clearInterval(timer);
        recorder.stop();
      }
    }, 100);
  });
}
export function createDemoBridge(): Bridge {
  const state = structuredClone(demoBootstrap),
    listeners = new Set<(e: AppEvent) => void>();
  let matches = [demoMatch('8049993'), demoMatch('8049992', 1), demoMatch('8049991', 2)],
    replays: Replay[] = [
      {
        id: 'demo.webm',
        fid: '8049993',
        map: 'Ignalina Powerplant',
        uploaderId: '8863',
        uploaderName: 'Zola',
        teamId: 0,
        size: 284000000,
        createdAt: now - 86400000,
        durationSec: 2700,
        test: false,
      },
    ];
  const emit = (
    event: AppEvent extends infer E ? (E extends AppEvent ? Omit<E, 'revision'> : never) : never,
  ) => {
    const value = { ...event, revision: ++state.revision } as AppEvent;
    for (const listener of listeners) listener(value);
  };
  type Handlers = {
    [K in RpcMethod]: (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
  };
  const handlers: Handlers = {
    'app.bootstrap': () => structuredClone(state),
    'config.update': (patch) => {
      state.config = configSchema.parse({ ...state.config, ...patch });
      emit({ type: 'config', config: state.config });
      return state.config;
    },
    'directory.select': ({ kind }) => `C:\\Demo\\${kind}`,
    'directory.detect': () => state.config.logDir,
    'players.search': ({ query }) => ({
      players: demoPlayers
        .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.id.includes(query))
        .map((p) => ({ id: p.id, name: p.name, level: 40, rating: p.newRating })),
      source: 'local',
    }),
    'players.report': ({ id }) => demoReport(id),
    'players.maggot': async ({ id, requestId }) => {
      for (let done = 0; done <= 12; done++) {
        emit({ type: 'maggot', requestId, id, done, scanned: done, total: 12 });
        await new Promise((r) => setTimeout(r, 30));
      }
      return summarizeMaggot(
        id,
        Array.from({ length: 12 }, (_, i) => ({
          matchId: String(8049993 - i),
          won: i % 3 !== 0,
          mvpRank: 1 + (i % 3),
          killRank: 2,
          lossRank: 2,
          kdRank: 2,
          eloDelta: i % 3 !== 0 ? 14 : -12,
        })),
        13,
      );
    },
    'players.profile': ({ id }) => ({
      id,
      name: demoReport(id).name,
      names: [{ name: demoReport(id).name, firstSeen: now - 30 * 86400000, lastSeen: now }],
      firstSeen: now - 30 * 86400000,
      lastSeen: now,
      encounters: matches.map((m) => ({
        matchId: m.id,
        at: m.endedAt,
        map: m.map,
        relation: 'same',
        won: true,
        custom: false,
      })),
      banned: null,
      recentMatches: matches.map((m) => {
        const r = determineOutcome(m.players, id, m.mode, m.winnerTeamId);
        return {
          ...m,
          localPlayerId: id,
          outcome: r.outcome,
          eloBefore: r.before,
          eloAfter: r.after,
        };
      }),
      recentError: null,
      latestElo: demoReport(id).elo,
      info: mini(id),
    }),
    'session.query': async (input) => {
      const players =
        input.context === 'previous' ? input.players || [] : state.session.current?.players || [];
      for (const player of players) {
        await new Promise((r) => setTimeout(r, 20));
        emit({
          type: 'roster',
          context: input.context,
          requestId: input.requestId,
          generation: state.session.generation,
          player,
          info: mini(player.id),
          error: null,
        });
      }
      return { requestId: input.requestId, queried: players.length, skipped: 0, cancelled: false };
    },
    'matches.list': () => matches,
    'matches.detail': ({ fid }) => matches.find((m) => m.fid === fid) || demoMatch(fid),
    'matches.add': ({ fid }) => {
      const m = demoMatch(fid);
      matches = [m, ...matches];
      emit({ type: 'matches' });
      return m;
    },
    'matches.delete': ({ id }) => {
      matches = matches.filter((m) => m.id !== id);
      emit({ type: 'matches' });
      return { removed: true };
    },
    'bans.list': () => [
      {
        id: '9000',
        name: 'Demo player',
        steamId: '',
        rating: 2200,
        firstSeenAt: now,
        lastSeenAt: now,
        encountered: true,
      },
    ],
    'bans.sync': () => {
      const list = [
        {
          id: '9000',
          name: 'Demo player',
          steamId: '',
          rating: 2200,
          firstSeenAt: now,
          lastSeenAt: now,
          encountered: true,
        },
      ];
      emit({ type: 'bans', list, newly: list });
      return list;
    },
    'accounts.list': () => [
      {
        id: '8863',
        name: 'Zola',
        persona: 'Zola',
        firstSeen: now,
        lastSeen: now,
        matchCount: matches.length,
      },
    ],
    'accounts.delete': () => ({ removedMatches: 0 }),
    'decks.list': () => ({
      found: true,
      decksDir: 'C:\\Demo\\Decks',
      backupsDir: 'C:\\Demo\\DeckBackups',
      decks: [
        { name: 'Armored push.dek', size: 6000, modifiedAt: now },
        { name: 'Infantry support.dek', size: 4300, modifiedAt: now - 1000 },
      ],
      backups: [{ name: '上一局卡组包.zip', size: 10000, modifiedAt: now }],
    }),
    'decks.backup': ({ packageName }) => ({ name: packageName }),
    'decks.deploy': () => ({ deployed: 2 }),
    'decks.delete': ({ names }) => ({ removed: names.length }),
    'decks.open': () => null,
    'decks.switch': () => null,
    'replays.list': () => replays,
    'replays.directory': () => ({ dir: 'C:\\Demo\\replays', count: replays.length }),
    'replays.delete': ({ name }) => {
      replays = replays.filter((r) => r.id !== name);
      emit({ type: 'replays' });
      return { removed: true };
    },
    'replays.clean': () => {
      const removed = replays.length;
      replays = [];
      emit({ type: 'replays' });
      return { removed };
    },
    'replays.open': () => null,
    'replays.play': async () => ({ url: await demoVideo() }),
    'replays.move': () => ({ moved: 1, failed: [] }),
    'replays.test': () => null,
    'displays.list': () => [{ id: 'screen:0:0', label: 'Display 1 · 1920×1080', thumbnail: '' }],
    'displays.thumbnail': () => null,
    'api.health': () => state.health,
    'external.open': () => null,
  };
  return {
    invoke: async <K extends RpcMethod>(method: K, input: RpcInputs[K]) => {
      const run = handlers[method] as (
        input: RpcInputs[K],
      ) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
      return structuredClone(await run(input));
    },
    subscribe: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
