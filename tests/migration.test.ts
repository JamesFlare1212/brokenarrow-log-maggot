import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from '../apps/server/src/storage/database';
import { migrateLegacy } from '../apps/server/src/storage/migrate';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const fixtureRoot = resolve(process.cwd(), '.test-data', 'migrations');
let dir: string;
let db: Database;

beforeEach(async () => {
  vi.mocked(writeFile).mockReset().mockImplementation(actualFs.writeFile);
  await mkdir(fixtureRoot, { recursive: true });
  dir = await mkdtemp(join(fixtureRoot, 'case-'));
  db = new Database(':memory:');
});
afterEach(async () => {
  db.close();
  vi.restoreAllMocks();
  const target = resolve(dir),
    child = relative(fixtureRoot, target);
  if (!child || child.startsWith('..') || isAbsolute(child))
    throw new Error(`Unsafe fixture cleanup: ${target}`);
  await rm(target, { recursive: true, force: true });
});

async function source(file: string, value: unknown): Promise<Buffer> {
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  await writeFile(join(dir, file), bytes);
  return bytes;
}
function rows(table: string): number {
  const allowed = [
    'legacy_imports',
    'players',
    'player_names',
    'accounts',
    'matches',
    'match_players',
    'match_views',
    'legacy_encounters',
    'bans',
    'player_snapshots',
    'api_cache',
  ];
  if (!allowed.includes(table)) throw new Error('Unknown test table');
  return Number(db.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n);
}
function rawImport(file: string): { raw: string; sha256: string } | null {
  const row = db.sql.prepare('SELECT raw_json,sha256 FROM legacy_imports WHERE file=?').get(file);
  return row ? { raw: String(row.raw_json), sha256: String(row.sha256) } : null;
}

describe('legacy migration integrity', () => {
  it('removes retired request counters from an existing database without changing other data', () => {
    db.close();
    const file = join(dir, 'application.sqlite');
    db = new Database(file);
    db.updateConfig({ theme: 'forest' });
    db.saveCache('info:1', { name: 'One' }, 60_000);
    db.setState('activeAccountId', '1');
    db.setState('apiAttemptTotal', 400);
    db.sql.exec(`
      CREATE TABLE api_calls(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,path TEXT NOT NULL) STRICT;
      CREATE INDEX calls_time ON api_calls(at);
      INSERT INTO api_calls(at,path) VALUES(1,'/api/example');
    `);
    db.close();
    db = new Database(file);
    expect(
      db.sql
        .prepare("SELECT name FROM sqlite_master WHERE name IN ('api_calls','calls_time')")
        .all(),
    ).toEqual([]);
    expect(db.state('apiAttemptTotal', null)).toBeNull();
    expect(db.config().theme).toBe('forest');
    expect(db.cache('info:1', true)?.value).toEqual({ name: 'One' });
    expect(db.state('activeAccountId', null)).toBe('1');
  });

  it('ignores obsolete usage files without blocking migration or modifying the original', async () => {
    const bytes = Buffer.from('{obsolete and invalid JSON');
    await writeFile(join(dir, 'api-usage.json'), bytes);
    await source('settings.json', { theme: 'forest' });
    const status = await migrateLegacy(db, dir);
    expect(status.completed).toBe(true);
    expect(status.warnings).toEqual([]);
    expect(Object.keys(status.imported)).toEqual(['settings.json']);
    expect(status.imported['settings.json']).toBeGreaterThan(0);
    expect(db.config().theme).toBe('forest');
    expect(await readFile(join(dir, 'api-usage.json'))).toEqual(bytes);
    expect(rawImport('api-usage.json')).toBeNull();
  });

  it('imports every source and preserves extra fields and bytes', async () => {
    const at = 2_000_000_000_000;
    const inputs = new Map<string, Buffer>();
    const settings = {
      theme: 'forest',
      lang: 'ru',
      autoQueryCurrentMatch: false,
      heartbeatEnabled: false,
      roomPresenceEnabled: true,
      multiAccountBond: false,
      replayAudio: 'off',
      replayQuality: 240,
      replayFps: 60,
      replayBitrateMbps: 3,
      panelOrder: ['maggot', 'deck', 'ban', 'archive'],
      batraceExtraHeaders: { 'X-Test': 'fixture-only' },
      futureSetting: { enabled: false, count: 0 },
    };
    const settingsBytes = Buffer.from('\uFEFF' + JSON.stringify(settings, null, 2));
    await writeFile(join(dir, 'settings.json'), settingsBytes);
    inputs.set('settings.json', settingsBytes);
    inputs.set(
      'players-db.json',
      await source('players-db.json', {
        version: 2,
        players: {
          '1': {
            names: [{ name: '本人', firstSeen: 0, lastSeen: at }],
            firstSeen: 0,
            lastSeen: at,
            lobbySeen: 3,
          },
        },
        localAccounts: { '1': { name: '本人', persona: '本人', firstSeen: 0, lastSeen: at } },
        localId: '1',
        matches: {
          '9': {
            fid: '9',
            players: [
              { id: '1', name: '本人', teamId: 1, oldRating: 0, newRating: 0 },
              { id: '2', name: 'Other', teamId: 0 },
            ],
            localPlayerId: '1',
            mode: 'custom',
            winnerTeam: 0,
            localWon: false,
            endTime: at,
            durationSec: 0,
            points: 0,
            firstSeenAt: 0,
            syncedAt: at,
            extraMatchField: { score: 0 },
          },
        },
        knownBans: {
          '3': {
            name: 'Banned',
            steamId: '76561198000000001',
            rating: 0,
            firstSeenAt: 0,
            lastSeenAt: at,
            encountered: true,
          },
        },
        playerSnapshots: {
          '4': {
            name: 'Snapshot only',
            elo: 0,
            kd: null,
            winRate: 0,
            matchCount: 0,
            at: 0,
            futureSnapshot: true,
          },
        },
        lastBanSync: 0,
        lastMatchSync: at,
        futureDatabaseField: ['retained'],
      }),
    );
    inputs.set(
      'match-archive.json',
      await source('match-archive.json', [
        {
          fid: '9',
          players: [{ id: '1', name: 'Older', team: 'Alpha' }],
          endTime: at - 100,
          durationSec: 40,
          scenario: 'scenario',
          localDeck: 'deck',
          archivedAt: at,
          futureArchive: true,
        },
      ]),
    );
    inputs.set(
      'batrace-cache.json',
      await source('batrace-cache.json', {
        'info:4': { t: at, value: { empty: null, count: 0, active: false } },
      }),
    );
    const deck = {
      pkgKey: 'persona:Old',
      pkgName: 'Old',
      pkgFid: '9',
      pkgUpdatedAt: 0,
      alertedPairs: ['persona:Old>persona:New'],
      futureDeck: false,
    };
    inputs.set('deck-sync.json', await source('deck-sync.json', deck));
    const health = {
      state: 'partial',
      checks: [{ path: '/example', ok: false, ms: 0, status: 503 }],
      at: 0,
      okCount: 0,
      total: 1,
      futureHealth: true,
    };
    inputs.set('api-health.json', await source('api-health.json', health));

    const status = await migrateLegacy(db, dir);
    expect(status.completed).toBe(true);
    expect(status.warnings).toEqual([]);
    expect(Object.keys(status.imported).sort()).toEqual([...inputs.keys()].sort());
    expect(status.imported['players-db.json']).toBe(5);
    expect(status.imported['match-archive.json']).toBe(1);
    expect(status.imported['batrace-cache.json']).toBe(1);
    expect(status.imported['deck-sync.json']).toBe(1);
    expect(status.imported['api-health.json']).toBe(1);
    expect(status.imported['settings.json']).toBeGreaterThan(0);
    expect(db.config()).toMatchObject({
      theme: 'forest',
      lang: 'zh',
      autoQueryCurrentMatch: false,
      replayAudio: 'off',
      replayQuality: 240,
      replayFps: 60,
      replayBitrateMbps: 3,
      multiAccountBond: false,
    });
    expect(db.config().panelOrder.slice(0, 4)).toEqual(['players', 'decks', 'bans', 'archive']);
    expect(db.state('privateHeaders', {})).toEqual(settings.batraceExtraHeaders);
    expect(db.config()).not.toHaveProperty('batraceExtraHeaders');
    expect(db.config()).not.toHaveProperty('heartbeatEnabled');
    expect(db.config()).not.toHaveProperty('roomPresenceEnabled');
    expect(db.match('9')).toMatchObject({
      endedAt: at,
      durationSec: 0,
      points: 0,
      outcome: 'loss',
      eloBefore: 0,
      eloAfter: 0,
      scenario: 'scenario',
      localDeck: 'deck',
    });
    expect(db.match('9')?.players).toHaveLength(2);
    expect(rows('match_players')).toBe(2);
    expect(db.snapshot('4')).toMatchObject({
      elo: 0,
      kd: null,
      winRate: 0,
      matchCount: 0,
      updatedAt: 0,
    });
    expect(db.state('deckSync', {})).toEqual(deck);
    expect(db.state('health', {})).toEqual(health);
    expect(db.state('lastBanSync', -1)).toBe(0);
    expect(db.state('lastMatchSync', -1)).toBe(at);
    expect(rows('legacy_imports')).toBe(6);
    for (const [file, bytes] of inputs) {
      expect(await readFile(join(dir, file))).toEqual(bytes);
      expect(await readFile(join(status.backupDir!, file))).toEqual(bytes);
      expect(rawImport(file)).toEqual({
        raw: bytes.toString('utf8'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    expect(JSON.parse(rawImport('players-db.json')!.raw).futureDatabaseField).toEqual(['retained']);
    expect(
      JSON.parse(rawImport('settings.json')!.raw.replace(/^\uFEFF/, '')).futureSetting,
    ).toEqual({ enabled: false, count: 0 });
  });

  it.each([
    ['settings.json', null],
    ['settings.json', []],
    ['players-db.json', null],
    ['players-db.json', 'wrong'],
    ['players-db.json', { version: 2, players: null }],
    ['players-db.json', { version: 3, players: {} }],
    ['players-db.json', { players: { '1': { names: 1 } } }],
    ['players-db.json', { matches: { '9': { players: [null] } } }],
    ['match-archive.json', {}],
    ['match-archive.json', [null]],
    ['batrace-cache.json', []],
    ['batrace-cache.json', { 'info:1': { t: 1 } }],
    ['batrace-cache.json', { 'info:1': { t: null, value: {} } }],
    ['deck-sync.json', []],
    ['deck-sync.json', { alertedPairs: 'wrong' }],
    ['api-health.json', null],
    ['api-health.json', { state: 'ok', checks: {} }],
  ] as Array<[string, unknown]>)(
    'rejects malformed %s without an import marker',
    async (file, value) => {
      const bytes = await source(file, value);
      const status = await migrateLegacy(db, dir);
      expect(status.completed).toBe(false);
      expect(status.warnings.some((warning) => warning.startsWith(file + ':'))).toBe(true);
      expect(status.imported).not.toHaveProperty(file);
      expect(rawImport(file)).toBeNull();
      expect(await readFile(join(dir, file))).toEqual(bytes);
      expect(await readFile(join(status.backupDir!, file))).toEqual(bytes);
    },
  );

  it('ignores retired telemetry files and preserves malformed JSON for repair', async () => {
    const broken = Buffer.from('{ incomplete');
    await writeFile(join(dir, 'players-db.json'), broken);
    await writeFile(join(dir, 'heartbeat-uid.txt'), ' \r\n');
    const status = await migrateLegacy(db, dir);
    expect(status.completed).toBe(false);
    expect(status.warnings).toHaveLength(1);
    expect(status.imported).not.toHaveProperty('heartbeat-uid.txt');
    expect(db.state('heartbeatId', null)).toBeNull();
    expect(await readFile(join(dir, 'heartbeat-uid.txt'), 'utf8')).toBe(' \r\n');
    expect(rows('legacy_imports')).toBe(0);
    expect(await readFile(join(status.backupDir!, 'players-db.json'))).toEqual(broken);
    expect(await readFile(join(dir, 'players-db.json'))).toEqual(broken);
  });

  it('retries a repaired source without overwriting its old backup or reimporting successful sources', async () => {
    await source('settings.json', { theme: 'forest' });
    const invalid = await source('players-db.json', null);
    const first = await migrateLegacy(db, dir);
    expect(first.completed).toBe(false);
    expect(rows('legacy_imports')).toBe(1);
    db.updateConfig({ theme: 'ocean' });
    await source('settings.json', { theme: 'light' });
    const repaired = await source('players-db.json', { version: 2, matches: {}, players: {} });
    const second = await migrateLegacy(db, dir);
    expect(second.completed).toBe(true);
    expect(second.warnings).toEqual([]);
    expect(second.backupDir).toBe(first.backupDir);
    expect(db.config().theme).toBe('ocean');
    expect(rows('legacy_imports')).toBe(2);
    expect(await readFile(join(first.backupDir!, 'players-db.json'))).toEqual(invalid);
    expect(
      await readFile(
        join(
          first.backupDir!,
          'players-db.json.' + createHash('sha256').update(repaired).digest('hex'),
        ),
      ),
    ).toEqual(repaired);
    expect(rawImport('players-db.json')?.raw).toBe(repaired.toString());
  });

  it('backs up the captured source bytes even when the source changes before backup', async () => {
    const captured = await source('settings.json', { theme: 'forest', marker: 'captured' });
    const changed = Buffer.from(JSON.stringify({ theme: 'light', marker: 'changed' }));
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      await actualFs.writeFile(join(dir, 'settings.json'), changed);
      await actualFs.writeFile(...args);
    });
    const status = await migrateLegacy(db, dir);
    expect(db.config().theme).toBe('forest');
    expect(await readFile(join(status.backupDir!, 'settings.json'))).toEqual(captured);
    expect(rawImport('settings.json')?.sha256).toBe(
      createHash('sha256').update(captured).digest('hex'),
    );
    expect(await readFile(join(dir, 'settings.json'))).toEqual(changed);
  });

  it('preserves unrelated existing backups and writes a separate immutable snapshot', async () => {
    const backupDir = join(dir, 'migration-backups', 'existing');
    await mkdir(backupDir, { recursive: true });
    await writeFile(join(backupDir, 'settings.json'), 'older backup');
    db.setState('migration', { completed: false, imported: {}, warnings: [], backupDir });
    const bytes = await source('settings.json', { theme: 'cyan' });
    vi.mocked(writeFile).mockClear();
    const status = await migrateLegacy(db, dir);
    expect(status.completed).toBe(true);
    expect(await readFile(join(backupDir, 'settings.json'), 'utf8')).toBe('older backup');
    expect(
      await readFile(
        join(backupDir, 'settings.json.' + createHash('sha256').update(bytes).digest('hex')),
      ),
    ).toEqual(bytes);
    expect(
      vi
        .mocked(writeFile)
        .mock.calls.every((call) => typeof call[2] === 'object' && call[2]?.flag === 'wx'),
    ).toBe(true);
  });

  it('rolls back all database writes and completion markers if an import fails, then permits retry', async () => {
    db.updateConfig({ theme: 'ocean' });
    db.setState('activeAccountId', 'existing-account');
    const bytes = await source('players-db.json', {
      version: 2,
      players: { '1': { names: ['One'], firstSeen: 1, lastSeen: 2 } },
      matches: { '9': { players: [{ id: '1', name: 'One' }] } },
    });
    await source('settings.json', { theme: 'forest' });
    await source('batrace-cache.json', { 'info:1': { t: 10, value: { id: '1' } } });
    const failure = vi.spyOn(db, 'saveCache').mockImplementationOnce(() => {
      throw new Error('injected storage failure');
    });
    await expect(migrateLegacy(db, dir)).rejects.toThrow('injected storage failure');
    expect(db.config().theme).toBe('ocean');
    expect(db.state('activeAccountId', '')).toBe('existing-account');
    expect(db.state('migration', null)).toBeNull();
    for (const table of [
      'players',
      'player_names',
      'matches',
      'match_players',
      'legacy_imports',
      'api_cache',
    ])
      expect(rows(table)).toBe(0);
    expect(await readFile(join(dir, 'players-db.json'))).toEqual(bytes);
    failure.mockRestore();
    const retried = await migrateLegacy(db, dir);
    expect(retried.completed).toBe(true);
    expect(db.config().theme).toBe('forest');
    expect(rows('matches')).toBe(1);
    expect(rows('legacy_imports')).toBe(3);
  });

  it('keeps the latest dated name and every string alias regardless of array order', async () => {
    await source('players-db.json', {
      players: {
        '1': {
          names: [
            { name: 'Alice', firstSeen: 100, lastSeen: 500 },
            { name: 'Bob', firstSeen: 200, lastSeen: 400 },
            '古い別名',
          ],
          firstSeen: 100,
          lastSeen: 500,
        },
        '2': { names: ['Old', '最新'], firstSeen: 0, lastSeen: 600 },
        '3': { names: [], firstSeen: null, lastSeen: null },
      },
    });
    await migrateLegacy(db, dir);
    expect(db.player('1')?.name).toBe('Alice');
    expect(new Set(db.player('1')?.names.map((n) => n.name))).toEqual(
      new Set(['Alice', 'Bob', '古い別名']),
    );
    expect(db.player('1')?.names.find((n) => n.name === 'Alice')).toMatchObject({
      firstSeen: 100,
      lastSeen: 500,
    });
    expect(db.player('2')?.name).toBe('最新');
    expect(db.player('2')).toMatchObject({ firstSeen: 0, lastSeen: 600 });
    expect(db.player('3')).toMatchObject({ firstSeen: null, lastSeen: null });
  });

  it('does not replace a newer observed name with older imported history', async () => {
    db.observe([{ id: '1', name: 'Live name' }], 1000);
    await source('players-db.json', {
      players: {
        '1': {
          names: [{ name: 'Old', firstSeen: 100, lastSeen: 500 }],
          firstSeen: 100,
          lastSeen: 500,
        },
      },
    });
    await migrateLegacy(db, dir);
    expect(db.player('1')).toMatchObject({ name: 'Live name', firstSeen: 100, lastSeen: 1000 });
    expect(new Set(db.player('1')?.names.map((n) => n.name))).toEqual(
      new Set(['Old', 'Live name']),
    );
  });

  it('groups v1 numeric FIDs while preserving unowned and non-FID encounters exactly', async () => {
    const missing = {
      fid: null,
      at: 0,
      map: 'unknown',
      myTeam: 'Alpha',
      theirTeam: null,
      won: false,
      future: { value: 0 },
    };
    const temporary = { fid: 't:123', at: 123, won: null, spectator: false };
    await source('players-db.json', {
      version: 1,
      localId: '1',
      players: {
        '2': {
          names: ['Opponent'],
          encounters: [
            { fid: '9', at: 100, map: 'Baltiisk', myTeam: 'Alpha', theirTeam: 'Bravo', won: true },
            missing,
            temporary,
          ],
        },
        '3': {
          names: ['Spectator'],
          encounters: [{ fid: '9', at: 100, spectator: true, won: null }],
        },
      },
    });
    const status = await migrateLegacy(db, dir);
    expect(status.imported['players-db.json']).toBe(6);
    expect(db.state('activeAccountId', null)).toBe('1');
    expect(db.accounts().map((a) => a.id)).toContain('1');
    expect(rows('matches')).toBe(1);
    expect(rows('legacy_encounters')).toBe(4);
    expect(rows('match_views')).toBe(0);
    expect(db.match('9')).toMatchObject({ localPlayerId: null, outcome: 'unknown' });
    expect(db.match('9')?.players.map((p) => [p.id, p.teamId])).toEqual([
      ['2', 1],
      ['3', 100],
    ]);
    const originals = db.sql
      .prepare('SELECT payload FROM legacy_encounters WHERE player_id=?')
      .all('2')
      .map((row) => JSON.parse(String(row.payload)) as unknown);
    expect(originals).toContainEqual(missing);
    expect(originals).toContainEqual(temporary);
    db.deleteAccount('1');
    expect(db.match('9')).not.toBeNull();
    expect(rows('legacy_encounters')).toBe(4);
  });

  it('infers a v2 owner only for one known account and preserves zero/false local summaries', async () => {
    await source('players-db.json', {
      version: 2,
      players: {},
      localId: '1',
      localAccounts: {
        '1': { name: 'A', firstSeen: 0, lastSeen: 0 },
        '2': { name: 'B', firstSeen: 0, lastSeen: 0 },
      },
      matches: {
        '11': {
          players: [
            { id: '1', name: 'A', teamId: null },
            { id: '3', name: 'Target', teamId: 1 },
          ],
          localPlayerId: null,
          localTeamId: 0,
          localEloAfter: 0,
          localEloDelta: 0,
          localScores: { destruction: 0, losses: 0, objectives: 0 },
          localWon: false,
          winnerTeam: 1,
          mode: 'custom',
          points: 0,
          durationSec: 0,
          endTime: 0,
          restarted: false,
        },
        '12': {
          players: [
            { id: '1', name: 'A', teamId: 0 },
            { id: '2', name: 'B', teamId: 1 },
          ],
        },
        '13': { players: [{ id: '3', name: 'Target', teamId: null }] },
        '14': {
          localPlayerId: '2',
          players: [
            { id: '1', name: 'A', teamId: 0 },
            { id: '2', name: 'B', teamId: 100 },
          ],
          localSpectator: true,
          localWon: false,
        },
      },
    });
    await migrateLegacy(db, dir);
    expect(db.match('11')).toMatchObject({
      localPlayerId: '1',
      outcome: 'loss',
      eloBefore: 0,
      eloAfter: 0,
      points: 0,
      durationSec: 0,
      endedAt: 0,
      restarted: false,
    });
    expect(db.match('11')?.players.find((p) => p.id === '1')).toMatchObject({
      teamId: 0,
      oldRating: 0,
      newRating: 0,
      destructionScore: 0,
      lossesScore: 0,
      objectivesCaptured: 0,
    });
    expect(db.match('12')?.localPlayerId).toBeNull();
    expect(db.match('13')?.localPlayerId).toBeNull();
    expect(db.match('14')).toMatchObject({ localPlayerId: '2', outcome: 'spectator' });
    expect(rows('match_views')).toBe(2);
    db.deleteAccount('1');
    expect(db.match('12')).not.toBeNull();
    expect(db.match('13')).not.toBeNull();
    expect(db.match('14')).not.toBeNull();
  });

  it('preserves every archive without a FID using stable unique internal IDs', async () => {
    const archives = [
      { fid: null, map: 'First', startTime: 0, endTime: null, players: [] },
      { fid: null, map: 'First', startTime: 0, endTime: null, players: [] },
      { fid: 't:123', map: 'Second', players: [] },
    ];
    await source('match-archive.json', { matches: archives, extraArchiveMetadata: false });
    const first = await migrateLegacy(db, dir);
    const ids = db
      .matches()
      .map((m) => m.id)
      .sort();
    expect(first.imported['match-archive.json']).toBe(3);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(
      db
        .matches()
        .every((m) => m.fid === null && m.localPlayerId === null && m.id.startsWith('legacy:')),
    ).toBe(true);
    expect(
      db
        .matches()
        .filter((m) => m.map === 'First')
        .every((m) => m.startedAt === 0),
    ).toBe(true);
    await migrateLegacy(db, dir);
    expect(
      db
        .matches()
        .map((m) => m.id)
        .sort(),
    ).toEqual(ids);
  });

  it('keeps 2001 cache entries and their original namespace TTLs, including falsy values', async () => {
    const at = 1_000_000_000_000;
    const cache: Record<string, { t: number; value: unknown }> = {};
    for (let i = 0; i < 2001; i++) cache[`info:${i}`] = { t: at + i, value: { id: String(i) } };
    const ttlCases: Array<[string, number, unknown]> = [
      ['search:test:20', 600000, false],
      ['analysis:1', 21600000, 0],
      ['pmatches:1:0', 21600000, null],
      ['myMatches:1:10', 1800000, []],
      ['ban:500:0', 3600000, {}],
      ['match:9', 86400000, {}],
      ['amatch:9', 86400000, {}],
      ['units', 604800000, {}],
    ];
    for (const [key, , value] of ttlCases) cache[key] = { t: at, value };
    await source('batrace-cache.json', cache);
    const first = await migrateLegacy(db, dir);
    expect(first.imported['batrace-cache.json']).toBe(2009);
    expect(rows('api_cache')).toBe(2009);
    expect(db.cache('info:0', true, at + 21600001)?.at).toBe(at);
    expect(db.cache('info:2000', false, at + 2000)).not.toBeNull();
    for (const [key, ttl, value] of ttlCases) {
      expect(db.cache(key, false, at + ttl - 1)).toEqual({ value, at, stale: false });
      expect(db.cache(key, false, at + ttl)).toBeNull();
      expect(db.cache(key, true, at + ttl)).toEqual({ value, at, stale: true });
    }
    await migrateLegacy(db, dir);
    expect(rows('api_cache')).toBe(2009);
  });

  it('is idempotent across reopening a database and does not resurrect deleted matches', async () => {
    db.close();
    const file = join(dir, 'application.sqlite');
    db = new Database(file);
    await source('players-db.json', { version: 2, players: {}, matches: { '9': { players: [] } } });
    const first = await migrateLegacy(db, dir);
    expect(first.completed).toBe(true);
    db.deleteMatch('9');
    db.close();
    db = new Database(file);
    const second = await migrateLegacy(db, dir);
    expect(second).toEqual(first);
    expect(db.match('9')).toBeNull();
    expect(rows('legacy_imports')).toBe(1);
    expect(await readdir(join(dir, 'migration-backups'))).toHaveLength(1);
  });

  it('completes an empty legacy directory without manufacturing backup files', async () => {
    const status = await migrateLegacy(db, dir);
    expect(status).toEqual({ completed: true, imported: {}, warnings: [], backupDir: null });
    expect(rows('legacy_imports')).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('records accepted configuration fallbacks without blocking a structurally valid source', async () => {
    const bytes = await source('settings.json', {
      theme: 'unsupported',
      replayQuality: 999,
      replayFps: 0,
      replayBitrateMbps: 0,
    });
    const status = await migrateLegacy(db, dir);
    expect(status.completed).toBe(true);
    expect(status.warnings).toContain('settings.json: invalid theme, default retained');
    expect(db.config()).toMatchObject({
      theme: 'dark',
      replayQuality: 720,
      replayFps: 30,
      replayBitrateMbps: 3,
    });
    expect(rawImport('settings.json')?.raw).toBe(bytes.toString());
    expect(await migrateLegacy(db, dir)).toEqual(status);
  });
});
