import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Match } from '@ba/contracts';
import {
  loadRealData,
  prepareRealData,
  realMatchFacts,
  seedRealData,
  writeRealLogs,
  type RealData,
  type RealDataManifest,
} from '../apps/server/src/dev/real-data';
import { LogArchive } from '../apps/server/src/logs/archive';
import { LogParser } from '../apps/server/src/logs/parser';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { TrackerService } from '../apps/server/src/players/tracker';

const fixtures = resolve('tests/fixtures/real');
const root = resolve('.test-data/real-tests');
const directories: string[] = [];
const databases: Database[] = [];
const clients: BatraceClient[] = [];
let data: RealData;
let manifest: RealDataManifest;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function temporary(): Promise<string> {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  directories.push(directory);
  return directory;
}
function database(file = ':memory:'): Database {
  const db = new Database(file);
  databases.push(db);
  return db;
}
beforeAll(async () => {
  ({ data, manifest } = await loadRealData(fixtures));
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(root + (process.platform === 'win32' ? '\\' : '/')))
      throw new Error('Unsafe test cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('captured local real data', () => {
  it('matches the frozen parser facts for every original log and contains no credentials or local paths', () => {
    expect(data.logs).toHaveLength(manifest.source.logFiles);
    expect(manifest.source.logBytes).toBeGreaterThan(400_000_000);
    expect(manifest.expected.logMatches).toBeGreaterThan(400);
    let sessions = 0;
    let withoutFid = 0;
    const fids = new Set<string>();
    for (const [index, log] of data.logs.entries()) {
      const metadata = manifest.files[index]!;
      expect(log.path).toBe(metadata.path);
      expect(hash(log.content)).toBe(metadata.eventSha256);
      const matches = new Map<string, Match>();
      const parser = new LogParser((event) => {
        if (event.type === 'ended' || event.type === 'metadata')
          matches.set(event.match.sessionId, event.match);
      });
      parser.reset(log.path);
      parser.feed(log.content.split('\n'), true);
      const current = parser.snapshot().current;
      if (current) matches.set(current.sessionId, current);
      expect(hash(realMatchFacts(matches.values())), log.path).toBe(metadata.matchFactsSha256);
      sessions += matches.size;
      for (const match of matches.values()) {
        if (match.fid) fids.add(match.fid);
        else withoutFid++;
      }
    }
    expect({ sessions, withoutFid, uniqueFids: fids.size }).toEqual({
      sessions: manifest.expected.sessions,
      withoutFid: manifest.expected.withoutFid,
      uniqueFids: manifest.expected.uniqueFids,
    });
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(inspect);
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          expect(key).not.toMatch(
            /authorization|cookie|password|secret|credential|privateheaders|(?:access|refresh|session|auth)[_-]?token|api[_-]?key/i,
          );
          inspect(child);
        }
      }
    };
    inspect(data);
    for (const rows of Object.values(data.tables))
      for (const row of rows) if (typeof row.payload === 'string') inspect(JSON.parse(row.payload));
    expect(JSON.stringify(data)).not.toMatch(/[A-Z]:\\\\/i);
  });

  it('scans the entire real corpus and deduplicates repeated recovery', async () => {
    const dir = await temporary();
    await writeRealLogs(data, dir);
    const db = database();
    const changed = vi.fn();
    await new LogArchive(db, changed).scan(dir);
    expect(db.matches()).toHaveLength(manifest.expected.logMatches);
    expect(db.matches().filter((match) => match.fid)).toHaveLength(manifest.expected.uniqueFids);
    expect(db.matches().filter((match) => !match.fid)).toHaveLength(manifest.expected.withoutFid);
    const ids = db.matches().map((match) => match.id);
    await new LogArchive(db, changed).scan(dir);
    expect(db.matches().map((match) => match.id)).toEqual(ids);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('merges real API records and all local logs while preserving scores and account views', async () => {
    const dir = await temporary();
    await writeRealLogs(data, dir);
    const db = database();
    seedRealData(db, data, dir);
    const originals = db.matches(data.activeAccountId || undefined);
    expect(originals).toHaveLength(manifest.source.databaseMatches);
    await new LogArchive(db).scan(dir);
    expect(db.matches()).toHaveLength(manifest.expected.seededMatches);
    for (const original of originals) {
      const merged = db.match(original.id, data.activeAccountId)!;
      expect(merged).toMatchObject({
        source: original.source,
        outcome: original.outcome,
        mode: original.mode,
        eloBefore: original.eloBefore,
        eloAfter: original.eloAfter,
      });
      for (const player of original.players)
        expect(merged.players.find((candidate) => candidate.id === player.id)).toMatchObject(
          player,
        );
    }
    expect(db.config()).toMatchObject({
      logDir: dir,
      decksDir: join(dirname(dir), 'Decks'),
      replaySaveDir: join(dirname(dir), 'recordings'),
      autoQueryCurrentMatch: false,
      banPollEnabled: false,
      matchSyncEnabled: false,
      replayEnabled: false,
    });
    expect(db.state('privateHeaders', null)).toBeNull();
    expect(() => seedRealData(db, data, dir)).toThrow(/empty database/);
  });

  it('serves recorded API analysis and recent matches offline without fetching or inventing missing data', async () => {
    const db = database();
    seedRealData(db, data, '');
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new BatraceClient(db, { fetch: fetchImpl, offline: true }, '4.0.0');
    clients.push(client);
    const id = data.activeAccountId!;
    const analyzer = new Analyzer(client, db);
    const tracker = new TrackerService(db, client, analyzer);
    const cached = db.cache('analysis:' + id, true)!;
    expect(await client.analysisPlayer(id, true)).toMatchObject({
      source: 'stale',
      attempts: 0,
      at: cached.at,
      value: cached.value,
    });
    const profile = await tracker.profile(id, true);
    expect(profile.recentMatches.length).toBeGreaterThan(0);
    expect(profile.info?.stale).toBe(true);
    await expect(
      client.get('/api/missing', 'missing-fixture-response', 1000, { force: true }),
    ).rejects.toThrow(/no recorded response/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Both profiles import the complete recorded corpus before isolation can be checked.
  it('prepares independent writable development profiles without modifying the committed snapshot', async () => {
    const dir = await temporary();
    const one = await prepareRealData(fixtures, dir);
    const two = await prepareRealData(fixtures, dir);
    expect(one).not.toBe(two);
    const first = database(join(one, 'assistant.sqlite'));
    const second = database(join(two, 'assistant.sqlite'));
    expect(first.cache('amatch:9227650', true)).not.toBeNull();
    expect(first.cache('match:9227650', true)).not.toBeNull();
    const match = first.matches()[0]!;
    first.deleteMatch(match.id);
    expect(second.match(match.id)).not.toBeNull();
    expect((await loadRealData(fixtures)).manifest.sha256).toBe(manifest.sha256);
    await expect(
      writeRealLogs(
        { ...data, logs: [{ path: '../escape.log', content: 'log', modifiedAt: Date.now() }] },
        join(dir, 'logs'),
      ),
    ).rejects.toThrow(/escapes/);
  }, 30000);
});
