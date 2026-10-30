import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { projectConfig } from '../apps/server/src/config';
import { playerAnalysisSections } from '../apps/server/src/network/player-analysis';
import {
  loadOfflineFixtureManifest,
  readOfflineFixtureRecords,
} from '../apps/server/src/dev/offline-fixtures';

const resources: { db: Database; client: BatraceClient }[] = [];
afterEach(async () => {
  for (const { db, client } of resources.splice(0)) {
    await client.close();
    db.close();
  }
});
const full = {
  matchCount: 20,
  trend: { points: [{ matchId: '12345', won: true, ratingBefore: 1000, ratingAfter: 1020 }] },
  mapPerformance: [{ mapId: 1, mapName: 'Dam', matchCount: 1, winRate: 100 }],
};
const basic = {
  info: { name: 'Recovery player', rating: 1500 },
  statInfo: { fightsCountRt: 20, winCountRt: 7, lossCountRt: 3 },
};
function setup(value: unknown, options: { offline?: boolean } = {}) {
  const db = new Database(':memory:');
  let response = value,
    fail = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    if (fail) return new Response('', { status: 403 });
    return Response.json(String(url).includes('/analysis/player') ? response : basic);
  });
  const client = new BatraceClient(
    db,
    { fetch, offline: options.offline },
    'report-recovery',
    Date.now,
    async () => {},
    () => 0,
    { ...projectConfig.network, maxAttempts: 1, requestOffsetMs: 0 },
  );
  resources.push({ db, client });
  return {
    db,
    client,
    fetch,
    analyzer: new Analyzer(client, db),
    recover: () => {
      response = full;
    },
    fail: () => {
      fail = true;
    },
  };
}

describe('validated player analysis and ordinary recovery', () => {
  it('starts a new ordinary read after a partial force supersedes a still-pending older read', async () => {
    const f = setup(full);
    let finish!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    let calls = 0;
    f.fetch.mockImplementation(async () => {
      const call = ++calls;
      if (call === 1) return older;
      const fresh = structuredClone(full);
      fresh.trend.points[0]!.ratingAfter = call === 2 ? 2020 : 3030;
      return Response.json(
        call === 2 ? { matchCount: fresh.matchCount, trend: fresh.trend } : fresh,
      );
    });
    const first = f.analyzer.report('1');
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(await f.analyzer.report('1', true)).toMatchObject({
      elo: 2020,
      detailAvailability: { maps: false },
    });
    const next = f.analyzer.report('1');
    await vi.waitFor(() => expect(calls).toBe(3));
    expect(await next).toMatchObject({ elo: 3030, stale: false });
    finish(Response.json(full));
    expect(await first).toMatchObject({ stale: true });
    expect(f.db.snapshot('1')?.elo).toBe(3030);
    expect(await f.analyzer.report('1')).toMatchObject({ elo: 3030 });
    expect(calls).toBe(3);
  });
  it.each(['full', 'basic', 'partial'] as const)(
    'keeps a forced result after an older %s response finishes',
    async (mode) => {
      const f = setup(full);
      let finish!: (value: Response) => void;
      const older = new Promise<Response>((resolve) => {
        finish = resolve;
      });
      let analysisCalls = 0;
      let basicPending = false;
      const fresh = structuredClone(full);
      fresh.trend.points[0]!.ratingAfter = 2020;
      f.fetch.mockImplementation(async (url) => {
        if (!String(url).includes('/analysis/player')) {
          if (mode === 'basic') {
            basicPending = true;
            return older;
          }
          return Response.json(basic);
        }
        if (++analysisCalls !== 1) return Response.json(fresh);
        return mode === 'basic' ? new Response('', { status: 403 }) : older;
      });
      const first = f.analyzer.report('1');
      expect(f.analyzer.report('1')).toBe(first);
      await vi.waitFor(() => expect(analysisCalls).toBe(1));
      if (mode === 'basic') await vi.waitFor(() => expect(basicPending).toBe(true));
      const forced = await f.analyzer.report('1', true);
      expect(forced).toMatchObject({ elo: 2020, stale: false });
      finish(
        mode === 'basic'
          ? Response.json(basic)
          : Response.json(mode === 'partial' ? { matchCount: 20, trend: full.trend } : full),
      );
      expect(await first).toMatchObject({ stale: true, fallback: mode === 'basic' });
      expect(f.db.snapshot('1')?.elo).toBe(2020);
      expect(f.db.cache('analysis:1')?.value).toEqual(fresh);
      expect(await f.analyzer.report('1')).toMatchObject({ elo: 2020, stale: false });
      expect(analysisCalls).toBe(2);
    },
  );
  it.each([
    null,
    {},
    [],
    { error: 'Unavailable' },
    { matchCount: 20 },
    { matchCount: '20', trend: { points: [] }, mapPerformance: [] },
    { matchCount: 20, trend: { points: {} }, mapPerformance: [] },
    { matchCount: 20, trend: { points: [] }, mapPerformance: {} },
    { matchCount: 20, trend: { points: [{}] }, mapPerformance: [] },
    { matchCount: 20, trend: { points: [] }, mapPerformance: [{}] },
  ])('does not reuse malformed successful JSON %j after upstream recovery', async (value) => {
    const f = setup(value);
    const first = await f.analyzer.report('1');
    expect(first).toMatchObject({
      fallback: true,
      matchCount: 20,
      sampleCount: 10,
      detailAvailability: { matches: false, maps: false },
    });
    expect(first.analysisError).toMatch(/incomplete player analysis/);
    expect(f.db.cache('analysis:1', true)).toBeNull();
    f.recover();
    expect(await f.analyzer.report('1')).toMatchObject({
      fallback: false,
      detailAvailability: { matches: true, maps: true },
      recentMatches: [expect.objectContaining({ matchId: '12345' })],
      mapStats: [expect.objectContaining({ name: 'Dam' })],
    });
    expect(
      f.fetch.mock.calls.filter(([url]) => String(url).includes('/analysis/player')),
    ).toHaveLength(2);
    await f.analyzer.report('1');
    expect(
      f.fetch.mock.calls.filter(([url]) => String(url).includes('/analysis/player')),
    ).toHaveLength(2);
  });
  it.each(['fresh', 'expired'] as const)(
    'evicts a legacy %s incomplete cache without clearing unrelated data',
    async (mode) => {
      const f = setup(full);
      f.db.saveCache('analysis:1', {}, mode === 'fresh' ? 60_000 : -1);
      f.db.saveCache('info:999', { preserved: true }, 60_000);
      expect(await f.analyzer.report('1')).toMatchObject({
        fallback: false,
        detailAvailability: { matches: true, maps: true },
      });
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.db.cache('info:999')?.value).toEqual({ preserved: true });
    },
  );
  it.each(['matches', 'maps'] as const)(
    'retains useful partial %s without caching the missing section as empty',
    async (section) => {
      const partial =
        section === 'matches'
          ? { matchCount: 20, trend: full.trend }
          : { matchCount: 20, mapPerformance: full.mapPerformance };
      const f = setup(partial);
      expect(await f.analyzer.report('1')).toMatchObject({
        fallback: false,
        detailAvailability: { matches: section === 'matches', maps: section === 'maps' },
      });
      expect(f.db.cache('analysis:1', true)).toBeNull();
      f.recover();
      expect(await f.analyzer.report('1')).toMatchObject({
        detailAvailability: { matches: true, maps: true },
      });
      expect(f.fetch).toHaveBeenCalledTimes(2);
    },
  );
  it('keeps complete expired evidence explicitly stale during failure and rejects a forced outage', async () => {
    const f = setup(full);
    f.db.saveCache('analysis:1', full, -1, 1234);
    f.fail();
    expect(await f.analyzer.report('1')).toMatchObject({
      fallback: false,
      stale: true,
      updatedAt: 1234,
    });
    await expect(f.analyzer.report('1', true)).rejects.toThrow(/403/);
    expect(f.db.cache('analysis:1', true)?.value).toEqual(full);
  });
  it('keeps recorded partial evidence honest and rejects invalid offline analysis without network', async () => {
    const f = setup(full, { offline: true });
    f.db.saveCache('analysis:1', { matchCount: 20, trend: full.trend }, 60_000);
    expect(await f.analyzer.report('1')).toMatchObject({
      stale: true,
      detailAvailability: { matches: true, maps: false },
    });
    f.db.saveCache('analysis:1', {}, 60_000);
    await expect(f.client.analysisPlayer('1')).rejects.toThrow(/incomplete/);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('accepts every checksum-verified recorded analysis response', async () => {
    const directory = 'tests/fixtures/batrace/offline',
      manifest = await loadOfflineFixtureManifest(directory);
    let checked = 0;
    const recordedIds = new Set<string>();
    for await (const record of readOfflineFixtureRecords(directory, manifest)) {
      if (record.kind !== 'analysis') continue;
      recordedIds.add(record.id);
      if (record.error) continue;
      expect(playerAnalysisSections(record.value)).toEqual({ matches: true, maps: true });
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect([...recordedIds].sort()).toEqual(manifest.players.map((player) => player.id).sort());
  });
});
