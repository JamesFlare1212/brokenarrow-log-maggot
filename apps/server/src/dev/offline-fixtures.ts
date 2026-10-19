import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { object } from '@ba/shared';
import type { Database } from '../storage/database';

export type OfflineFixtureKind = 'match' | 'amatch' | 'info' | 'analysis' | 'myMatches';
export interface OfflineFixtureRecord {
  key: string;
  kind: OfflineFixtureKind;
  id: string;
  at: number;
  source: 'recorded' | 'network';
  value?: unknown;
  error?: string;
  requests: Array<{
    path: string;
    at: number;
    status: number | null;
    contentType: string | null;
    body: string | null;
    error?: string;
  }>;
}
export interface OfflineFixtureManifest {
  version: 1;
  capturedAt: number;
  completedAt: number;
  source: { realSha256: string; historySha256: string; medalSha256: string };
  matches: string[];
  players: Array<{ id: string; name: string }>;
  counts: Record<
    OfflineFixtureKind,
    {
      recorded: number;
      available: number;
      unavailable: number;
      requests: number;
    }
  >;
  files: Array<{ path: string; sha256: string; records: number; keys?: string[] }>;
}

export async function loadOfflineFixtureManifest(
  directory: string,
): Promise<OfflineFixtureManifest> {
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8'),
  ) as OfflineFixtureManifest;
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.players) ||
    !Array.isArray(manifest.matches)
  )
    throw new Error('Unsupported offline BATrace fixture manifest');
  const [real, history, medals] = await Promise.all([
    readFile(resolve(directory, '../../real/manifest.json'), 'utf8'),
    readFile(resolve(directory, '../history/manifest.json'), 'utf8'),
    readFile(resolve(directory, '../history/medal-manifest.json'), 'utf8'),
  ]);
  if (
    JSON.parse(real).sha256 !== manifest.source.realSha256 ||
    JSON.parse(history).sha256 !== manifest.source.historySha256 ||
    JSON.parse(medals).sha256 !== manifest.source.medalSha256
  )
    throw new Error('Offline BATrace fixture source checksum is invalid');
  return manifest;
}

/** Verify and stream shards so development startup never decompresses the entire archive at once. */
export async function* readOfflineFixtureRecords(
  directory: string,
  manifest: OfflineFixtureManifest,
  selectedKeys?: ReadonlySet<string>,
) {
  const keys = new Set<string>();
  for (const file of manifest.files) {
    if (!/^responses-\d{3,}\.json\.gz$/.test(file.path))
      throw new Error('Unsafe offline BATrace fixture path');
    if (selectedKeys && file.keys && !file.keys.some((key) => selectedKeys.has(key))) continue;
    const bytes = await readFile(join(directory, file.path));
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error('Offline BATrace fixture checksum is invalid: ' + file.path);
    const records = JSON.parse(
      gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'),
    ) as OfflineFixtureRecord[];
    if (!Array.isArray(records) || records.length !== file.records)
      throw new Error('Offline BATrace fixture record count is invalid');
    for (const record of records) {
      if (selectedKeys && !selectedKeys.has(record.key)) continue;
      const key = record.kind + ':' + record.id + (record.kind === 'myMatches' ? ':10' : '');
      if (
        !['match', 'amatch', 'info', 'analysis', 'myMatches'].includes(record.kind) ||
        !/^[1-9]\d*$/.test(record.id) ||
        record.key !== key ||
        !Number.isFinite(record.at) ||
        keys.has(key) ||
        (!record.error && !Object.hasOwn(record, 'value'))
      )
        throw new Error('Invalid or duplicate offline BATrace fixture record');
      keys.add(key);
      yield record;
    }
  }
  if (
    !selectedKeys &&
    keys.size !== Object.values(manifest.counts).reduce((sum, count) => sum + count.recorded, 0)
  )
    throw new Error('Offline BATrace fixture endpoint count is invalid');
}

/** Add recorded endpoints without the production cache's 2,000-entry eviction limit. */
export async function seedOfflineFixtureCaches(
  db: Database,
  directory: string,
  selection?: { playerIds: ReadonlySet<string>; matchIds: ReadonlySet<string> },
): Promise<OfflineFixtureManifest | null> {
  try {
    await readFile(join(directory, 'manifest.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const manifest = await loadOfflineFixtureManifest(directory);
  const selectedKeys = selection
    ? new Set([
        ...[...selection.playerIds].flatMap((id) => [
          'info:' + id,
          'analysis:' + id,
          'myMatches:' + id + ':10',
        ]),
        ...[...selection.matchIds].flatMap((id) => ['match:' + id, 'amatch:' + id]),
      ])
    : undefined;
  const failures: Record<string, { message: string; status?: number; at: number }> = {};
  const recent: OfflineFixtureRecord[] = [];
  db.sql.exec('SAVEPOINT offline_fixture_import');
  try {
    for (const player of manifest.players)
      if (!selection || selection.playerIds.has(player.id)) db.ensurePlayer(player.id, player.name);
    for await (const record of readOfflineFixtureRecords(directory, manifest, selectedKeys)) {
      if (record.error) {
        const status = record.requests.at(-1)?.status;
        failures[record.key] = {
          message: record.error,
          ...(status ? { status } : {}),
          at: record.at,
        };
        db.sql.prepare('DELETE FROM api_cache WHERE key=?').run(record.key);
        continue;
      }
      db.saveCache(record.key, record.value, 86400000, record.at, false);
      if (record.kind === 'info') {
        const info = object(object(record.value).info);
        if (typeof info.name === 'string' && info.name.trim())
          db.sql.prepare('UPDATE players SET name=? WHERE id=?').run(info.name, record.id);
      }
      if (record.kind === 'myMatches') recent.push(record);
    }
    // Recent-match summaries are genuine API data and support navigation without inventing unit data.
    const summaries = new Set<string>();
    for (const record of recent) {
      const matches = object(record.value).matches;
      if (!Array.isArray(matches)) continue;
      for (const value of matches) {
        const match = object(value),
          id = String(match.matchId),
          data = object(match.data);
        if (
          !/^[1-9]\d*$/.test(id) ||
          !data.Data ||
          typeof data.Data !== 'object' ||
          failures['match:' + id] ||
          db.cache('match:' + id, true)
        )
          continue;
        db.saveCache('match:' + id, { matchInfo: data }, 86400000, record.at, false);
        summaries.add(id);
      }
    }
    db.setState('recordedBatraceFailures', failures);
    db.setState('offlineBatraceFixture', {
      capturedAt: manifest.capturedAt,
      completedAt: manifest.completedAt,
      counts: manifest.counts,
      summaryMatchIds: [...summaries],
    });
    db.sql.exec('RELEASE offline_fixture_import');
  } catch (error) {
    db.sql.exec('ROLLBACK TO offline_fixture_import; RELEASE offline_fixture_import');
    throw error;
  }
  return manifest;
}
