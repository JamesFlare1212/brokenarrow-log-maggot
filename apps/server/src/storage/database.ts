import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Account,
  CacheClearMode,
  CacheStats,
  CacheUsage,
  Ban,
  BanAlertBatch,
  Encounter,
  Match,
  MiniInfo,
  NameRecord,
  PublicConfig,
  SearchPlayer,
} from '@ba/contracts';
import { configSchema, legacyThemeMode, PANELS } from '@ba/contracts';
import {
  object,
  text,
  number,
  mergeMatch,
  determineOutcome,
  normalizeQuality,
  normalizeFps,
  normalizeBitrate,
} from '@ba/shared';
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
      CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT NOT NULL,first_seen INTEGER,last_seen INTEGER,observed INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS game_observations(player_id TEXT PRIMARY KEY REFERENCES players(id),first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS search_players(player_id TEXT PRIMARY KEY,name TEXT NOT NULL,first_searched_at INTEGER NOT NULL,last_searched_at INTEGER NOT NULL,payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS search_names(player_id TEXT NOT NULL REFERENCES search_players(player_id) ON DELETE CASCADE,name TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(player_id,name)) STRICT;
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
      DROP TABLE IF EXISTS apm_captures;
      UPDATE settings SET value=json_remove(value,'$.inputHookEnabled')
        WHERE key='public' AND json_valid(value) AND json_type(value,'$.inputHookEnabled') IS NOT NULL;
      DELETE FROM app_state WHERE key='apiAttemptTotal';`);
    if (!this.state('encounterEvidence:v1', false)) {
      this.transaction(() => {
        this.rebuildGameObservations();
        const old = this.state<BanAlertBatch[]>('banAlerts', []);
        if (old.length) {
          this.setState('banAlertsBeforeEncounterEvidence', old);
          this.setState(
            'banAlerts',
            old
              .map((batch) => ({
                ...batch,
                players: batch.players.filter((player) => this.hasGameObservation(player.id)),
              }))
              .filter((batch) => batch.players.length),
          );
        }
        this.setState('encounterEvidence:v1', true);
      });
    }
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
  config(): PublicConfig {
    const row = this.prepare('SELECT value FROM settings WHERE key=?').get('public');
    const stored = row ? JSON.parse(String(row.value)) : {};
    const config = configSchema.parse({
      themeMode: legacyThemeMode(stored.theme),
      ...stored,
      lang: stored.lang === 'ja' || stored.lang === 'ru' ? 'zh' : stored.lang,
      replayQuality: normalizeQuality(stored.replayQuality),
      replayFps: normalizeFps(stored.replayFps),
      replayBitrateMbps: normalizeBitrate(stored.replayBitrateMbps),
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
  hasGameObservation(id: string): boolean {
    return !!this.prepare('SELECT 1 FROM game_observations WHERE player_id=?').get(id);
  }
  rebuildGameObservations(): void {
    this.transaction(() => {
      const merge =
        ' ON CONFLICT(player_id) DO UPDATE SET first_seen=MIN(game_observations.first_seen,excluded.first_seen),last_seen=MAX(game_observations.last_seen,excluded.last_seen)';
      this.sql.exec(`INSERT INTO game_observations
        SELECT p.player_id,MIN(COALESCE(m.end_time,json_extract(m.payload,'$.startedAt'),0)),MAX(COALESCE(m.end_time,json_extract(m.payload,'$.startedAt'),0))
        FROM match_players p JOIN matches m ON m.id=p.match_id
        WHERE json_extract(m.payload,'$.source') IN ('log','legacy') OR EXISTS(
          SELECT 1 FROM accounts a JOIN match_players owner ON owner.player_id=a.id AND owner.match_id=m.id
          WHERE a.id=json_extract(m.payload,'$.localPlayerId')) GROUP BY p.player_id ${merge};
        INSERT INTO game_observations SELECT player_id,MIN(COALESCE(at,0)),MAX(COALESCE(at,0)) FROM legacy_encounters GROUP BY player_id ${merge};
        INSERT INTO game_observations SELECT player_id,COALESCE(json_extract(payload,'$.lastEncounterAt'),0),COALESCE(json_extract(payload,'$.lastEncounterAt'),0) FROM bans WHERE json_extract(payload,'$.encountered')=1 ${merge};`);
    });
  }
  rememberSearchPlayers(players: SearchPlayer[], at: number): void {
    this.transaction(() => {
      for (const player of players) {
        if (!/^\d+$/.test(player.id)) continue;
        this.prepare(
          `INSERT INTO search_players VALUES(?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET
          name=CASE WHEN excluded.last_searched_at>=search_players.last_searched_at THEN excluded.name ELSE search_players.name END,
          first_searched_at=MIN(search_players.first_searched_at,excluded.first_searched_at),last_searched_at=MAX(search_players.last_searched_at,excluded.last_searched_at),
          payload=CASE WHEN excluded.last_searched_at>=search_players.last_searched_at THEN excluded.payload ELSE search_players.payload END`,
        ).run(player.id, player.name, at, at, JSON.stringify(player));
        this.prepare(
          'INSERT INTO search_names VALUES(?,?,?) ON CONFLICT(player_id,name) DO UPDATE SET at=MAX(search_names.at,excluded.at)',
        ).run(player.id, player.name, at);
      }
    });
  }
  searchedPlayer(id: string): SearchPlayer | null {
    const row = this.prepare('SELECT payload FROM search_players WHERE player_id=?').get(id);
    return row ? (JSON.parse(String(row.payload)) as SearchPlayer) : null;
  }
  observe(players: Array<{ id: string; name: string }>, at = Date.now()): void {
    this.transaction(() => {
      for (const p of players) {
        if (!/^\d+$/.test(p.id)) continue;
        this.prepare(
          'INSERT INTO players VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN excluded.last_seen>=COALESCE(players.last_seen,0) THEN excluded.name ELSE players.name END,first_seen=MIN(COALESCE(players.first_seen,excluded.first_seen),excluded.first_seen),last_seen=MAX(COALESCE(players.last_seen,0),excluded.last_seen),observed=1',
        ).run(p.id, p.name, at, at);
        this.prepare(
          'INSERT INTO game_observations VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET first_seen=MIN(game_observations.first_seen,excluded.first_seen),last_seen=MAX(game_observations.last_seen,excluded.last_seen)',
        ).run(p.id, at, at);
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
    if (this.matchDeleted(match)) return;
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
      if (observe)
        this.observe(
          match.players,
          match.endedAt ?? match.startedAt ?? (match.source === 'log' ? match.updatedAt : 0),
        );
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
    return accountId ? this.projectMatch(match, accountId) : match;
  }
  projectMatch(match: Match, accountId: string, savedView?: string | null): Match | null {
    const payload =
      savedView === undefined
        ? this.prepare('SELECT payload FROM match_views WHERE match_id=? AND account_id=?').get(
            match.id,
            accountId,
          )?.payload
        : savedView;
    const view = payload ? (JSON.parse(String(payload)) as Partial<Match>) : null;
    const player = match.players.find((entry) => entry.id === accountId);
    if (!view && !player) return null;
    const result = determineOutcome(match.players, accountId, match.mode, match.winnerTeamId);
    return {
      ...match,
      localPlayerId: accountId,
      localPersona: view?.localPersona || player?.name || accountId,
      outcome:
        result.outcome === 'unknown'
          ? match.localPlayerId === accountId
            ? match.outcome
            : (view?.outcome ?? 'unknown')
          : result.outcome,
      eloBefore:
        result.before ??
        (match.localPlayerId === accountId ? match.eloBefore : null) ??
        view?.eloBefore ??
        null,
      eloAfter:
        result.after ??
        (match.localPlayerId === accountId ? match.eloAfter : null) ??
        view?.eloAfter ??
        null,
    };
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
      return accountId ? this.projectMatch(match, accountId, String(row.view))! : match;
    });
  }
  deleteMatch(id: string): boolean {
    return this.transaction(() => {
      const match = this.match(id);
      if (!match) return false;
      this.advanceHistory([match]);
      const remember = this.prepare('INSERT OR IGNORE INTO deleted_log_matches VALUES(?)');
      remember.run(match.id);
      if (match.fid) remember.run(match.fid);
      remember.run('local:' + match.sessionId);
      return this.prepare('DELETE FROM matches WHERE id=?').run(match.id).changes > 0;
    });
  }
  deleteAccount(id: string): { removedMatches: number } {
    return this.transaction(() => {
      const owned = this.prepare('SELECT match_id FROM match_views WHERE account_id=?')
        .all(id)
        .map((r) => String(r.match_id));
      this.setState('history:version:account:' + id, randomUUID());
      this.advanceHistory(owned.flatMap((matchId) => this.match(matchId) ?? []));
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
  historyVersion(id = '*'): string {
    return this.state('history:version:' + id, '');
  }
  advanceHistory(matches: Match[], version: string = randomUUID()): void {
    this.setState('history:version:*', version);
    for (const match of matches)
      for (const id of new Set([match.id, match.fid, 'local:' + match.sessionId]))
        if (id) this.setState('history:version:' + id, version);
  }
  matchDeleted(match: Pick<Match, 'id' | 'fid' | 'sessionId'>): boolean {
    return !!this.prepare('SELECT 1 FROM deleted_log_matches WHERE id IN (?,?,?)').get(
      match.id,
      match.fid ?? match.id,
      'local:' + match.sessionId,
    );
  }
  restoreMatch(match: Match, observe = true): void {
    this.transaction(() => {
      this.prepare('DELETE FROM deleted_log_matches WHERE id IN (?,?,?)').run(
        match.id,
        match.fid ?? match.id,
        'local:' + match.sessionId,
      );
      this.advanceHistory([match]);
      this.saveMatch(match, observe);
    });
  }
  localSearch(query: string, includeRecorded = false): SearchPlayer[] {
    const q = query.toLocaleLowerCase();
    const recorded = this.prepare(
      'SELECT p.id,p.name,p.last_seen,GROUP_CONCAT(n.name,char(31)) aliases FROM players p LEFT JOIN player_names n ON n.player_id=p.id WHERE p.observed=1 OR ? GROUP BY p.id ORDER BY p.last_seen DESC',
    ).all(includeRecorded ? 1 : 0);
    const rows = new Map(
      recorded.map((row) => {
        const info = includeRecorded
          ? object(object(this.cache('info:' + row.id, true)?.value).info)
          : {};
        return [
          String(row.id),
          {
            id: String(row.id),
            name: String(row.name),
            at: number(row.last_seen) ?? 0,
            aliases: String(row.aliases || '').split(String.fromCharCode(31)),
            level: number(info.level),
            rating: number(info.rating),
          },
        ] as const;
      }),
    );
    for (const row of this.prepare(
      'SELECT p.*,GROUP_CONCAT(n.name,char(31)) aliases FROM search_players p LEFT JOIN search_names n ON n.player_id=p.player_id GROUP BY p.player_id',
    ).all()) {
      const id = String(row.player_id),
        previous = rows.get(id),
        info = object(JSON.parse(String(row.payload)));
      rows.set(id, {
        id,
        name:
          previous && previous.at > Number(row.last_searched_at) ? previous.name : String(row.name),
        at: Math.max(previous?.at ?? 0, Number(row.last_searched_at)),
        aliases: [
          ...(previous?.aliases ?? []),
          ...(previous ? [previous.name] : []),
          ...String(row.aliases || '').split(String.fromCharCode(31)),
        ],
        level: number(info.level),
        rating: number(info.rating),
      });
    }
    return [...rows.values()]
      .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
      .filter(
        (r) =>
          r.id.startsWith(query) ||
          r.name.toLocaleLowerCase().includes(q) ||
          r.aliases.some((name) => name.toLocaleLowerCase().includes(q)),
      )
      .slice(0, 20)
      .map(({ id, name, level, rating }) => ({ id, name, level, rating }));
  }
  player(
    id: string,
    includeRecorded = false,
  ): {
    name: string;
    firstSeen: number | null;
    lastSeen: number | null;
    names: NameRecord[];
    unverifiedObservation: boolean;
  } | null {
    const r = this.prepare(
      'SELECT p.*,g.first_seen game_first,g.last_seen game_last FROM players p LEFT JOIN game_observations g ON g.player_id=p.id WHERE p.id=? AND (p.observed=1 OR g.player_id IS NOT NULL OR ?)',
    ).get(id, includeRecorded ? 1 : 0);
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
      firstSeen: number(r.game_first),
      lastSeen: number(r.game_last),
      names,
      unverifiedObservation: Number(r.observed) === 1 && r.game_first == null,
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
      "SELECT b.payload,p.observed,g.player_id evidence_id,g.last_seen game_seen,e.player_id legacy_id,e.encounter_at FROM bans b JOIN players p ON b.player_id=p.id LEFT JOIN game_observations g ON g.player_id=p.id LEFT JOIN (SELECT player_id,MAX(at) encounter_at FROM legacy_encounters GROUP BY player_id) e ON e.player_id=b.player_id ORDER BY json_extract(b.payload,'$.firstSeenAt') DESC",
    )
      .all()
      .map((r) => {
        const b = JSON.parse(String(r.payload)) as Ban;
        const lastEncounterAt =
          Math.max(number(r.game_seen) ?? 0, number(r.encounter_at) ?? 0) || null;
        return {
          ...b,
          encountered: b.encountered || r.evidence_id != null || r.legacy_id != null,
          lastEncounterAt,
          unverifiedObservation:
            Number(r.observed) === 1 &&
            !b.encountered &&
            r.evidence_id == null &&
            r.legacy_id == null,
        };
      })
      .filter((b) => !metOnly || b.encountered);
  }
  saveBans(list: Ban[]): Ban[] {
    return this.transaction(() => {
      const newly: Ban[] = [];
      for (const b of list) {
        this.ensurePlayer(b.id, b.name);
        if (b.encountered)
          this.prepare(
            'INSERT INTO game_observations VALUES(?,?,?) ON CONFLICT(player_id) DO NOTHING',
          ).run(b.id, b.lastEncounterAt ?? 0, b.lastEncounterAt ?? 0);
        const old = this.prepare('SELECT payload FROM bans WHERE player_id=?').get(b.id);
        const value = old
          ? { ...b, firstSeenAt: (JSON.parse(String(old.payload)) as Ban).firstSeenAt }
          : b;
        if (!old && this.hasGameObservation(b.id)) newly.push({ ...value, encountered: true });
        this.prepare(
          'INSERT INTO bans VALUES(?,?) ON CONFLICT(player_id) DO UPDATE SET payload=excluded.payload',
        ).run(b.id, JSON.stringify(value));
      }
      if (newly.length)
        this.setState('banAlerts', [
          ...this.banAlerts(),
          { id: randomUUID(), createdAt: Date.now(), players: newly },
        ]);
      return newly;
    });
  }
  banAlerts(): BanAlertBatch[] {
    return this.state<BanAlertBatch[]>('banAlerts', []);
  }
  acknowledgeBanAlerts(ids: string[]): void {
    this.transaction(() => {
      const acknowledged = new Set(ids);
      this.setState(
        'banAlerts',
        this.banAlerts().filter((batch) => !acknowledged.has(batch.id)),
      );
    });
  }
  encounters(
    id: string,
    scope: { accountId?: string | null; combined?: boolean } = {},
  ): Encounter[] {
    return this.encounterViews(id, scope).encounters;
  }
  encounterViews(id: string, scope: { accountId?: string | null; combined?: boolean } = {}) {
    const accounts = this.accounts().sort((a, b) => a.id.localeCompare(b.id));
    const accountId =
      scope.accountId === undefined
        ? this.state<string | null>('activeAccountId', null)
        : scope.accountId;
    const combined = scope.combined ?? this.config().multiAccountBond;
    const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
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
      const target = m.players.find((p) => p.id === id);
      if (!target) continue;
      for (const account of accounts) {
        if (account.id === id) continue;
        const view = views.get(m.id)?.get(account.id);
        const mine = m.players.find((p) => p.id === account.id);
        if (!view && m.localPlayerId !== account.id && !mine) continue;
        const projected = this.projectMatch(m, account.id, view ?? null);
        if (!projected) continue;
        const spectator = mine?.teamId === 100 || target.teamId === 100;
        out.push({
          accountId: account.id,
          accountName: account.name,
          matchId: m.id,
          at: m.endedAt,
          map: m.map,
          relation: spectator
            ? 'spectator'
            : mine?.teamId == null || target.teamId === null
              ? 'unknown'
              : mine.teamId === target.teamId
                ? 'same'
                : 'opponent',
          won: projected.outcome === 'win' ? true : projected.outcome === 'loss' ? false : null,
          custom: m.mode === 'custom',
        });
      }
    }
    const seen = new Set(out.map((encounter) => encounter.matchId));
    const legacy = this.prepare('SELECT payload FROM legacy_encounters WHERE player_id=?').all(id);
    for (const row of legacy) {
      const p = object(JSON.parse(String(row.payload))),
        fid = text(p.fid);
      const owner = text(p.accountId || p.localPlayerId || p.ownerId);
      const legacyAccount = /^\d+$/.test(owner) ? owner : null;
      if (
        seen.has(fid) &&
        (!legacyAccount ||
          out.some((entry) => entry.matchId === fid && entry.accountId === legacyAccount))
      )
        continue;
      const matchId = fid || text(p.id);
      seen.add(matchId);
      out.push({
        accountId: legacyAccount,
        accountName: legacyAccount
          ? accountNames.get(legacyAccount) || text(p.accountName) || null
          : null,
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
    const encounters = (
      combined ? out : out.filter((entry) => !!accountId && entry.accountId === accountId)
    ).sort(
      (a, b) =>
        (b.at || 0) - (a.at || 0) ||
        b.matchId.localeCompare(a.matchId) ||
        Number(b.accountId === accountId) - Number(a.accountId === accountId) ||
        (a.accountId || '~').localeCompare(b.accountId || '~'),
    );
    return {
      encounters,
      scope: {
        accountId,
        accountName: accountId ? accountNames.get(accountId) || null : null,
        combined,
        unattributedCount: out.filter((entry) => !entry.accountId).length,
      },
    };
  }
  cacheStats(now = Date.now()): CacheStats {
    const usage = (row: Record<string, unknown>): CacheUsage => ({
      entries: Number(row.entries),
      expired: Number(row.expired),
      bytes: Number(row.bytes),
    });
    const ttl = projectConfig.cache.ttlMs.player;
    const api = this.prepare(
      'SELECT COUNT(*) AS entries,COALESCE(SUM(expires_at<=?),0) AS expired,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes,MIN(CASE WHEN expires_at>? THEN expires_at END) AS nextExpiryAt FROM api_cache',
    ).get(now, now)!;
    const snapshots = this.prepare(
      "SELECT COUNT(*) AS entries,COALESCE(SUM(at<? OR json_extract(payload,'$.stale')=1),0) AS expired,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes,MIN(CASE WHEN at>=? AND COALESCE(json_extract(payload,'$.stale'),0)<>1 THEN at+?+1 END) AS nextExpiryAt FROM player_snapshots",
    ).get(now - ttl, now - ttl, ttl)!;
    const expiries = [api.nextExpiryAt, snapshots.nextExpiryAt]
      .filter((value) => value !== null)
      .map(Number);
    return {
      at: now,
      nextExpiryAt: expiries.length ? Math.min(...expiries) : null,
      api: usage(api),
      snapshots: usage(snapshots),
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
  removeCache(key: string): void {
    this.prepare('DELETE FROM api_cache WHERE key=?').run(key);
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
