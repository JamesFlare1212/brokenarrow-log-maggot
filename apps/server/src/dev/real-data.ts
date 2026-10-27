import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Match, PublicConfig } from '@ba/contracts';
import { Database } from '../storage/database';
import { seedRecordedMatchCaches } from './match-fixtures';
import { seedOfflineFixtureCaches } from './offline-fixtures';

export const REAL_DATA_TABLES = [
  'players',
  'player_names',
  'accounts',
  'matches',
  'match_players',
  'match_views',
  'bans',
  'player_snapshots',
  'map_names',
  'api_cache',
  'deleted_log_matches',
] as const;
type FixtureValue = string | number | null;
export interface RealData {
  version: 1;
  capturedAt: number;
  preferences: Partial<PublicConfig>;
  activeAccountId: string | null;
  tables: Record<string, Record<string, FixtureValue>[]>;
  logs: Array<{ path: string; content: string; modifiedAt: number }>;
}
export interface RealDataManifest {
  version: 1;
  capturedAt: number;
  sha256: string;
  source: { logFiles: number; logBytes: number; databaseMatches: number; databasePlayers: number };
  expected: {
    sessions: number;
    uniqueFids: number;
    withoutFid: number;
    logMatches: number;
    seededMatches: number;
  };
  files: Array<{
    path: string;
    sourceSha256: string;
    sourceBytes: number;
    sourceLines: number;
    eventSha256: string;
    eventLines: number;
    matchFactsSha256: string;
  }>;
}

/** Stable golden facts exclude generated local IDs and local timezone conversion. */
export function realMatchFacts(matches: Iterable<Match>): string {
  return JSON.stringify(
    [...matches].map((match) => ({
      fid: match.fid,
      map: match.map,
      scenario: match.scenario,
      localPlayerId: match.localPlayerId,
      localPersona: match.localPersona,
      localDeck: match.localDeck,
      points: match.points,
      players: match.players,
      durationSec: match.durationSource === 'log' ? match.durationSec : null,
    })),
  );
}

export async function loadRealData(
  directory: string,
): Promise<{ data: RealData; manifest: RealDataManifest }> {
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8'),
  ) as RealDataManifest;
  const bytes = await readFile(join(directory, 'snapshot.json.gz'));
  if (
    manifest.version !== 1 ||
    createHash('sha256').update(bytes).digest('hex') !== manifest.sha256
  )
    throw new Error('Real-data fixture checksum or version is invalid');
  const data = JSON.parse(
    gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'),
  ) as RealData;
  if (data.version !== 1 || !Array.isArray(data.logs) || !data.tables)
    throw new Error('Unsupported real-data fixture');
  return { data, manifest };
}

/** Import only portable game data into an empty development/test database. */
export function seedRealData(db: Database, data: RealData, logDir: string): void {
  const profile = dirname(resolve(logDir || '.test-data/real-profile/GameLogs'));
  if (
    Number(db.sql.prepare('SELECT COUNT(*) n FROM players').get()?.n) !== 0 ||
    Number(db.sql.prepare('SELECT COUNT(*) n FROM matches').get()?.n) !== 0
  )
    throw new Error('Real-data fixtures require an empty database');
  db.transaction(() => {
    for (const table of REAL_DATA_TABLES) {
      const allowed = new Set(
        db.sql
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => String(column.name)),
      );
      for (const row of data.tables[table] || []) {
        const columns = Object.keys(row);
        if (!columns.length || columns.some((column) => !allowed.has(column)))
          throw new Error(`Unsupported fixture columns in ${table}`);
        db.sql
          .prepare(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
          )
          .run(...columns.map((column) => row[column]!));
      }
    }
    db.updateConfig({
      ...data.preferences,
      analyticsEnabled: false,
      analyticsChoiceSaved: true,
      logDir,
      // An empty decksDir would auto-detect the real game's writable Decks folder.
      decksDir: join(profile, 'Decks'),
      replaySaveDir: join(profile, 'recordings'),
      replayDisplayId: '',
      autoQueryCurrentMatch: false,
      banPollEnabled: false,
      matchSyncEnabled: false,
      inputHookEnabled: false,
      replayEnabled: false,
    });
    db.setState('activeAccountId', data.activeAccountId);
    db.setState('realDataFixture', { capturedAt: data.capturedAt });
  });
}

export async function writeRealLogs(data: RealData, directory: string): Promise<void> {
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  for (const log of data.logs) {
    const target = resolve(root, log.path);
    const child = relative(root, target);
    if (!child || isAbsolute(child) || child === '..' || child.startsWith('..' + sep))
      throw new Error('Fixture log path escapes its directory');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, log.content, { flag: 'wx' });
    await utimes(target, log.modifiedAt / 1000, log.modifiedAt / 1000);
  }
}

export async function prepareRealData(
  fixtureDirectory: string,
  developmentRoot: string,
): Promise<string> {
  const { data } = await loadRealData(fixtureDirectory);
  await mkdir(developmentRoot, { recursive: true });
  const userDir = await mkdtemp(join(resolve(developmentRoot), 'run-'));
  const logDir = join(userDir, 'GameLogs');
  await writeRealLogs(data, logDir);
  await mkdir(join(userDir, 'Decks'), { recursive: true });
  await mkdir(join(userDir, 'recordings'), { recursive: true });
  const db = new Database(join(userDir, 'assistant.sqlite'));
  try {
    seedRealData(db, data, logDir);
    await seedRecordedMatchCaches(db, resolve(fixtureDirectory, '../batrace/history'));
    await seedOfflineFixtureCaches(db, resolve(fixtureDirectory, '../batrace/offline'));
  } finally {
    db.close();
  }
  return userDir;
}
