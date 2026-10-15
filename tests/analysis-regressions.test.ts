import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptyMatch,
  emptyPlayer,
  mergeMatch,
  normalizeMatch,
  winnerFromAnalysis,
} from '@ba/shared';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { TrackerService } from '../apps/server/src/players/tracker';

const resources: Array<{ db: Database; client: BatraceClient }> = [];
function setup(
  fetchImpl: typeof fetch = async () => {
    throw new Error('Unexpected network');
  },
) {
  const db = new Database(':memory:');
  const client = new BatraceClient(db, { fetch: fetchImpl }, () => {}, 0);
  resources.push({ db, client });
  const analyzer = new Analyzer(client, db);
  return { db, client, analyzer, tracker: new TrackerService(db, client, analyzer) };
}
afterEach(async () => {
  for (const { db, client } of resources.splice(0)) {
    await client.close();
    db.close();
  }
});
const points = Array.from({ length: 13 }, (_, i) => ({
  matchId: String(1000 + i),
  ratingBefore: 100,
  ratingAfter: 110,
  won: true,
}));
function ranking(ids = ['1', '2', '3', '4', '5']) {
  return [
    ...ids.map((playerId, i) => ({ playerId, teamId: 0, score: 5 - i })),
    ...['6', '7', '8', '9', '10'].map((playerId, i) => ({ playerId, teamId: 1, score: 5 - i })),
  ];
}
function cacheMatches(db: Database, mvpRanking: unknown[], economy?: unknown) {
  db.saveCache('analysis:1', { matchCount: 12, trend: { points: points.slice(0, 12) } }, 21600000);
  for (const p of points.slice(0, 12))
    db.saveCache(`amatch:${p.matchId}`, { mvpRanking, economy }, 86400000);
}

describe('analysis report regressions', () => {
  it.each([null, {}, { name: '' }])('rejects invalid fallback info %j', async (info) => {
    const { db, analyzer } = setup();
    db.saveCache('analysis:1', { error: 'Not found' }, 21600000);
    db.saveCache('info:1', { info }, 21600000);
    await expect(analyzer.report('1')).rejects.toThrow();
    expect(db.snapshot('1')).toBeNull();
  });
  it('excludes unknown outcomes and exposes the actual win-rate sample count', async () => {
    const { db, analyzer } = setup();
    db.saveCache(
      'analysis:1',
      {
        matchCount: 82,
        trend: {
          points: [
            { matchId: '1', won: true, kdRatio: 1 },
            { matchId: '2', won: false, kdRatio: 1 },
            { matchId: '3', won: null, kdRatio: 4 },
          ],
        },
      },
      21600000,
    );
    await expect(analyzer.report('1')).resolves.toMatchObject({
      matchCount: 82,
      sampleCount: 2,
      kd: 4,
      wins: 1,
      losses: 1,
      winRate: 50,
    });
  });
  it('persists successful fallback info and uses decided games for its win rate', async () => {
    const { db, analyzer } = setup();
    db.saveCache('analysis:1', {}, 21600000);
    db.saveCache(
      'info:1',
      {
        info: { name: 'Player', rating: 100 },
        statInfo: { fightsCountRt: 20, winCountRt: 6, lossCountRt: 4 },
      },
      21600000,
    );
    const report = await analyzer.report('1');
    expect(report).toMatchObject({ fallback: true, matchCount: 20, sampleCount: 10, winRate: 60 });
    expect(db.snapshot('1')).toEqual(analyzer.mini(report));
  });
  it('force refresh also refreshes fallback info instead of returning a fresh old cache', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/analysis/player')
        ? new Response('No analysis', { status: 404 })
        : Response.json({ info: { name: 'New', rating: 200 } }),
    );
    const { db, analyzer } = setup(fetchImpl);
    db.saveCache('info:1', { info: { name: 'Old', rating: 100 } }, 21600000);
    await expect(analyzer.report('1', true)).resolves.toMatchObject({ fallback: true, elo: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('force failures never return stale analysis or stale fallback as success', async () => {
    const { db, analyzer } = setup(async () => new Response('Down', { status: 503 }));
    db.saveCache('analysis:1', { matchCount: 1, trend: { points: [] } }, 1, Date.now() - 10000);
    db.saveCache('info:1', { info: { name: 'Old' } }, 1, Date.now() - 10000);
    await expect(analyzer.report('1', true)).rejects.toThrow('503');
  });
});

describe('ranked sample and ranking regressions', () => {
  it.each(['spectator', 'duplicate', 'invalid-score'])(
    'rejects malformed five-versus-five sample: %s',
    async (kind) => {
      const { db, analyzer } = setup();
      const mvp = ranking(kind === 'duplicate' ? ['1', '2', '2', '3', '4'] : undefined);
      if (kind === 'spectator') mvp[9]!.teamId = 100;
      if (kind === 'invalid-score') mvp[9]!.score = NaN;
      cacheMatches(db, mvp);
      await expect(analyzer.maggot('1', () => {})).resolves.toMatchObject({
        complete: false,
        index: null,
        rows: [],
      });
    },
  );
  it('assigns the same average rank to tied scores regardless of array ordering', async () => {
    const { db, analyzer } = setup();
    cacheMatches(
      db,
      ranking().map((p) => ({ ...p, score: 0 })),
    );
    await expect(analyzer.maggot('1', () => {})).resolves.toMatchObject({
      index: 5.5,
      averageRank: 3,
    });
    cacheMatches(
      db,
      ranking(['5', '4', '3', '2', '1']).map((p) => ({ ...p, score: 0 })),
    );
    await expect(analyzer.maggot('1', () => {})).resolves.toMatchObject({
      index: 5.5,
      averageRank: 3,
    });
  });
  it('keeps known kill ranks when investment data is absent and shares partial tie positions', async () => {
    const { db, analyzer } = setup();
    const mvp = ranking();
    mvp[0]!.score = 4;
    cacheMatches(db, mvp, {
      players: ['1', '2', '3', '4', '5'].map((playerId) => ({ playerId, returnValue: 100 })),
    });
    const result = await analyzer.maggot('1', () => {});
    expect(result.rows[0]).toMatchObject({
      mvpRank: 1.5,
      killRank: 3,
      lossRank: null,
      kdRank: null,
    });
  });
  it('counts failed request attempts as well as successful requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('/analysis/player'))
        return Response.json({ matchCount: 13, trend: { points } });
      if (String(url).endsWith('matchid=1012')) return new Response('Down', { status: 503 });
      return Response.json({ mvpRanking: ranking() });
    });
    const { db, analyzer } = setup(fetchImpl);
    const report = await analyzer.maggot('1', () => {});
    expect(report).toMatchObject({ complete: true, calls: 16 });
    expect(fetchImpl).toHaveBeenCalledTimes(16);
    expect(db.usage().used24h).toBe(16);
  });
});

describe('match sync regressions', () => {
  it('requires explicit winner evidence rather than treating destruction score as a match result', () => {
    const teamComparison = {
      teamATotals: { destructionScore: 10000 },
      teamBTotals: { destructionScore: 100 },
    };
    expect(winnerFromAnalysis({ teamComparison })).toBeNull();
    expect(winnerFromAnalysis({ teamComparison, winnerTeamId: 1 })).toBe(1);
    expect(winnerFromAnalysis({ teamComparison, winnerTeamId: 0 })).toBe(0);
    expect(winnerFromAnalysis({ winnerTeamId: 100 })).toBeNull();
  });
  it('keeps a freshly completed detail after saving the earlier sparse recent snapshot', async () => {
    const { db, tracker } = setup();
    db.saveMatch({
      ...emptyMatch('123'),
      localPlayerId: '1',
      players: [{ ...emptyPlayer('1', 'Log name'), teamId: 1 }],
    });
    db.setState('activeAccountId', '1');
    db.saveCache(
      'myMatches:1:10',
      { matches: [{ matchId: '123', data: { Type: 1, Data: '@{1=;}' } }] },
      1800000,
      Date.now() - 10000,
    );
    db.saveCache(
      'match:123',
      { matchInfo: { Type: 1, WinnerTeam: 0, Data: { '1': { Name: 'API name', TeamId: 0 } } } },
      86400000,
    );
    await tracker.sync();
    expect(db.match('123', '1')).toMatchObject({
      outcome: 'win',
      players: [{ name: 'API name', teamId: 0 }],
    });
  });
  it('does not downgrade a newer API response when an older response arrives later', () => {
    const newer = normalizeMatch(
      { Data: { '1': { Name: 'New', TeamId: 0, OldRating: 100, NewRating: 110 } } },
      { id: '123', localId: '1', now: 200 },
    );
    const older = normalizeMatch(
      { Data: { '1': { Name: 'Old', TeamId: 1, OldRating: 100, NewRating: 90 } } },
      { id: '123', localId: '1', now: 100 },
    );
    expect(mergeMatch(newer, older)).toMatchObject({
      outcome: 'win',
      updatedAt: 200,
      players: [{ name: 'New', teamId: 0, newRating: 110 }],
    });
  });
});
