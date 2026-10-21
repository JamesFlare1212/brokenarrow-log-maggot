import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { configSchema, legacyThemeMode, PANELS } from '@ba/contracts';
import type { Ban, MigrationStatus, MiniInfo, PublicConfig } from '@ba/contracts';
import {
  array,
  object,
  number,
  text,
  normalizeMatch,
  normalizeQuality,
  normalizeFps,
  normalizeBitrate,
  emptyMatch,
  emptyPlayer,
  mergeMatch,
  team,
} from '@ba/shared';
import { Database } from './database';
import { projectConfig } from '../config';

const FILES = [
  'settings.json',
  'players-db.json',
  'match-archive.json',
  'batrace-cache.json',
  'deck-sync.json',
  'api-health.json',
] as const;
type SourceFile = (typeof FILES)[number];
interface Source {
  file: SourceFile;
  bytes: Buffer;
  value: unknown;
}
interface LegacyName {
  name: string;
  firstSeen: number | null;
  lastSeen: number | null;
  order: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function time(value: unknown): number | null {
  const n = number(value);
  return (typeof value === 'number' || typeof value === 'string') &&
    n !== null &&
    Number.isSafeInteger(n)
    ? n
    : null;
}
function hash(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function cacheTtl(key: string): number {
  const ttl = projectConfig.cache.ttlMs;
  if (key.startsWith('search:')) return ttl.search;
  if (key.startsWith('myMatches:')) return ttl.playerMatches;
  if (key.startsWith('ban:')) return ttl.bans;
  if (key.startsWith('match:') || key.startsWith('amatch:')) return ttl.match;
  return key === 'units' ? ttl.units : ttl.player;
}
function matchShape(value: unknown): boolean {
  return (
    record(value) &&
    (value.players === undefined || (Array.isArray(value.players) && value.players.every(record)))
  );
}
function validateSource(file: SourceFile, value: unknown): void {
  const fail = (reason: string): never => {
    throw new Error(reason);
  };
  if (file === 'match-archive.json') {
    const entries = Array.isArray(value)
      ? value
      : record(value) && Array.isArray(value.matches)
        ? value.matches
        : null;
    if (!entries || !entries.every(matchShape))
      fail('expected an array of match records, or an object containing that array');
    return;
  }
  if (!record(value)) fail('expected an object');
  const raw = object(value);
  if (file === 'players-db.json') {
    if (!('players' in raw) && !('matches' in raw))
      fail('expected a v1 players collection or a v2 matches collection');
    if (raw.version !== undefined && number(raw.version) !== 1 && number(raw.version) !== 2)
      fail('unsupported tracker version');
    for (const field of ['players', 'matches', 'knownBans', 'playerSnapshots', 'localAccounts']) {
      const collection = raw[field];
      if (
        collection !== undefined &&
        (!record(collection) || !Object.values(collection).every(record))
      )
        fail(`invalid ${field} collection`);
    }
    for (const p of Object.values(object(raw.players)).map(object)) {
      if (
        p.names !== undefined &&
        (!Array.isArray(p.names) ||
          !p.names.every((n) => typeof n === 'string' || (record(n) && typeof n.name === 'string')))
      )
        fail('invalid player name history');
      if (
        p.encounters !== undefined &&
        (!Array.isArray(p.encounters) || !p.encounters.every(record))
      )
        fail('invalid legacy encounters');
    }
    if (!Object.values(object(raw.matches)).every(matchShape)) fail('invalid match roster');
  }
  if (file === 'batrace-cache.json') {
    if (!Object.values(raw).every((c) => record(c) && 'value' in c && time(c.t) !== null))
      fail('expected cache entries with an integer t and a value');
  }
  if (file === 'deck-sync.json') {
    if (
      raw.alertedPairs !== undefined &&
      (!Array.isArray(raw.alertedPairs) || !raw.alertedPairs.every((p) => typeof p === 'string'))
    )
      fail('invalid alertedPairs');
    for (const key of ['pkgKey', 'pkgName'])
      if (raw[key] !== undefined && typeof raw[key] !== 'string') fail(`invalid ${key}`);
    if (raw.pkgUpdatedAt !== undefined && time(raw.pkgUpdatedAt) === null)
      fail('invalid pkgUpdatedAt');
  }
  if (file === 'api-health.json') {
    if (
      !['unknown', 'ok', 'partial', 'down'].includes(text(raw.state)) ||
      !Array.isArray(raw.checks) ||
      !raw.checks.every(record)
    )
      fail('expected a health state and checks array');
  }
}

async function backupSource(dir: string, source: Source): Promise<void> {
  // Never re-read the source: the backup must represent the bytes being imported.
  for (const name of [source.file, `${source.file}.${hash(source.bytes)}`]) {
    const destination = join(dir, name);
    try {
      await writeFile(destination, source.bytes, { flag: 'wx', mode: 0o600 });
      return;
    } catch (error) {
      if (object(error).code !== 'EEXIST') throw error;
      if ((await readFile(destination)).equals(source.bytes)) return;
    }
  }
  throw new Error(`${source.file}: existing backup differs from the source snapshot`);
}

function importSettings(db: Database, raw: Record<string, unknown>, warnings: string[]): number {
  const aliases: Record<string, string> = {
    maggot: 'players',
    deck: 'decks',
    ban: 'bans',
    archive: 'archive',
    current: 'current',
    about: 'about',
  };
  const candidate = {
    ...raw,
    lang: raw.lang === 'ja' || raw.lang === 'ru' ? 'zh' : raw.lang,
    themeMode: raw.themeMode ?? legacyThemeMode(raw.theme),
    replayQuality: normalizeQuality(raw.replayQuality),
    replayFps: normalizeFps(raw.replayFps),
    replayBitrateMbps: normalizeBitrate(raw.replayBitrateMbps),
    panelOrder: array(raw.panelOrder)
      .map((p) => aliases[text(p)] || text(p))
      .filter((p) => PANELS.some((k) => k === p)),
  };
  const values: Partial<PublicConfig> = {};
  for (const key of Object.keys(configSchema.shape) as Array<keyof PublicConfig>) {
    const parsed = configSchema.shape[key].safeParse(object(candidate)[key]);
    if (parsed.success) Object.assign(values, { [key]: parsed.data });
    else warnings.push(`settings.json: invalid ${key}, default retained`);
  }
  db.updateConfig(values);
  db.setState('privateHeaders', object(raw.batraceExtraHeaders));
  return Object.keys(values).length;
}

function legacyNames(p: Record<string, unknown>): LegacyName[] {
  return array(p.names)
    .map((entry, order) => {
      const n = object(entry);
      return {
        name: (typeof entry === 'string' ? entry : text(n.name)).trim(),
        firstSeen: time(n.firstSeen),
        lastSeen: time(n.lastSeen) ?? time(n.firstSeen),
        order,
      };
    })
    .filter((n) => n.name.length > 0);
}
function importPlayer(db: Database, id: string, p: Record<string, unknown>): string {
  const names = legacyNames(p);
  const dated = names
    .filter((n) => n.lastSeen !== null)
    .sort((a, b) => (a.lastSeen ?? 0) - (b.lastSeen ?? 0) || a.order - b.order);
  const latest = dated.at(-1) ?? names.at(-1);
  const name = latest?.name ?? text(p.name, id);
  const first =
    time(p.firstSeen) ??
    (dated.length ? Math.min(...dated.map((n) => n.firstSeen ?? n.lastSeen ?? 0)) : null);
  const last = time(p.lastSeen) ?? latest?.lastSeen ?? null;
  db.sql
    .prepare(
      `INSERT INTO players VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET
    name=CASE WHEN players.observed=0 OR COALESCE(excluded.last_seen,0)>=COALESCE(players.last_seen,0) THEN excluded.name ELSE players.name END,
    first_seen=CASE WHEN players.first_seen IS NULL THEN excluded.first_seen WHEN excluded.first_seen IS NULL THEN players.first_seen ELSE MIN(players.first_seen,excluded.first_seen) END,
    last_seen=CASE WHEN players.last_seen IS NULL THEN excluded.last_seen WHEN excluded.last_seen IS NULL THEN players.last_seen ELSE MAX(players.last_seen,excluded.last_seen) END,
    observed=1`,
    )
    .run(id, name, first, last);
  const aliases = names.length ? names : [{ name, firstSeen: first, lastSeen: last, order: 0 }];
  for (const alias of aliases) {
    const firstSeen = alias.firstSeen ?? (alias === latest ? first : null) ?? 0;
    const lastSeen = alias.lastSeen ?? (alias === latest ? last : null) ?? firstSeen;
    db.sql
      .prepare(
        `INSERT INTO player_names VALUES(?,?,?,?) ON CONFLICT(player_id,name) DO UPDATE SET
      first_seen=CASE WHEN player_names.first_seen=0 THEN excluded.first_seen WHEN excluded.first_seen=0 THEN player_names.first_seen ELSE MIN(player_names.first_seen,excluded.first_seen) END,
      last_seen=MAX(player_names.last_seen,excluded.last_seen)`,
      )
      .run(id, alias.name, firstSeen, lastSeen);
  }
  return name;
}

function legacyMatch(value: unknown, localId: string | null): Record<string, unknown> {
  const raw = object(value);
  if (!localId) return raw;
  const after = number(raw.localEloAfter),
    delta = number(raw.localEloDelta),
    scores = object(raw.localScores);
  const players = array(raw.players).map((entry) => {
    const p = object(entry);
    if (text(p.id) !== localId) return p;
    return {
      ...p,
      teamId:
        p.teamId ??
        team(raw.localSpectator === true ? 100 : (raw.localTeamId ?? raw.localTeam ?? p.team)),
      newRating: p.newRating ?? after,
      oldRating: p.oldRating ?? (after !== null && delta !== null ? after - delta : null),
      destructionScore: p.destructionScore ?? number(scores.destruction),
      lossesScore: p.lossesScore ?? number(scores.losses),
      objectivesCaptured: p.objectivesCaptured ?? number(scores.objectives),
    };
  });
  return { ...raw, localPlayerId: localId, players };
}

function importTracker(db: Database, raw: Record<string, unknown>): number {
  let count = 0;
  for (const [id, value] of Object.entries(object(raw.players))) {
    const p = object(value),
      name = importPlayer(db, id, p);
    count++;
    for (const [index, encounter] of array(p.encounters).entries()) {
      const e = object(encounter),
        key = hash(`${id}:${index}:${JSON.stringify(e)}`),
        fid = text(e.fid);
      db.sql
        .prepare('INSERT OR IGNORE INTO legacy_encounters VALUES(?,?,?,?,?)')
        .run(key, id, fid || null, time(e.at), JSON.stringify(e));
      count++;
      if (!/^\d+$/.test(fid)) continue;
      const m = db.match(fid) ?? emptyMatch(fid);
      m.map ||= text(e.map);
      m.endedAt ??= time(e.at);
      m.source = 'legacy';
      if (!m.players.some((player) => player.id === id))
        m.players.push({
          ...emptyPlayer(id, name),
          teamId: e.spectator === true ? 100 : team(e.theirTeam),
        });
      // A v1 encounter does not establish which local account owned the match.
      db.saveMatch(m, false);
    }
  }
  for (const [id, value] of Object.entries(object(raw.localAccounts))) {
    const a = object(value);
    db.observeAccount(id, text(a.name, id), text(a.persona ?? a.name, id), time(a.firstSeen) ?? 0);
    db.sql.prepare('UPDATE accounts SET last_seen=? WHERE id=?').run(time(a.lastSeen) ?? 0, id);
    count++;
  }
  const active = text(raw.localId) || null;
  db.setState('activeAccountId', active);
  if (active && !db.accounts().some((a) => a.id === active)) {
    const name = db.player(active)?.name || active;
    db.observeAccount(active, name, name, 0);
  }
  const accounts = new Set(db.accounts().map((a) => a.id));
  for (const [id, value] of Object.entries(object(raw.matches))) {
    const p = object(value);
    let owner = text(p.localPlayerId) || null;
    if (!owner && number(raw.version) !== 1) {
      const candidates = new Set(
        array(p.players)
          .map((player) => text(object(player).id))
          .filter((player) => accounts.has(player)),
      );
      if (candidates.size === 1) owner = [...candidates][0] ?? null;
    }
    db.saveMatch(
      normalizeMatch(legacyMatch(value, owner), {
        id,
        legacy: true,
        now: time(p.syncedAt) ?? time(p.firstSeenAt) ?? 0,
      }),
      false,
    );
    count++;
  }
  const bans: Ban[] = Object.entries(object(raw.knownBans)).map(([id, value]) => {
    const b = object(value);
    return {
      id,
      name: text(b.name, id),
      steamId: text(b.steamId),
      rating: number(b.rating),
      firstSeenAt: time(b.firstSeenAt) ?? 0,
      lastSeenAt: time(b.lastSeenAt) ?? 0,
      encountered: b.encountered === true,
    };
  });
  db.saveBans(bans);
  count += bans.length;
  for (const [id, value] of Object.entries(object(raw.playerSnapshots))) {
    const s = object(value);
    const snapshot: MiniInfo = {
      name: text(s.name) || undefined,
      elo: number(s.elo),
      kd: number(s.kd),
      winRate: number(s.winRate),
      matchCount: number(s.matchCount) ?? 0,
      category: text(s.category) || null,
      topUnits: text(s.topUnits),
      updatedAt: time(s.at) ?? 0,
      stale: false,
    };
    db.saveSnapshot(id, snapshot, false);
    count++;
  }
  db.setState('lastBanSync', time(raw.lastBanSync) ?? 0);
  db.setState('lastMatchSync', time(raw.lastMatchSync) ?? 0);
  return count;
}

export async function migrateLegacy(db: Database, dir: string): Promise<MigrationStatus> {
  const previous = db.state<MigrationStatus>('migration', {
    completed: false,
    imported: {},
    warnings: [],
    backupDir: null,
  });
  if (previous.completed) return previous;
  const importedFiles = new Set(
    db.sql
      .prepare('SELECT file FROM legacy_imports')
      .all()
      .map((row) => String(row.file)),
  );
  const warnings = previous.warnings.filter((warning) =>
    importedFiles.has(warning.split(':')[0] ?? ''),
  );
  const pending: Source[] = [],
    snapshots: Source[] = [];
  let blocked = false;
  for (const file of FILES) {
    if (importedFiles.has(file)) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(join(dir, file));
    } catch (error) {
      if (object(error).code !== 'ENOENT') {
        warnings.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        blocked = true;
      }
      continue;
    }
    const source: Source = { file, bytes, value: undefined };
    snapshots.push(source);
    try {
      const raw = bytes.toString('utf8').replace(/^\uFEFF/, '');
      source.value = JSON.parse(raw) as unknown;
      validateSource(file, source.value);
      pending.push(source);
    } catch (error) {
      warnings.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      blocked = true;
    }
  }
  const backupDir = snapshots.length
    ? previous.backupDir || join(dir, 'migration-backups', `${Date.now()}-${randomUUID()}`)
    : previous.backupDir;
  if (backupDir && snapshots.length) {
    await mkdir(backupDir, { recursive: true });
    for (const source of snapshots) await backupSource(backupDir, source);
  }
  const imported = { ...previous.imported };
  db.transaction(() => {
    for (const source of pending) {
      const raw = object(source.value);
      let count = 0;
      switch (source.file) {
        case 'settings.json':
          count = importSettings(db, raw, warnings);
          break;
        case 'players-db.json':
          count = importTracker(db, raw);
          break;
        case 'match-archive.json': {
          const records = Array.isArray(source.value) ? source.value : array(raw.matches);
          for (const [index, value] of records.entries()) {
            const m = object(value),
              fid = text(m.fid),
              id = /^\d+$/.test(fid)
                ? fid
                : `legacy:${hash(`${JSON.stringify(m)}:${index}`).slice(0, 24)}`;
            const previousMatch = db.match(id);
            const incoming = normalizeMatch(legacyMatch(value, text(m.localPlayerId) || null), {
              id,
              legacy: true,
              now: time(m.archivedAt) ?? 0,
            });
            db.saveMatch(
              previousMatch ? mergeMatch(previousMatch, incoming, true) : incoming,
              false,
            );
            count++;
          }
          break;
        }
        case 'batrace-cache.json':
          for (const [key, value] of Object.entries(raw)) {
            const c = object(value);
            db.saveCache(key, c.value, cacheTtl(key), time(c.t) ?? 0, false);
            count++;
          }
          break;
        case 'deck-sync.json':
          db.setState('deckSync', raw);
          count = 1;
          break;
        case 'api-health.json':
          db.setState('health', raw);
          count = 1;
          break;
      }
      db.sql
        .prepare('INSERT INTO legacy_imports VALUES(?,?,?,?)')
        .run(source.file, Date.now(), hash(source.bytes), source.bytes.toString('utf8'));
      // Count logical source records; derived placeholders and v1 match groups are not counted twice.
      imported[source.file] = count;
    }
    db.setState('migration', { completed: !blocked, imported, warnings, backupDir });
  });
  return db.state<MigrationStatus>('migration', {
    completed: false,
    imported,
    warnings,
    backupDir,
  });
}
