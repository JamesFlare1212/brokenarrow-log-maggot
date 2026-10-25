import { afterEach, describe, expect, it } from 'vitest';
import type { Ban } from '@ba/contracts';
import { Database } from '../apps/server/src/storage/database';

const databases: Database[] = [];
const ban: Ban = {
  id: '123',
  name: 'Observed player',
  steamId: '',
  rating: 1500,
  firstSeenAt: 1000,
  lastSeenAt: 9000,
  encountered: false,
};
function database() {
  const db = new Database(':memory:');
  databases.push(db);
  return db;
}
afterEach(() => databases.splice(0).forEach((db) => db.close()));
describe('ban encounter timestamps', () => {
  it('includes a later legacy encounter without treating an unobserved cached player as a new sighting', () => {
    const db = database();
    db.saveBans([ban]);
    db.sql.prepare('UPDATE players SET last_seen=? WHERE id=?').run(99000, ban.id);
    db.sql
      .prepare('INSERT INTO legacy_encounters VALUES(?,?,?,?,?)')
      .run('legacy-1', ban.id, '99', 7000, JSON.stringify({ at: 7000 }));
    expect(db.bans(true)[0]).toMatchObject({ lastEncounterAt: 7000, encountered: true });
  });

  it('does not substitute ban detection or cache timestamps for an encounter', () => {
    const db = database();
    db.saveBans([ban]);
    expect(db.bans()[0]).toMatchObject({
      firstSeenAt: 1000,
      lastSeenAt: 9000,
      lastEncounterAt: null,
      encountered: false,
    });
    expect(db.bans(true)).toEqual([]);
  });
  it('reports the most recent local observation and keeps it independent of ban sync', () => {
    const db = database();
    db.saveBans([ban]);
    db.observe([{ id: ban.id, name: ban.name }], 5000);
    db.observe([{ id: ban.id, name: ban.name }], 3000);
    db.saveBans([{ ...ban, lastSeenAt: 12000 }]);
    expect(db.bans(true)[0]).toMatchObject({
      firstSeenAt: 1000,
      lastSeenAt: 12000,
      lastEncounterAt: 5000,
      encountered: true,
    });
  });
});
