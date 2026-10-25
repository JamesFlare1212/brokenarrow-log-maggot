import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Account,
  CacheClearMode,
  CacheStats,
  CacheUsage,
  ApmState,
  Ban,
  Encounter,
  Match,
  MiniInfo,
  NameRecord,
  PublicConfig,
  SearchPlayer,
} from '@ba/contracts';
import { configSchema, legacyThemeMode, PANELS } from '@ba/contracts';
import { object, text, number, mergeMatch, determineOutcome } from '@ba/shared';
import { projectConfig } from '../config';

function includeRadar(order: PublicConfig['panelOrder']): PublicConfig['panelOrder'] {
  if (order.includes('radar')) return order;
  const result = [...order],
    overview = result.indexOf('current');
  result.splice(overview < 0 ? result.length : overview + 1, 0, 'radar');
  return result;
}

export class Database {
  readonly sql: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  private depth = 0;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS app_state(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS apm_captures(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,fid TEXT,started_at INTEGER NOT NULL,payload TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS apm_capture_time ON apm_captures(started_at DESC);
      CREATE INDEX IF NOT EXISTS apm_capture_session ON apm_captures(session_id);
      CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT NOT NULL,first_seen INTEGER,last_seen INTEGER,observed INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS player_names(player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,name TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,PRIMARY KEY(player_id,name)) STRICT;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,persona TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,fid TEXT UNIQUE,end_time INTEGER,payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS deleted_log_matches(id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE IF NOT EXISTS match_players(match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,player_id TEXT NOT NULL REFERENCES players(id),team_id INTEGER,payload TEXT NOT NULL,PRIMARY KEY(match_id,player_id)) STRICT;
      CREATE TABLE IF NOT EXISTS match_views(match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,payload TEXT NOT NULL,PRIMARY KEY(match_id,account_id)) STRICT;
      CREATE TABLE IF NOT EXISTS bans(player_id TEXT PRIMARY KEY REFERENCES players(id),payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS player_snapshots(player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,at INTEGER NOT NULL,payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS api_cache(key TEXT PRIMARY KEY,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS map_names(id INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS legacy_encounters(id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),fid TEXT,at INTEGER,payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS legacy_imports(file TEXT PRIMARY KEY,at INTEGER NOT NULL,sha256 TEXT NOT NULL,raw_json TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS match_time ON matches(end_time DESC);
      CREATE INDEX IF NOT EXISTS match_session ON matches(json_extract(payload,'$.sessionId'));
      CREATE INDEX IF NOT EXISTS player_matches ON match_players(player_id,match_id);
      CREATE INDEX IF NOT EXISTS account_matches ON match_views(account_id,match_id);
      CREATE INDEX IF NOT EXISTS cache_expiry ON api_cache(expires_at);
      CREATE INDEX IF NOT EXISTS player_seen ON players(last_seen DESC);
      INSERT OR IGNORE INTO migrations VALUES(1,unixepoch()*1000);
      DROP TABLE IF EXISTS api_calls;
      DELETE FROM app_state WHERE key='apiAttemptTotal';`);
  }
  private prepare(query: string): StatementSync {
    let statement = this.statements.get(query);
    if (!statement) {
      statement = this.sql.prepare(query);
      this.statements.set(query, statement);
    }
    return statement;
  }
  close(): void {
    this.sql.close();
    this.statements.clear();
  }
  transaction<T>(run: () => T): T {
    if (this.depth) return run();
    this.sql.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = run();
      this.sql.exec('COMMIT');
      return result;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }
  state<T>(key: string, fallback: T): T {
    const row = this.prepare('SELECT value FROM app_state WHERE key=?').get(key);
    return row ? (JSON.parse(String(row.value)) as T) : fallback;
  }
  setState(key: string, value: unknown): void {
    this.prepare(
      'INSERT INTO app_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(key, JSON.stringify(value));
  }
  recoverApmCaptures(): void {
    this.sql.exec(`UPDATE apm_captures SET payload=json_set(payload,
      '$.status','complete','$.focused',json('false'),'$.partial',json('true'),
      '$.interrupted',json('true'),'$.currentApm',NULL,
      '$.endedAt',json_extract(payload,'$.startedAt')+json_extract(payload,'$.durationSec')*1000)
      WHERE json_extract(payload,'$.status')='active'`);
  }
  saveApm(value: ApmState): void {
    if (
      !value.captureId ||
      !value.sessionId ||
      value.startedAt === null ||
      !['active', 'complete', 'unavailable'].includes(value.status)
    )
      return;
    if (
      this.prepare('SELECT 1 FROM deleted_log_matches WHERE id IN (?,?)').get(
        'local:' + value.sessionId,
        value.fid,
      )
    )
      return;
    this.prepare(
      `INSERT INTO apm_captures VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET fid=excluded.fid,payload=excluded.payload`,
    ).run(
      value.captureId,
      value.sessionId,
      value.fid,
      Math.round(value.startedAt),
      JSON.stringify(value),
    );
  }
  apmHistory(): ApmState[] {
    return this.prepare('SELECT payload FROM apm_captures ORDER BY started_at DESC LIMIT 50')
      .all()
      .map((row) => JSON.parse(String(row.payload)) as ApmState);
  }
  updateApmMatch(match: Match): void {
    const rows = this.prepare('SELECT payload FROM apm_captures WHERE session_id=?').all(
      match.sessionId,
    );
    this.transaction(() => {
      for (const row of rows) {
        const value = JSON.parse(String(row.payload)) as ApmState;
        this.saveApm({
          ...value,
          fid: match.fid ?? value.fid,
          map: match.map || value.map,
          matchDurationSec: match.durationSec ?? value.matchDurationSec,
        });
      }
    });
  }
  config(): PublicConfig {
    const row = this.prepare('SELECT value FROM settings WHERE key=?').get('public');
    const stored = row ? JSON.parse(String(row.value)) : {};
    const config = configSchema.parse({
      themeMode: legacyThemeMode(stored.theme),
      ...stored,
      lang: stored.lang === 'ja' || stored.lang === 'ru' ? 'zh' : stored.lang,
    });
    config.panelOrder = includeRadar(config.panelOrder);
    return config;
  }
  updateConfig(patch: Partial<PublicConfig>): PublicConfig {
    const value = configSchema.parse({ ...this.config(), ...patch });
    value.panelOrder = [...new Set([...includeRadar(value.panelOrder), ...PANELS])];
    value.hiddenPanels = [...new Set(value.hiddenPanels)];
    value.collapsedPanels = [...new Set(value.collapsedPanels)];
    this.prepare(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run('public', JSON.stringify(value));
    return value;
  }
  ensurePlayer(id: string, name = id): void {
    this.prepare('INSERT OR IGNORE INTO players(id,name,observed) VALUES(?,?,0)').run(id, name);
  }
  observe(players: Array<{ id: string; name: string }>, at = Date.now()): void {
    this.transaction(() => {
      for (const p of players) {
        if (!/^\d+$/.test(p.id)) continue;
        this.prepare(
          'INSERT INTO players VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN excluded.last_seen>=COALESCE(players.last_seen,0) THEN excluded.name ELSE players.name END,first_seen=MIN(COALESCE(players.first_seen,excluded.first_seen),excluded.first_seen),last_seen=MAX(COALESCE(players.last_seen,0),excluded.last_seen),observed=1',
        ).run(p.id, p.name, at, at);
        this.prepare(
          'INSERT INTO player_names VALUES(?,?,?,?) ON CONFLICT(player_id,name) DO UPDATE SET first_seen=MIN(player_names.first_seen,excluded.first_seen),last_seen=MAX(player_names.last_seen,excluded.last_seen)',
        ).run(p.id, p.name, at, at);
      }
    });
  }
  observeAccount(id: string, name: string, persona = name, at = Date.now()): void {
    this.prepare(
      'INSERT INTO accounts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN excluded.last_seen>=accounts.last_seen THEN excluded.name ELSE accounts.name END,persona=CASE WHEN excluded.last_seen>=accounts.last_seen THEN excluded.persona ELSE accounts.persona END,first_seen=MIN(accounts.first_seen,excluded.first_seen),last_seen=MAX(accounts.last_seen,excluded.last_seen)',
    ).run(id, name, persona, at, at);
  }
  accounts(): Account[] {
    return this.prepare(
      'SELECT a.*,COUNT(v.match_id) match_count FROM accounts a LEFT JOIN match_views v ON a.id=v.account_id GROUP BY a.id ORDER BY a.last_seen DESC',
    )
      .all()
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        persona: String(r.persona),
        firstSeen: Number(r.first_seen),
        lastSeen: Number(r.last_seen),
        matchCount: Number(r.match_count),
      }));
  }
  saveMatch(match: Match, observe = true): void {
    if (
      match.source === 'log' &&
      this.prepare('SELECT 1 FROM deleted_log_matches WHERE id IN (?,?)').get(
        match.id,
        'local:' + match.sessionId,
      )
    )
      return;
    this.transaction(() => {
      const incoming = match;
      const temporary = this.prepare(
        "SELECT id,payload FROM matches WHERE json_extract(payload,'$.sessionId')=?",
      ).get(match.sessionId);
      const previous =
        this.match(match.id) ||
        (temporary ? (JSON.parse(String(temporary.payload)) as Match) : null);
      if (previous) match = mergeMatch(previous, match);
      if (temporary && String(temporary.id) !== match.id)
        this.prepare('DELETE FROM matches WHERE id=?').run(String(temporary.id));
      if (observe) this.observe(match.players, match.endedAt ?? match.updatedAt);
      for (const p of match.players) this.ensurePlayer(p.id, p.name);
      this.prepare(
        'INSERT INTO matches VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET fid=excluded.fid,end_time=excluded.end_time,payload=excluded.payload',
      ).run(match.id, match.fid, match.endedAt, JSON.stringify(match));
      for (const p of match.players)
        this.prepare(
          'INSERT INTO match_players VALUES(?,?,?,?) ON CONFLICT(match_id,player_id) DO UPDATE SET team_id=excluded.team_id,payload=excluded.payload',
        ).run(match.id, p.id, p.teamId, JSON.stringify(p));
      const localId = incoming.localPlayerId;
      if (localId) {
        const me = match.players.find((p) => p.id === localId);
        this.observeAccount(
          localId,
          me?.name || incoming.localPersona || localId,
          incoming.localPersona || me?.name || localId,
          match.endedAt ?? match.updatedAt,
        );
        const result = determineOutcome(match.players, localId, match.mode, match.winnerTeamId);
        this.prepare(
          'INSERT INTO match_views VALUES(?,?,?) ON CONFLICT(match_id,account_id) DO UPDATE SET payload=excluded.payload',
        ).run(
          match.id,
          localId,
          JSON.stringify({
            localPlayerId: localId,
            localPersona: incoming.localPersona,
            outcome: result.outcome === 'unknown' ? incoming.outcome : result.outcome,
            eloBefore: result.before ?? incoming.eloBefore,
            eloAfter: result.after ?? incoming.eloAfter,
          }),
        );
      }
    });
  }
  match(id: string, accountId?: string | null): Match | null {
    const row = this.prepare('SELECT payload FROM matches WHERE id=? OR fid=?').get(id, id);
    if (!row) return null;
    const match = JSON.parse(String(row.payload)) as Match;
    if (accountId) {
      const view = this.prepare(
        'SELECT payload FROM match_views WHERE match_id=? AND account_id=?',
      ).get(match.id, accountId);
      if (view) Object.assign(match, JSON.parse(String(view.payload)));
    }
    return match;
  }
  matches(accountId?: string): Match[] {
    const rows = accountId
      ? this.prepare(
          "SELECT m.payload,v.payload AS view FROM matches m JOIN match_views v ON m.id=v.match_id WHERE v.account_id=? ORDER BY COALESCE(m.end_time,json_extract(m.payload,'$.startedAt'),0) DESC,m.id DESC",
        ).all(accountId)
      : this.prepare(
          "SELECT payload FROM matches ORDER BY COALESCE(end_time,json_extract(payload,'$.startedAt'),0) DESC,id DESC",
        ).all();
    return rows.map((row) => {
      const match = JSON.parse(String(row.payload)) as Match;
      if (row.view) Object.assign(match, JSON.parse(String(row.view)));
      return match;
    });
  }
  deleteMatch(id: string): boolean {
    return this.transaction(() => {
      const match = this.match(id);
      if (!match) return false;
      const remember = this.prepare('INSERT OR IGNORE INTO deleted_log_matches VALUES(?)');
      remember.run(match.id);
      remember.run('local:' + match.sessionId);
      this.prepare('DELETE FROM apm_captures WHERE session_id=? OR fid=?').run(
        match.sessionId,
        match.fid,
      );
      return this.prepare('DELETE FROM matches WHERE id=?').run(match.id).changes > 0;
    });
  }
  deleteAccount(id: string): { removedMatches: number } {
    return this.transaction(() => {
      const owned = this.prepare('SELECT match_id FROM match_views WHERE account_id=?')
        .all(id)
        .map((r) => String(r.match_id));
      this.prepare('DELETE FROM accounts WHERE id=?').run(id);
      const remainingAccounts = this.accounts();
      let removedMatches = 0;
      for (const matchId of owned) {
        const match = this.match(matchId);
        if (!match) continue;
        const others = remainingAccounts.filter((a) => match.players.some((p) => p.id === a.id));
        for (const a of others) {
          const result = determineOutcome(match.players, a.id, match.mode, match.winnerTeamId);
          this.prepare('INSERT OR IGNORE INTO match_views VALUES(?,?,?)').run(
            matchId,
            a.id,
            JSON.stringify({
              localPlayerId: a.id,
              localPersona: a.persona,
              outcome: result.outcome,
              eloBefore: result.before,
              eloAfter: result.after,
            }),
          );
        }
        const remaining = this.prepare(
          'SELECT payload FROM match_views WHERE match_id=? LIMIT 1',
        ).get(matchId);
        if (!remaining) {
          this.deleteMatch(matchId);
          removedMatches++;
        } else if (match.localPlayerId === id) {
          Object.assign(match, JSON.parse(String(remaining.payload)));
          this.prepare('UPDATE matches SET payload=? WHERE id=?').run(
            JSON.stringify(match),
            matchId,
          );
        }
      }
      if (this.state<string | null>('activeAccountId', null) === id)
        this.setState('activeAccountId', remainingAccounts[0]?.id ?? null);
      return { removedMatches };
    });
  }
  localSearch(query: string, includeRecorded = false): SearchPlayer[] {
    const q = query.toLocaleLowerCase();
    const rows = this.prepare(
      'SELECT p.id,p.name,p.last_seen,GROUP_CONCAT(n.name,char(31)) aliases FROM players p LEFT JOIN player_names n ON n.player_id=p.id WHERE p.observed=1 OR ? GROUP BY p.id ORDER BY p.last_seen DESC',
    ).all(includeRecorded ? 1 : 0);
    return rows
      .filter(
        (r) =>
          String(r.id).startsWith(query) ||
          String(r.name).toLocaleLowerCase().includes(q) ||
          String(r.aliases || '')
            .split(String.fromCharCode(31))
            .some((name) => name.toLocaleLowerCase().includes(q)),
      )
      .slice(0, 20)
      .map((r) => {
        const info = includeRecorded
          ? object(object(this.cache('info:' + r.id, true)?.value).info)
          : {};
        return {
          id: String(r.id),
          name: String(r.name),
          level: number(info.level),
          rating: number(info.rating),
        };
      });
  }
  player(
    id: string,
    includeRecorded = false,
  ): {
    name: string;
    firstSeen: number | null;
    lastSeen: number | null;
    names: NameRecord[];
  } | null {
    const r = this.prepare('SELECT * FROM players WHERE id=? AND (observed=1 OR ?)').get(
      id,
      includeRecorded ? 1 : 0,
    );
    if (!r) return null;
    const names = this.prepare(
      'SELECT * FROM player_names WHERE player_id=? ORDER BY last_seen DESC',
    )
      .all(id)
      .map((n) => ({
        name: String(n.name),
        firstSeen: Number(n.first_seen),
        lastSeen: Number(n.last_seen),
      }));
    return {
      name: String(r.name),
      firstSeen: number(r.first_seen),
      lastSeen: number(r.last_seen),
      names,
    };
  }
  snapshot(id: string): MiniInfo | null {
    const r = this.prepare('SELECT payload FROM player_snapshots WHERE player_id=?').get(id);
    if (!r) return null;
    const value = JSON.parse(String(r.payload)) as MiniInfo;
    return {
      ...value,
      stale: value.stale || Date.now() - value.updatedAt > projectConfig.cache.ttlMs.player,
    };
  }
  saveSnapshot(id: string, value: MiniInfo, trim = true): void {
    if (value.stale) return;
    this.ensurePlayer(id, value.name || id);
    this.prepare(
      'INSERT INTO player_snapshots VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET at=excluded.at,payload=excluded.payload',
    ).run(id, value.updatedAt, JSON.stringify(value));
    if (trim)
      this.prepare(
        'DELETE FROM player_snapshots WHERE player_id IN (SELECT player_id FROM player_snapshots ORDER BY at DESC LIMIT -1 OFFSET ?)',
      ).run(projectConfig.cache.maxPlayerSnapshots);
  }
  bans(metOnly = false): Ban[] {
    return this.prepare(
      "SELECT b.payload,p.observed,p.last_seen,e.encounter_at FROM bans b JOIN players p ON b.player_id=p.id LEFT JOIN (SELECT player_id,MAX(at) encounter_at FROM legacy_encounters GROUP BY player_id) e ON e.player_id=b.player_id ORDER BY json_extract(b.payload,'$.firstSeenAt') DESC",
    )
      .all()
      .map((r) => {
        const b = JSON.parse(String(r.payload)) as Ban;
        const lastEncounterAt =
          Math.max(
            Number(r.observed) === 1 ? (number(r.last_seen) ?? 0) : 0,
            number(r.encounter_at) ?? 0,
          ) || null;
        return {
          ...b,
          encountered: b.encountered || Number(r.observed) === 1 || lastEncounterAt !== null,
          lastEncounterAt,
        };
      })
      .filter((b) => !metOnly || b.encountered);
  }
  saveBans(list: Ban[]): Ban[] {
    return this.transaction(() => {
      const newly: Ban[] = [];
      for (const b of list) {
        this.ensurePlayer(b.id, b.name);
        const old = this.prepare('SELECT payload FROM bans WHERE player_id=?').get(b.id);
        const value = old
          ? { ...b, firstSeenAt: (JSON.parse(String(old.payload)) as Ban).firstSeenAt }
          : b;
        if (!old && this.player(b.id)) newly.push({ ...value, encountered: true });
        this.prepare(
          'INSERT INTO bans VALUES(?,?) ON CONFLICT(player_id) DO UPDATE SET payload=excluded.payload',
        ).run(b.id, JSON.stringify(value));
      }
      return newly;
    });
  }
  encounters(id: string): Encounter[] {
    const locals = new Set(
      this.config().multiAccountBond
        ? this.accounts().map((a) => a.id)
        : [this.state<string | null>('activeAccountId', null)].filter((a): a is string => !!a),
    );
    const rows = this.prepare(
        'SELECT m.payload FROM matches m JOIN match_players p ON m.id=p.match_id WHERE p.player_id=? ORDER BY m.end_time DESC',
      ).all(id),
      out: Encounter[] = [];
    const views = new Map<string, Map<string, string>>();
    for (const row of this.prepare(
      'SELECT v.match_id,v.account_id,v.payload FROM match_views v JOIN match_players p ON v.match_id=p.match_id WHERE p.player_id=?',
    ).all(id)) {
      const matchId = String(row.match_id);
      let byAccount = views.get(matchId);
      if (!byAccount) {
        byAccount = new Map();
        views.set(matchId, byAccount);
      }
      byAccount.set(String(row.account_id), String(row.payload));
    }
    for (const row of rows) {
      const m = JSON.parse(String(row.payload)) as Match;
      const owner = m.localPlayerId,
        target = m.players.find((p) => p.id === id);
      const mine =
        owner && locals.has(owner)
          ? m.players.find((p) => p.id === owner)
          : m.players.find((p) => locals.has(p.id));
      if (!target || !mine || mine.id === target.id) continue;
      const view = views.get(m.id)?.get(mine.id);
      if (view) Object.assign(m, JSON.parse(view));
      const result = determineOutcome(m.players, mine.id, m.mode, m.winnerTeamId),
        outcome = result.outcome === 'unknown' ? m.outcome : result.outcome;
      const spectator = mine.teamId === 100 || target.teamId === 100;
      out.push({
        matchId: m.id,
        at: m.endedAt,
        map: m.map,
        relation: spectator
          ? 'spectator'
          : mine.teamId === null || target.teamId === null
            ? 'unknown'
            : mine.teamId === target.teamId
              ? 'same'
              : 'opponent',
        won: outcome === 'win' ? true : outcome === 'loss' ? false : null,
        custom: m.mode === 'custom',
      });
    }
    const seen = new Set(out.map((encounter) => encounter.matchId));
    const legacy = this.prepare('SELECT payload FROM legacy_encounters WHERE player_id=?').all(id);
    for (const row of legacy) {
      const p = object(JSON.parse(String(row.payload))),
        fid = text(p.fid);
      if (seen.has(fid)) continue;
      const matchId = fid || text(p.id);
      seen.add(matchId);
      out.push({
        matchId,
        at: number(p.at),
        map: text(p.map),
        relation:
          p.spectator === true
            ? 'spectator'
            : p.myTeam != null && p.theirTeam != null
              ? p.myTeam === p.theirTeam
                ? 'same'
                : 'opponent'
              : 'unknown',
        won: typeof p.won === 'boolean' ? p.won : null,
        custom: p.custom === true,
      });
    }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  cacheStats(now = Date.now()): CacheStats {
    const usage = (row: Record<string, unknown>): CacheUsage => ({
      entries: Number(row.entries),
      expired: Number(row.expired),
      bytes: Number(row.bytes),
    });
    return {
      api: usage(
        this.prepare(
          'SELECT COUNT(*) AS entries,COALESCE(SUM(expires_at<=?),0) AS expired,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM api_cache',
        ).get(now)!,
      ),
      snapshots: usage(
        this.prepare(
          "SELECT COUNT(*) AS entries,COALESCE(SUM(at<? OR json_extract(payload,'$.stale')=1),0) AS expired,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM player_snapshots",
        ).get(now - projectConfig.cache.ttlMs.player)!,
      ),
    };
  }
  clearCache(mode: CacheClearMode, now = Date.now()): { removed: number; stats: CacheStats } {
    return this.transaction(() => {
      const api =
        mode === 'all'
          ? this.prepare('DELETE FROM api_cache').run()
          : this.prepare('DELETE FROM api_cache WHERE expires_at<=?').run(now);
      const snapshots =
        mode === 'all'
          ? this.prepare('DELETE FROM player_snapshots').run()
          : this.prepare(
              "DELETE FROM player_snapshots WHERE at<? OR json_extract(payload,'$.stale')=1",
            ).run(now - projectConfig.cache.ttlMs.player);
      return {
        removed: Number(api.changes) + Number(snapshots.changes),
        stats: this.cacheStats(now),
      };
    });
  }
  cache(
    key: string,
    allowStale = false,
    now = Date.now(),
  ): { value: unknown; at: number; stale: boolean } | null {
    const r = this.prepare('SELECT * FROM api_cache WHERE key=?').get(key);
    if (!r) return null;
    const stale = Number(r.expires_at) <= now;
    return stale && !allowStale
      ? null
      : { value: JSON.parse(String(r.payload)), at: Number(r.at), stale };
  }
  saveCache(key: string, value: unknown, ttl: number, at = Date.now(), trim = true): void {
    this.prepare(
      'INSERT INTO api_cache VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET at=excluded.at,expires_at=excluded.expires_at,payload=excluded.payload',
    ).run(key, at, at + ttl, JSON.stringify(value));
    if (trim)
      this.prepare(
        'DELETE FROM api_cache WHERE key IN (SELECT key FROM api_cache ORDER BY at DESC LIMIT -1 OFFSET ?)',
      ).run(projectConfig.cache.maxApiEntries);
  }
}
