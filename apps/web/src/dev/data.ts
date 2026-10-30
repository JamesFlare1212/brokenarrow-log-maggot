import type {
  Account,
  Ban,
  Bootstrap,
  CacheStats,
  DeckList,
  Match,
  MatchPlayer,
  PlayerReport,
  Replay,
  SearchPlayer,
} from '@ba/contracts';

export const developmentPreview = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#152522"/><path d="M0 80H640M0 160H640M0 240H640M0 320H640M80 0V360M160 0V360M240 0V360M320 0V360M400 0V360M480 0V360M560 0V360" stroke="#263c35"/><path d="M0 280Q200 80 640 200" fill="none" stroke="#376171" stroke-width="45"/><g fill="#60a5fa"><circle cx="160" cy="130" r="10"/><circle cx="215" cy="245" r="10"/><circle cx="290" cy="140" r="10"/></g><g fill="#fb7185"><circle cx="440" cy="85" r="10"/><circle cx="470" cy="240" r="10"/><circle cx="530" cy="150" r="10"/></g><text x="24" y="36" fill="#ecfdf5" font-family="sans-serif" font-size="18">Broken Arrow · Development preview</text></svg>')}`;

export interface DevelopmentData {
  bootstrap: Bootstrap;
  matches: Match[];
  players: SearchPlayer[];
  reports: Record<string, PlayerReport>;
  accounts: Account[];
  bans: Ban[];
  replays: Replay[];
  decks: DeckList;
  cache: CacheStats;
}

export function createDevelopmentData(
  base: Bootstrap,
  empty: boolean,
  now: number,
): DevelopmentData {
  const names = [
    'Raven',
    'Kodiak',
    'Viper',
    'Falcon',
    'Atlas',
    'Orion',
    'Wolf',
    'Sable',
    'Nova',
    'Hawk',
  ];
  const players: MatchPlayer[] = names.map((name, index) => ({
    id: String(9900 + index),
    name,
    teamId: index < 5 ? 0 : 1,
    oldRating: 1500 + index * 73,
    newRating: 1520 + index * 71,
    destructionScore: 2500 + index * 850,
    lossesScore: 1800 + index * 420,
    objectivesCaptured: index % 4,
    killed: 8 + index * 2,
    damageDealt: 20000 + index * 4000,
    damageReceived: 15000 + index * 1800,
    dlRatio: (2500 + index * 850) / (1800 + index * 420),
    supplyPoints: index * 350,
    exp: 1200 + index * 480,
    medals: index % 3,
  }));
  const matches: Match[] = empty
    ? []
    : Array.from({ length: 72 }, (_, index) => ({
        id: `development-match-${index}`,
        fid: String(9900000 + index),
        sessionId: `development-session-${index}`,
        mapId: index % 6,
        map: ['Dam', 'Coast', 'Airport', 'Suwalki', 'Oil refinery', 'Central Village'][index % 6]!,
        scenario: 'Development match',
        startedAt: now - index * 86400000 - 2100000,
        endedAt: now - index * 86400000,
        durationSec: 2100 + (index % 5) * 120,
        durationSource: 'log',
        localDeck: 'Development deck',
        points: 5000,
        players: structuredClone(players),
        mode: index % 4 === 0 ? 'custom' : 'ranked',
        winnerTeamId: index % 3 === 0 ? 1 : 0,
        localPlayerId: players[0]!.id,
        localPersona: players[0]!.name,
        outcome: index % 7 === 0 ? 'unknown' : index % 3 === 0 ? 'loss' : 'win',
        eloBefore: 1500 + index * 5,
        eloAfter: 1500 + index * 5 + (index % 3 === 0 ? -14 : 18),
        restarted: false,
        source: 'log',
        updatedAt: now,
      }));
  const accounts: Account[] = empty
    ? []
    : [
        {
          id: players[0]!.id,
          name: players[0]!.name,
          persona: players[0]!.name,
          firstSeen: now - 90 * 86400000,
          lastSeen: now,
          matchCount: matches.length,
        },
      ];
  const reports: Record<string, PlayerReport> = {};
  if (!empty)
    for (const [index, player] of players.entries())
      reports[player.id] = {
        id: player.id,
        name: player.name,
        level: 20 + index,
        fallback: false,
        matchCount: 120 + index * 25,
        sampleCount: 12,
        elo: player.newRating,
        kd: 1.2 + index / 10,
        dmr: 1.4 + index / 12,
        winRate: 58,
        wins: 7,
        losses: 5,
        updatedAt: now,
        stale: false,
        ratingTrend: matches
          .slice(0, 30)
          .reverse()
          .map((match) => {
            const matchPlayer = match.players.find((entry) => entry.id === player.id);
            return {
              matchId: match.fid!,
              endTime: match.endedAt,
              ratingBefore: matchPlayer?.oldRating ?? null,
              ratingAfter: matchPlayer?.newRating ?? null,
            };
          }),
        recentMatches: matches.slice(0, 12).map((match, i) => ({
          matchId: match.fid!,
          won: i % 3 !== 0,
          eloDelta: i % 3 === 0 ? -14 : 18,
          kd: 1.2 + i / 10,
          dmr: 1.5,
          destruction: 4000 + i * 400,
          losses: 2400 + i * 200,
          objectives: i % 4,
          endTime: match.endedAt,
        })),
        favUnits: [
          { name: 'M1A2 Abrams', value: 3200, spawn: 12, roi: 1.8 },
          { name: 'AH-64 Apache', value: 2100, spawn: 8, roi: 1.4 },
        ],
        categories: [
          { key: 'armor', pct: 42 },
          { key: 'infantry', pct: 31 },
        ],
        mapStats: [
          {
            mapId: 1,
            name: 'Dam',
            matchCount: 24,
            winRate: 62,
            avgKd: 1.5,
            avgDestructionScore: 5400,
          },
        ],
        style: null,
      };
  const bootstrap = structuredClone(base);
  bootstrap.revision = 0;
  bootstrap.config = {
    ...bootstrap.config,
    analyticsEnabled: false,
    analyticsChoiceSaved: true,
    autoQueryCurrentMatch: !empty,
    replayEnabled: !empty,
    hiddenPanels: [],
    logDir: 'C:/Development/GameLogs',
    replaySaveDir: 'C:/Development/Recordings',
  };
  bootstrap.session = {
    ...bootstrap.session,
    generation: 1,
    phase: empty ? 'idle' : 'match',
    localName: empty ? '' : players[0]!.name,
    localPlayerId: empty ? null : players[0]!.id,
    accountKey: empty ? '' : players[0]!.id,
    loginSeen: !empty,
    localDeck: empty ? '' : 'Armored.deck',
    lobbyId: empty ? '' : 'development-lobby',
    lobbyPlayers: empty ? [] : players,
    current: empty
      ? null
      : {
          ...structuredClone(matches[0]!),
          id: 'development-live-match',
          sessionId: 'development-session',
          fid: '9900100',
          startedAt: now - 18 * 60000,
          endedAt: null,
          durationSec: null,
          durationSource: null,
          localDeck: 'Armored.deck',
          winnerTeamId: null,
          outcome: 'unknown',
          eloAfter: null,
        },
    recovering: false,
  };
  bootstrap.watcher = {
    dir: bootstrap.config.logDir,
    file: empty ? null : 'Gamelog__development.log',
    listening: !empty,
    recovering: false,
    error: null,
    live: !empty,
  };
  bootstrap.recording = {
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
  bootstrap.health = {
    state: 'ok',
    at: now,
    checks: [
      '/api/players/search',
      '/api/players/info',
      '/api/leaderboard/ban',
      '/api/players/matches',
      '/api/match',
    ].map((path, index) => ({ path, ok: true, ms: 20 + index * 7, status: 200 })),
  };
  bootstrap.deckAlert = null;
  return {
    bootstrap,
    matches,
    accounts,
    reports,
    players: empty
      ? []
      : players.map((player) => ({
          id: player.id,
          name: player.name,
          level: 30,
          rating: player.newRating,
        })),
    bans: empty
      ? []
      : Array.from({ length: 45 }, (_, index) => ({
          id: String(88000 + index),
          name: `Development player ${index + 1}`,
          steamId: '',
          rating: 2300 - index * 23,
          firstSeenAt: now - index * 3600000,
          lastSeenAt: now,
          encountered: index % 3 === 0,
          lastEncounterAt: index % 3 === 0 ? now - index * 7200000 : null,
        })),
    replays: empty
      ? []
      : matches.slice(0, 6).map((match, index) => ({
          id: `development-replay-${index}.webm`,
          fid: match.fid,
          map: match.map,
          uploaderId: players[0]!.id,
          uploaderName: players[0]!.name,
          teamId: 0,
          size: 8_000_000 + index * 3_000_000,
          createdAt: match.endedAt!,
          durationSec: match.durationSec,
          test: true,
        })),
    decks: {
      found: !empty,
      decksDir: 'C:/Development/Decks',
      backupsDir: 'C:/Development/Backups',
      decks: empty
        ? []
        : [
            { name: 'Armored.deck', size: 8200, modifiedAt: now },
            { name: 'Airborne.deck', size: 6400, modifiedAt: now },
          ],
      backups: empty ? [] : [{ name: 'Ranked lineup.zip', size: 22000, modifiedAt: now }],
    },
    cache: empty
      ? {
          api: { entries: 0, expired: 0, bytes: 0 },
          snapshots: { entries: 0, expired: 0, bytes: 0 },
        }
      : {
          api: { entries: 240, expired: 80, bytes: 18_000_000 },
          snapshots: { entries: 12, expired: 3, bytes: 48000 },
        },
  };
}
