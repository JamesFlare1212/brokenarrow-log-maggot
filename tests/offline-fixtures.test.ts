import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyPlayer, object, playersFromData } from '@ba/shared';
import {
  loadOfflineFixtureManifest,
  readOfflineFixtureRecords,
  seedOfflineFixtureCaches,
  type OfflineFixtureKind,
  type OfflineFixtureManifest,
} from '../apps/server/src/dev/offline-fixtures';
import { loadRealData, seedRealData } from '../apps/server/src/dev/real-data';
import { LogParser } from '../apps/server/src/logs/parser';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { TrackerService } from '../apps/server/src/players/tracker';

const directory = resolve('tests/fixtures/batrace/offline');
const root = resolve('.test-data/offline-fixture-tests');
const temporary: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
let manifest: OfflineFixtureManifest;
let db: Database;
let client: BatraceClient;
let tracker: TrackerService;
let analyzer: Analyzer;
let activeAccountId: string;
const fetchImpl = vi.fn<typeof fetch>(async () => {
  throw new Error('Unexpected network access in offline fixture regression');
});
const records = new Map<
  string,
  {
    id: string;
    kind: OfflineFixtureKind;
    at: number;
    valueHash?: string;
    error?: string;
    recentCount?: number;
  }
>();
beforeAll(async () => {
  manifest = await loadOfflineFixtureManifest(directory);
  const { data } = await loadRealData(resolve('tests/fixtures/real'));
  activeAccountId = data.activeAccountId!;
  db = new Database(':memory:');
  seedRealData(db, data, '');
  await seedOfflineFixtureCaches(db, directory);
  for await (const record of readOfflineFixtureRecords(directory, manifest)) {
    records.set(record.key, {
      id: record.id,
      kind: record.kind,
      at: record.at,
      error: record.error,
      ...(!record.error ? { valueHash: hash(JSON.stringify(record.value)) } : {}),
      ...(record.kind === 'myMatches' && !record.error
        ? { recentCount: (object(record.value).matches as unknown[]).length }
        : {}),
    });
  }
  client = new BatraceClient(db, { fetch: fetchImpl, offline: true }, '4.3.0');
  analyzer = new Analyzer(client, db);
  tracker = new TrackerService(db, client, analyzer);
}, 60000);
afterAll(async () => {
  await client?.close();
  db?.close();
  for (const path of temporary) {
    if (!path.startsWith(root + sep)) throw new Error('Unsafe offline fixture cleanup path');
    await rm(path, { recursive: true, force: true });
  }
});

describe('complete recorded BATrace development archive', () => {
  it('covers all original log players, known players, match rosters, and fixture match IDs', async () => {
    const { data } = await loadRealData(resolve('tests/fixtures/real'));
    const ids = new Set(manifest.players.map((player) => player.id));
    const fids = new Set(manifest.matches);
    expect(ids.has('8863')).toBe(true);
    const history = JSON.parse(
      gunzipSync(await readFile(resolve(directory, '../history/responses.json.gz'))).toString(
        'utf8',
      ),
    );
    for (const match of history.matches) expect(fids.has(match.id)).toBe(true);
    for (const response of history.responses)
      for (const [id, player] of Object.entries(
        object(object(response.value).matchInfo).Data as Record<string, unknown>,
      ))
        expect(ids.has(String(object(player).Id ?? id))).toBe(true);
    for (const row of data.tables.players!) expect(ids.has(String(row.id))).toBe(true);
    for (const log of data.logs) {
      const collect: ConstructorParameters<typeof LogParser>[0] = (event) => {
        if ('match' in event && event.match) {
          if (event.match.fid) expect(fids.has(event.match.fid)).toBe(true);
          for (const player of event.match.players)
            if (/^[1-9]\d*$/.test(player.id)) expect(ids.has(player.id)).toBe(true);
        }
      };
      const parser = new LogParser(collect);
      parser.reset(log.path);
      parser.feed(log.content.split('\n'), true);
      const current = parser.snapshot().current;
      if (current)
        for (const player of current.players)
          if (/^[1-9]\d*$/.test(player.id)) expect(ids.has(player.id)).toBe(true);
    }
    for (const id of manifest.matches)
      for (const kind of ['match', 'amatch']) {
        expect(records.has(kind + ':' + id)).toBe(true);
        const value = db.cache(kind + ':' + id, true)?.value;
        if (kind === 'match')
          for (const player of playersFromData(object(object(value).matchInfo).Data))
            expect(ids.has(player.id)).toBe(true);
        else {
          const ranking = object(value).mvpRanking;
          if (Array.isArray(ranking))
            for (const player of ranking)
              expect(ids.has(String(object(player).playerId))).toBe(true);
        }
      }
    for (const player of manifest.players)
      for (const key of [
        'info:' + player.id,
        'analysis:' + player.id,
        'myMatches:' + player.id + ':10',
      ])
        expect(records.has(key)).toBe(true);
    expect(records.size).toBe(manifest.matches.length * 2 + manifest.players.length * 3);
    expect(records.size).toBe(
      Object.values(manifest.counts).reduce((sum, count) => sum + count.recorded, 0),
    );
    expect(ids.size).toBe(manifest.players.length);
  });

  it('preserves every success and recorded failure during forced offline requests without evicting old endpoints', async () => {
    expect(Number(db.sql.prepare('SELECT COUNT(*) AS n FROM api_cache').get()!.n)).toBeGreaterThan(
      2000,
    );
    for (const [key, record] of records) {
      const request = client.get('/api/offline-regression', key, 0, { force: true });
      if (record.error)
        await expect(request).rejects.toMatchObject({ message: record.error, attempts: 0 });
      else {
        const result = await request;
        expect(result).toMatchObject({ source: 'stale', at: record.at, attempts: 0 });
        expect(hash(JSON.stringify(result.value))).toBe(record.valueHash);
      }
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  }, 60000);

  it('opens and refreshes every recorded player profile with the captured report and recent-match availability', async () => {
    for (const player of manifest.players) {
      const profile = await tracker.profile(player.id, true);
      expect(profile.id).toBe(player.id);
      expect(profile.name.trim().length).toBeGreaterThan(0);
      const recent = records.get('myMatches:' + player.id + ':10')!;
      if (!recent.error) expect(profile.recentMatches).toHaveLength(recent.recentCount!);
      const analysis = records.get('analysis:' + player.id)!;
      const info = records.get('info:' + player.id)!;
      if (!analysis.error) expect(profile.info).toMatchObject({ fallback: false, stale: true });
      else if (!info.error) expect(profile.info).toMatchObject({ fallback: true, stale: true });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  }, 60000);

  it('finds recorded players and their actual ratings without adding fabricated encounter history', async () => {
    const player = manifest.players.find(
      (candidate) =>
        candidate.id.length >= 5 &&
        !db.player(candidate.id) &&
        !records.get('info:' + candidate.id)!.error,
    )!;
    expect(player).toBeDefined();
    const info = object(object(db.cache('info:' + player.id, true)!.value).info);
    const before = db.player(player.id, true);
    const encounters = db.encounters(player.id);
    const result = db.localSearch(player.id, true).find((candidate) => candidate.id === player.id)!;
    expect(result).toMatchObject({
      id: player.id,
      name: info.name,
      level: info.level ?? null,
      rating: info.rating ?? null,
    });
    expect(db.localSearch(player.id).some((candidate) => candidate.id === player.id)).toBe(false);
    expect((await analyzer.report(player.id, true)).name).toBe(info.name);
    expect(db.player(player.id)).toBeNull();
    expect(db.player(player.id, true)).toEqual(before);
    expect(db.encounters(player.id)).toEqual(encounters);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('opens all fixture match details and keeps unavailable match errors reproducible offline', async () => {
    for (const id of manifest.matches) {
      const recorded = records.get('match:' + id)!;
      if (recorded.error) await expect(tracker.detail(id, true)).rejects.toThrow(recorded.error);
      else {
        const match = await tracker.detail(id, true);
        expect(match.fid).toBe(id);
        expect(match.players.length).toBeGreaterThan(0);
        expect(match.durationSec).not.toBeNull();
        expect(match.titles).toBeDefined();
        expect(match.scoreLabels).toBeDefined();
      }
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  }, 30000);

  it('enriches a historical log-only row from its captured match without changing the stored log facts', async () => {
    const full = await tracker.detail('9227650', true);
    const target = new Database(':memory:');
    const offline = new BatraceClient(target, { fetch: fetchImpl, offline: true }, '4.3.0');
    try {
      const original = {
        ...full,
        source: 'log' as const,
        outcome: 'unknown' as const,
        mode: 'unknown' as const,
        winnerTeamId: null,
        eloBefore: null,
        eloAfter: null,
        players: full.players.map((player) => ({
          ...emptyPlayer(player.id, player.name),
          teamId: player.teamId,
        })),
      };
      target.saveMatch(original);
      target.saveCache('match:9227650', db.cache('match:9227650', true)!.value, 1, 1);
      target.setState('offlineBatraceFixture', { capturedAt: manifest.capturedAt });
      const result = new TrackerService(target, offline, new Analyzer(offline, target)).list()[0]!;
      expect(result.players.some((player) => (player.destructionScore ?? 0) > 0)).toBe(true);
      expect(result.mode).toBe('ranked');
      expect(result.outcome).not.toBe('unknown');
      expect(target.match(original.id)!.source).toBe('log');
      expect(
        target.match(original.id)!.players.every((player) => player.destructionScore === null),
      ).toBe(true);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await offline.close();
      target.close();
    }
  });

  it('navigates recorded recent-match summaries without inventing unit details or fetching the network', async () => {
    const fixture = db.state<{ summaryMatchIds: string[] }>('offlineBatraceFixture', {
      summaryMatchIds: [],
    });
    expect(fixture.summaryMatchIds.length).toBeGreaterThan(0);
    for (const id of fixture.summaryMatchIds.slice(0, 30)) {
      expect((await tracker.detail(id, true)).fid).toBe(id);
      const raw = object(db.cache('match:' + id, true)!.value);
      for (const player of Object.values(object(object(raw.matchInfo).Data)))
        expect(object(player)).not.toHaveProperty('UnitData');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('calculates the active account Maggot Index from the recorded ranked analyses', async () => {
    const result = await analyzer.maggot(activeAccountId, () => {});
    expect(result.complete).toBe(true);
    expect(result.rows).toHaveLength(12);
    expect(result.calls).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a corrupted response shard before returning its records', async () => {
    const corrupted = { ...manifest, files: [{ ...manifest.files[0]!, sha256: '0'.repeat(64) }] };
    await expect(
      (async () => {
        for await (const record of readOfflineFixtureRecords(directory, corrupted)) void record;
      })(),
    ).rejects.toThrow(/checksum is invalid/);
  });

  it('rolls back a partially imported archive when a later shard fails its checksum', async () => {
    await mkdir(root, { recursive: true });
    const work = await mkdtemp(join(root, 'run-'));
    temporary.push(work);
    const destination = join(work, 'batrace/offline');
    await mkdir(destination, { recursive: true });
    await mkdir(join(work, 'batrace/history'), { recursive: true });
    await mkdir(join(work, 'real'), { recursive: true });
    await Promise.all([
      copyFile(resolve(directory, '../../real/manifest.json'), join(work, 'real/manifest.json')),
      copyFile(
        resolve(directory, '../history/manifest.json'),
        join(work, 'batrace/history/manifest.json'),
      ),
      copyFile(
        resolve(directory, '../history/medal-manifest.json'),
        join(work, 'batrace/history/medal-manifest.json'),
      ),
      copyFile(
        join(directory, manifest.files[0]!.path),
        join(destination, manifest.files[0]!.path),
      ),
    ]);
    const second = manifest.files[1]!;
    await writeFile(join(destination, second.path), 'Corrupted recorded responses');
    await writeFile(
      join(destination, 'manifest.json'),
      JSON.stringify({ ...manifest, files: manifest.files.slice(0, 2) }),
    );
    const target = new Database(':memory:');
    try {
      target.saveCache('existing', { retained: true }, 1000);
      await expect(seedOfflineFixtureCaches(target, destination)).rejects.toThrow(
        /checksum is invalid/,
      );
      expect(target.sql.prepare('SELECT COUNT(*) AS n FROM api_cache').get()!.n).toBe(1);
      expect(target.sql.prepare('SELECT COUNT(*) AS n FROM players').get()!.n).toBe(0);
      expect(target.cache('existing', true)!.value).toEqual({ retained: true });
    } finally {
      target.close();
    }
  });

  it('keeps the online freshness requirement for Maggot Index queries', async () => {
    const onlineDb = new Database(':memory:');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('Network unavailable');
    });
    const online = new BatraceClient(onlineDb, { fetch }, '4.3.0');
    try {
      onlineDb.saveCache(
        'analysis:' + activeAccountId,
        db.cache('analysis:' + activeAccountId, true)!.value,
        1,
        1,
      );
      await expect(
        new Analyzer(online, onlineDb).maggot(activeAccountId, () => {}),
      ).rejects.toThrow('Fresh ranked match data is required');
    } finally {
      await online.close();
      onlineDb.close();
    }
  });
});
