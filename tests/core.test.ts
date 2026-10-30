import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaggotRow, Match } from '@ba/contracts';
import {
  emptyMatch,
  emptyPlayer,
  mapId,
  mapName,
  mergeMatch,
  normalizeMatch,
  playersFromData,
  summarizeMaggot,
} from '@ba/shared';
import { Database } from '../apps/server/src/storage/database';
import { LogParser, type LogEvent } from '../apps/server/src/logs/parser';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { TrackerService } from '../apps/server/src/players/tracker';

const databases: Database[] = [];
function database(): Database {
  const db = new Database(':memory:');
  databases.push(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

// PascalCase match DTO and camelCase analysis DTO mirror the existing BATrace adapters.
const matchInfo = {
  MapId: 7,
  EndTime: 1_700_000_000,
  TotalPlayTimeInSec: 2_700,
  WinnerTeam: 1,
  Data: {
    '8863': {
      Name: 'Zola',
      OldRating: 0,
      NewRating: 10,
      DestructionScore: 5_855,
      LossesScore: 6_840,
      ObjectivesCaptured: 4,
      Destruction: 12,
      DamageDealt: 9_876,
      DamageReceived: 4_321,
      DLRatio: 2.28,
      SupplyPointsConsumed: 3_500,
      TotalExp: 1_250,
      Medals: ['mvp', 'supply'],
    },
    '19191': { Id: 19191, Name: 'Opponent', TeamId: 1 },
  },
};

const analysisPlayer = {
  matchCount: 82,
  trend: {
    points: [
      {
        matchId: 8_040_001,
        won: false,
        ratingBefore: 2_570,
        ratingAfter: 2_550,
        kdRatio: 0.9,
        dmr: 0.85,
        destructionScore: 4_000,
        lossesScore: 5_000,
        objectivesCaptured: 2,
        endTime: 1_700_000_000,
      },
      {
        matchId: '8049993',
        won: true,
        ratingBefore: 2_550,
        ratingAfter: 2_566.1,
        kdRatio: 1.52,
        dmr: 0.98,
        destructionScore: 5_855,
        lossesScore: 6_840,
        objectivesCaptured: 4,
        endTime: '2023-11-15T00:00:00.000Z',
      },
    ],
  },
  highlightUnits: [
    { unitId: 1, unitName: 'Tank', totalDamage: 0, spawnCount: 0, avgRoi: 0 },
    { unitId: 2, unitName: 'Infantry', totalDamage: 5_000, spawnCount: 4, avgRoi: 1.25 },
  ],
  categoryPreferences: [{ categoryKey: 'tanks', percentage: 42 }],
  mapPerformance: [
    {
      mapId: 7,
      mapName: 'Dam',
      matchCount: 12,
      winRate: 66,
      avgKd: 1.58,
      avgDestructionScore: 5347,
    },
  ],
  playStyle: { primaryStyle: 'team_player' },
};

function cachedAnalyzer(db: Database): Analyzer {
  const unexpectedFetch = vi.fn<typeof fetch>(async () => {
    throw new Error('This fixture should be served from the SQLite cache');
  });
  return new Analyzer(new BatraceClient(db, { fetch: unexpectedFetch }, '4.0.0'), db);
}

describe('canonical BATrace match data', () => {
  it('keeps zero ratings, dictionary IDs, missing Alpha and the full metric mapping', () => {
    const match = normalizeMatch({ matchInfo }, { id: '8049993', localId: '8863' });
    expect(match).toMatchObject({
      fid: '8049993',
      mode: 'ranked',
      map: 'Dam',
      mapId: 7,
      endedAt: 1_700_000_000_000,
      durationSec: 2_700,
      durationSource: 'api',
      outcome: 'win',
      winnerTeamId: 0,
      eloBefore: 0,
      eloAfter: 10,
    });
    expect(match.players[0]).toMatchObject({
      id: '8863',
      teamId: 0,
      oldRating: 0,
      newRating: 10,
      destructionScore: 5_855,
      lossesScore: 6_840,
      objectivesCaptured: 4,
      killed: 12,
      damageDealt: 9_876,
      damageReceived: 4_321,
      dlRatio: 2.28,
      supplyPoints: 3_500,
      exp: 1_250,
      medals: 2,
    });
  });

  it.each([1, 3])('uses Type=%i for custom mode, even when ratings are present', (Type) => {
    const match = normalizeMatch({ ...matchInfo, Type }, { id: '123', localId: '8863' });
    expect(match.mode).toBe('custom');
    expect(match.outcome).toBe('loss');
    expect(match.winnerTeamId).toBe(1);
  });

  it('keeps string Data IDs unknown and merges available previous evidence', () => {
    const raw = '@{8863=; 19191=; }';
    const match = normalizeMatch(
      { Data: raw, Type: 1, WinnerTeam: 0 },
      { id: '123', localId: '8863' },
    );
    expect(match.players.map((p) => p.id)).toEqual(['8863', '19191']);
    expect(match.players.every((p) => p.teamId === null && p.oldRating === null)).toBe(true);
    expect(match.outcome).toBe('unknown');
    const old = { ...emptyPlayer('8863', 'Zola'), teamId: 1 as const, newRating: 1_234 };
    expect(playersFromData(raw, [old])[0]).toEqual(old);
  });

  it('treats spectators as spectators regardless of rating or winner evidence', () => {
    const match = normalizeMatch(
      { Data: { '8863': { TeamId: 100, OldRating: 0, NewRating: 10 } }, WinnerTeam: 0 },
      { id: '123', localId: '8863' },
    );
    expect(match.outcome).toBe('spectator');
    expect(match.eloBefore).toBeNull();
    expect(match.eloAfter).toBeNull();
  });

  it('does not invent a winner when the local player is absent', () => {
    const match = normalizeMatch(matchInfo, { id: '123', localId: '99999' });
    expect(match.outcome).toBe('unknown');
    expect(match.eloBefore).toBeNull();
  });

  it('keeps every previous roster member when an API response is sparse', () => {
    const previous = normalizeMatch(matchInfo, { id: '123', localId: '8863' });
    const updated = normalizeMatch(
      { Data: { '8863': { Name: 'Updated', NewRating: 20 } } },
      { id: '123', localId: '8863', previous },
    );
    expect(updated.players.map((p) => p.id)).toEqual(['8863', '19191']);
    expect(updated.players.find((p) => p.id === '8863')?.name).toBe('Updated');
    expect(updated.players.find((p) => p.id === '8863')?.destructionScore).toBe(5_855);
  });

  it('clears old restart guesses when a real API match is fetched', () => {
    const previous = { ...emptyMatch('123'), restarted: true };
    expect(normalizeMatch({ matchInfo }, { id: '123', previous, localId: '8863' }).restarted).toBe(
      false,
    );
  });

  it('keeps the known map names and case-insensitive reverse mapping', () => {
    expect(mapName(22)).toBe('Ignalina Powerplant');
    expect(mapId('  dAm  ')).toBe(7);
    expect(mapId('map:999')).toBe(999);
  });
});

describe('SQLite merging and account views', () => {
  it('does not downgrade API facts when the same historical log is replayed', () => {
    const db = database();
    const previous = normalizeMatch(matchInfo, { id: '123', localId: '8863', now: 1_000 });
    db.saveMatch(previous);
    const log: Match = {
      ...emptyMatch('123', 2_000),
      localPlayerId: '8863',
      players: [{ ...emptyPlayer('8863', 'Old name'), teamId: 0 }],
      endedAt: 3_000,
      durationSec: 1,
      durationSource: 'estimated',
      updatedAt: 3_000,
    };
    expect(mergeMatch(previous, log)).toMatchObject({
      source: 'api',
      mode: 'ranked',
      outcome: 'win',
      eloAfter: 10,
      durationSec: 2_700,
      updatedAt: 1_000,
    });
    db.saveMatch(log);
    expect(db.match('123')).toMatchObject({
      source: 'api',
      mode: 'ranked',
      outcome: 'win',
      eloAfter: 10,
      durationSec: 2_700,
      updatedAt: 1_000,
    });
    expect(db.match('123')?.players).toHaveLength(2);
  });

  it('replaces the temporary row when the same recording session obtains a late FID', () => {
    const db = database();
    const temporary = {
      ...emptyMatch('local:session'),
      sessionId: 'session',
      players: [emptyPlayer('8863', 'Zola')],
    };
    db.saveMatch(temporary);
    db.saveMatch({ ...temporary, id: '123', fid: '123' });
    expect(db.matches().map((m) => m.id)).toEqual(['123']);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM match_players').get()?.n).toBe(1);
  });

  it('keeps the current name when an older match supplies an old name', () => {
    const db = database();
    db.observe([{ id: '8863', name: 'New name' }], 2_000);
    db.observe([{ id: '8863', name: 'Old name' }], 1_000);
    expect(db.player('8863')).toMatchObject({
      name: 'New name',
      firstSeen: 1_000,
      lastSeen: 2_000,
    });
    expect(db.player('8863')?.names.map((n) => n.name)).toEqual(['New name', 'Old name']);
  });

  it('uses the selected account view for encounter outcomes', () => {
    const db = database();
    const raw = {
      Data: {
        '1': { Name: 'Account A', OldRating: 100, NewRating: 110 },
        '2': { Name: 'Account B', TeamId: 1, OldRating: 110, NewRating: 100 },
        '3': { Name: 'Ally' },
      },
      WinnerTeam: 0,
    };
    db.saveMatch(normalizeMatch(raw, { id: '123', localId: '1' }));
    db.saveMatch(normalizeMatch(raw, { id: '123', localId: '2' }));
    db.setState('activeAccountId', '1');
    db.updateConfig({ multiAccountBond: false });
    expect(db.encounters('3')).toEqual([expect.objectContaining({ relation: 'same', won: true })]);
    expect(db.match('123', '1')?.outcome).toBe('win');
    expect(db.match('123', '2')?.outcome).toBe('loss');
    expect(db.deleteAccount('2')).toEqual({ removedMatches: 0 });
    expect(db.match('123')?.localPlayerId).toBe('1');
  });

  it('keeps account-specific encounter summaries, spectator relations and unmatched legacy history', () => {
    const db = database();
    const match: Match = {
      ...emptyMatch('123'),
      endedAt: 3000,
      players: [
        { ...emptyPlayer('1', 'Account A'), teamId: 0 },
        { ...emptyPlayer('2', 'Account B'), teamId: 1 },
        { ...emptyPlayer('3', 'Target'), teamId: 0 },
        { ...emptyPlayer('4', 'Spectator'), teamId: 100 },
      ],
    };
    db.saveMatch({ ...match, localPlayerId: '1', outcome: 'win' });
    db.saveMatch({ ...match, localPlayerId: '2', outcome: 'loss' });
    db.observeAccount('4', 'Spectator');
    const legacy = db.sql.prepare('INSERT INTO legacy_encounters VALUES(?,?,?,?,?)');
    legacy.run('duplicate', '3', '123', 3000, JSON.stringify({ fid: '123', at: 3000 }));
    legacy.run(
      'unowned',
      '3',
      null,
      2000,
      JSON.stringify({ id: 'unowned', at: 2000, myTeam: 'Alpha', theirTeam: 'Bravo', won: false }),
    );
    db.updateConfig({ multiAccountBond: false });
    for (const [account, relation, won] of [
      ['1', 'same', true],
      ['2', 'opponent', false],
      ['4', 'spectator', null],
    ] as const) {
      db.setState('activeAccountId', account);
      expect(db.encounters('3')).toEqual([
        expect.objectContaining({ matchId: '123', relation, won }),
        expect.objectContaining({ matchId: 'unowned', relation: 'opponent', won: false }),
      ]);
    }
    db.updateConfig({ multiAccountBond: true });
    expect(db.encounters('3')[0]).toMatchObject({ relation: 'opponent', won: false });
    expect(db.encounters('999')).toEqual([]);
  });
});

describe('GameLogs state machine', () => {
  function parser() {
    const events: LogEvent[] = [];
    let now = 100_000;
    const value = new LogParser(
      (event) => events.push(event),
      () => now,
    );
    return {
      value,
      events,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }
  const begin = [
    'Log: GetPersonaName Zola',
    'Log: [AUTH] Rest: Login success',
    'Log: Start loading battle... map: Dam, scenario: Skirmish',
  ];
  const roster = [
    'Log: Player list:',
    'ID: 8863, Name: Zola, Team: Alpha',
    'ID: 19191, Name: Opponent, Team: Bravo',
  ];

  it('starts with no FID and keeps the same session when the FID arrives', () => {
    const { value } = parser();
    value.feed(begin);
    const initial = value.snapshot().current;
    expect(initial?.fid).toBeNull();
    value.feed([...roster, 'Log: FID:8049993']);
    expect(value.snapshot().current).toMatchObject({
      fid: '8049993',
      id: '8049993',
      sessionId: initial?.sessionId,
      mapId: 7,
      localPlayerId: '8863',
    });
  });

  it('merges the formal roster into an earlier Room Client fallback', () => {
    const { value } = parser();
    value.feed([...begin, 'Log: Room: (GameRoom|123), Client: (Zola|8863)']);
    expect(value.snapshot().current?.players[0]?.teamId).toBeNull();
    value.feed(roster);
    expect(value.snapshot().current?.players).toHaveLength(2);
    expect(value.snapshot().current?.players[0]?.teamId).toBe(0);
  });

  it('ends once and replaces the estimated duration with late network evidence', () => {
    const { value, events, advance } = parser();
    value.feed([...begin, ...roster, 'Log: FID:8049993']);
    advance(60_000);
    value.feed(['Log: GameController dispose called', 'Log: [NET_ROOM] GameRoom exited']);
    const ended = events.filter((e) => e.type === 'ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ match: { durationSec: 60, durationSource: 'estimated' } });
    value.feed(['Log: [NET_ROOM] Connection closed. Info LiveTime: 900 sec']);
    expect(events.at(-2)).toMatchObject({
      type: 'metadata',
      match: { fid: '8049993', durationSec: 900, durationSource: 'log' },
    });
  });

  it('restores history without fabricated play times or input duration', () => {
    const { value, events } = parser();
    value.feed(
      [...begin, ...roster, 'Log: FID:8049993', 'Log: GameController dispose called'],
      true,
    );
    const ended = events.find((e) => e.type === 'ended');
    expect(ended).toMatchObject({
      recovering: true,
      match: { startedAt: null, endedAt: null, durationSec: null, durationSource: null },
    });
    expect(value.snapshot().recovering).toBe(true);
    value.recovered();
    expect(value.snapshot().recovering).toBe(false);
  });

  it('clears the previous match and late metadata destination on reset', () => {
    const { value, events } = parser();
    value.feed([...begin, ...roster, 'Log: GameController dispose called']);
    const previousGeneration = value.snapshot().generation;
    value.reset();
    const count = events.filter((e) => e.type === 'metadata').length;
    value.feed(['Log: [NET_ROOM] Connection closed. Info LiveTime: 900 sec']);
    expect(events.filter((e) => e.type === 'metadata')).toHaveLength(count);
    expect(value.snapshot()).toMatchObject({
      generation: previousGeneration + 1,
      localName: '',
      accountKey: '',
      current: null,
      lobbyPlayers: [],
    });
  });
});

describe('player reports and Maggot Index', () => {
  it.each([
    [1, 1],
    [2, 2.3],
    [3, 5.5],
    [4, 8.7],
    [5, 10],
  ])('maps twelve rank-%i matches to %s', (rank, index) => {
    const rows: MaggotRow[] = Array.from({ length: 12 }, (_, i) => ({
      matchId: String(i),
      won: true,
      mvpRank: rank,
      killRank: null,
      lossRank: null,
      kdRank: null,
      eloDelta: 1,
    }));
    expect(summarizeMaggot('8863', rows)).toMatchObject({
      complete: true,
      index,
      averageRank: rank,
      trend: 'flat',
    });
  });

  it('returns an explicit incomplete result for zero rows rather than NaN', () => {
    expect(summarizeMaggot('8863', [])).toMatchObject({
      complete: false,
      index: null,
      averageRank: null,
      rows: [],
    });
  });

  it('reads all fields from the analysis DTO without losing zeros or time units', async () => {
    const db = database();
    db.observe([{ id: '8863', name: 'Zola' }]);
    db.saveCache('analysis:8863', analysisPlayer, 21_600_000);
    const analyzer = cachedAnalyzer(db);
    const report = await analyzer.report('8863');
    expect(report).toMatchObject({
      id: '8863',
      name: 'Zola',
      matchCount: 82,
      elo: 2_566.1,
      kd: 1.52,
      dmr: 0.98,
      wins: 1,
      losses: 1,
      winRate: 50,
      style: 'team_player',
      stale: false,
    });
    expect(report.recentMatches[0]).toMatchObject({
      matchId: '8049993',
      won: true,
      endTime: Date.parse('2023-11-15T00:00:00.000Z'),
    });
    expect(report.recentMatches[1]?.endTime).toBe(1_700_000_000_000);
    expect(report.favUnits[0]).toEqual({ name: 'Tank', value: 0, spawn: 0, roi: 0 });
    expect(report.categories).toEqual([{ key: 'tanks', pct: 42 }]);
    expect(report.mapStats).toEqual([
      {
        mapId: 7,
        name: 'Dam',
        matchCount: 12,
        winRate: 66,
        avgKd: 1.58,
        avgDestructionScore: 5347,
      },
    ]);
    expect(db.snapshot('8863')).toEqual(analyzer.mini(report));
  });

  it.each([
    {
      name: 'zero',
      averages: { avgKd: 0, avgDestructionScore: 0 },
      expected: { avgKd: 0, avgDestructionScore: 0 },
    },
    { name: 'missing', averages: {}, expected: { avgKd: null, avgDestructionScore: null } },
  ])(
    'preserves $name map averages without substituting recent-match metrics',
    async ({ averages, expected }) => {
      const db = database();
      db.saveCache(
        'analysis:8863',
        {
          ...analysisPlayer,
          mapPerformance: [{ mapId: 7, mapName: 'Dam', matchCount: 12, winRate: 66, ...averages }],
        },
        21_600_000,
      );
      const report = await cachedAnalyzer(db).report('8863');
      expect(report.mapStats[0]).toMatchObject(expected);
    },
  );

  it('skips a match without the target player and joins mixed numeric/string economy IDs', async () => {
    const db = database();
    const points = Array.from({ length: 13 }, (_, i) => ({
      matchId: String(1_000 + i),
      ratingBefore: 100,
      ratingAfter: 110,
      won: true,
    }));
    db.saveCache('analysis:8863', { matchCount: 13, trend: { points } }, 21_600_000);
    for (const [i, point] of points.entries()) {
      const ids =
        i === 12 ? ['100', '99999', '102', '103', '104'] : ['100', '8863', '102', '103', '104'];
      const mvpRanking = [
        ...ids.map((playerId, rank) => ({ playerId, teamId: 0, score: 5 - rank })),
        ...Array.from({ length: 5 }, (_, rank) => ({
          playerId: String(200 + rank),
          teamId: 1,
          score: 5 - rank,
        })),
      ];
      const economy = {
        players: ids.map((playerId, rank) => ({
          playerId: Number(playerId),
          returnValue: playerId === '8863' ? 5_000 : 100 + rank,
          investment: (rank + 1) * 1_000,
          refunded: 0,
        })),
      };
      db.saveCache(`amatch:${point.matchId}`, { mvpRanking, economy }, 86_400_000);
    }
    const progress = vi.fn();
    const result = await cachedAnalyzer(db).maggot('8863', progress);
    expect(result).toMatchObject({ complete: true, index: 2.3, averageRank: 2, calls: 0 });
    expect(result.rows).toHaveLength(12);
    expect(result.rows.some((row) => row.matchId === '1012')).toBe(false);
    expect(result.rows[0]).toMatchObject({
      matchId: '1011',
      mvpRank: 2,
      killRank: 1,
      lossRank: 2,
      kdRank: 1,
      eloDelta: 10,
    });
    expect(progress).toHaveBeenLastCalledWith(12, 13);
  });

  it('rejects an empty match response without creating a phantom archive row', async () => {
    const db = database();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ matchInfo: null }));
    const client = new BatraceClient(db, { fetch: fetchImpl }, '4.0.0');
    const tracker = new TrackerService(db, client, new Analyzer(client, db));
    await expect(tracker.detail('404', true)).rejects.toThrow(/not found|incomplete/i);
    expect(db.match('404')).toBeNull();
    await client.close();
  });
});
