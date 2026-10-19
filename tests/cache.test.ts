import { afterEach, describe, expect, it } from 'vitest';
import type { MiniInfo } from '@ba/contracts';
import { rpcSchemas } from '@ba/contracts';
import { emptyMatch, emptyPlayer } from '@ba/shared';
import { Database } from '../apps/server/src/storage/database';

const databases: Database[] = [];
const now = 1800000000000;
function database() {
  const db = new Database(':memory:');
  databases.push(db);
  return db;
}
function summary(updatedAt: number): MiniInfo {
  return {
    name: '玩家',
    elo: 1500,
    kd: null,
    winRate: null,
    matchCount: 12,
    category: null,
    topUnits: '',
    updatedAt,
    stale: false,
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('cache management', () => {
  it('reports empty caches with zero counts and sizes', () => {
    const db = database();
    expect(db.cacheStats(now)).toEqual({
      api: { entries: 0, expired: 0, bytes: 0 },
      snapshots: { entries: 0, expired: 0, bytes: 0 },
    });
    expect(db.clearCache('expired', now).removed).toBe(0);
  });

  it('counts UTF-8 payload bytes and uses the existing expiration boundaries', () => {
    const db = database();
    const payload = { name: '玩家' };
    db.saveCache('fresh', payload, 1, now);
    db.saveCache('expired', payload, 1, now - 1);
    const fresh = summary(now - 21600000),
      expired = summary(now - 21600001);
    db.saveSnapshot('1', fresh);
    db.saveSnapshot('2', expired);
    expect(db.cacheStats(now)).toEqual({
      api: { entries: 2, expired: 1, bytes: 2 * Buffer.byteLength(JSON.stringify(payload)) },
      snapshots: {
        entries: 2,
        expired: 1,
        bytes:
          Buffer.byteLength(JSON.stringify(fresh)) + Buffer.byteLength(JSON.stringify(expired)),
      },
    });
  });

  it('removes expired responses and summaries while retaining fresh entries', () => {
    const db = database();
    db.saveCache('fresh', { fresh: true }, 1, now);
    db.saveCache('expired', { old: true }, 1, now - 1);
    db.saveSnapshot('1', summary(now - 21600000));
    db.saveSnapshot('2', summary(now - 21600001));
    db.saveSnapshot('3', summary(now));
    db.sql.exec(
      "UPDATE player_snapshots SET payload=json_set(payload,'$.stale',json('true')) WHERE player_id='3'",
    );
    expect(db.cacheStats(now).snapshots.expired).toBe(2);
    const result = db.clearCache('expired', now);
    expect(result.removed).toBe(3);
    expect(result.stats.api).toMatchObject({ entries: 1, expired: 0 });
    expect(result.stats.snapshots).toMatchObject({ entries: 1, expired: 0 });
    expect(db.cache('fresh', false, now)?.value).toEqual({ fresh: true });
    expect(db.cache('expired', true, now)).toBeNull();
    expect(db.snapshot('1')).not.toBeNull();
    expect(db.snapshot('2')).toBeNull();
    expect(db.snapshot('3')).toBeNull();
  });

  it('clears both caches without deleting match history, players, bans, accounts or preferences', () => {
    const db = database();
    db.saveCache('info:1', { name: 'Player' }, 21600000, now);
    db.saveSnapshot('1', summary(now));
    db.observe([{ id: '1', name: 'Player' }], now);
    db.observeAccount('1', 'Player', 'Local player', now);
    db.saveMatch({
      ...emptyMatch('123', now),
      localPlayerId: '1',
      players: [emptyPlayer('1', 'Player')],
    });
    db.saveBans([
      {
        id: '1',
        name: 'Player',
        steamId: '',
        rating: 1500,
        firstSeenAt: now,
        lastSeenAt: now,
        encountered: true,
      },
    ]);
    db.updateConfig({ lang: 'en' });
    db.setState('activeAccountId', '1');
    const tables = [
      'players',
      'player_names',
      'matches',
      'match_players',
      'match_views',
      'accounts',
      'bans',
      'settings',
      'app_state',
    ];
    const rows = () => tables.map((table) => db.sql.prepare(`SELECT * FROM ${table}`).all());
    const before = rows();
    const result = db.clearCache('all', now);
    expect(result).toEqual({
      removed: 2,
      stats: {
        api: { entries: 0, expired: 0, bytes: 0 },
        snapshots: { entries: 0, expired: 0, bytes: 0 },
      },
    });
    expect(rows()).toEqual(before);
    expect(db.clearCache('all', now).removed).toBe(0);
  });

  it('rolls back both cache deletions when either one fails', () => {
    const db = database();
    db.saveCache('info:1', {}, 1, now);
    db.saveSnapshot('1', summary(now));
    db.sql.exec(
      "CREATE TRIGGER prevent_cache_clear BEFORE DELETE ON player_snapshots BEGIN SELECT RAISE(ABORT,'Cache cleanup failed'); END",
    );
    const before = db.cacheStats(now);
    expect(() => db.clearCache('all', now)).toThrow('Cache cleanup failed');
    expect(db.cacheStats(now)).toEqual(before);
  });

  it('requires an explicit supported cleanup mode at the RPC boundary', () => {
    expect(rpcSchemas['cache.stats'].parse(null)).toBeNull();
    expect(rpcSchemas['cache.clear'].parse({ mode: 'expired' })).toEqual({ mode: 'expired' });
    expect(rpcSchemas['cache.clear'].safeParse({}).success).toBe(false);
    expect(rpcSchemas['cache.clear'].safeParse({ mode: 'unknown' }).success).toBe(false);
    expect(rpcSchemas['cache.clear'].safeParse({ mode: 'all', table: 'matches' }).success).toBe(
      false,
    );
  });
});
