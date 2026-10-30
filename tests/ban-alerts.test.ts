import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ban } from '@ba/contracts';
import { Database } from '../apps/server/src/storage/database';

const databases: Database[] = [];
const directories: string[] = [];
const root = resolve('.test-data/ban-alerts-tests');
const player = (id: string): Ban => ({
  id,
  name: 'Same name',
  steamId: '',
  rating: 2000,
  firstSeenAt: 1,
  lastSeenAt: 2,
  encountered: false,
});
function database(file = ':memory:') {
  const db = new Database(file);
  databases.push(db);
  return db;
}
function observe(db: Database, ...ids: string[]) {
  db.observe(
    ids.map((id) => ({ id, name: 'Same name' })),
    1,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    expect(dirname(resolve(directory))).toBe(root);
    rmSync(directory, { recursive: true, force: true });
  }
});
describe('durable ban alert inbox', () => {
  it('queues only newly banned observed players and freezes the reviewed identity', () => {
    const db = database();
    observe(db, '1');
    expect(db.saveBans([player('1'), player('2')]).map((ban) => ban.id)).toEqual(['1']);
    const original = db.banAlerts();
    expect(original[0]?.players.map((ban) => ban.id)).toEqual(['1']);
    expect(db.saveBans([{ ...player('1'), name: 'Changed name', lastSeenAt: 100 }])).toEqual([]);
    expect(db.banAlerts()).toEqual(original);
  });
  it('keeps FIFO batches across a database reopen and acknowledges exact batch IDs idempotently', () => {
    mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(join(root, 'profile-'));
    directories.push(directory);
    const file = join(directory, 'app.sqlite');
    const first = database(file);
    observe(first, '1', '2', '3');
    first.saveBans([player('1')]);
    first.saveBans([player('2')]);
    const saved = first.banAlerts();
    databases.splice(databases.indexOf(first), 1);
    first.close();
    const reopened = database(file);
    expect(reopened.banAlerts()).toEqual(saved);
    reopened.saveBans([player('3')]);
    reopened.acknowledgeBanAlerts([saved[0]!.id]);
    reopened.acknowledgeBanAlerts([saved[0]!.id]);
    expect(reopened.banAlerts().map((batch) => batch.players[0]!.id)).toEqual(['2', '3']);
    expect(reopened.bans()).toHaveLength(3);
  });
  it('rolls back ban persistence when its notification cannot be persisted', () => {
    const db = database();
    observe(db, '1');
    const write = vi.spyOn(db, 'setState').mockImplementation(() => {
      throw new Error('Controlled write failure');
    });
    expect(() => db.saveBans([player('1')])).toThrow('Controlled write failure');
    expect(db.bans()).toEqual([]);
    expect(db.banAlerts()).toEqual([]);
    write.mockRestore();
    expect(db.saveBans([player('1')])).toHaveLength(1);
    expect(db.banAlerts()).toHaveLength(1);
  });
  it('retains the full inbox after a failed acknowledgement transaction', () => {
    const db = database();
    observe(db, '1', '2');
    db.saveBans([player('1')]);
    db.saveBans([player('2')]);
    const saved = db.banAlerts();
    const write = db.setState.bind(db);
    vi.spyOn(db, 'setState').mockImplementation((key, value) => {
      write(key, value);
      throw new Error('Controlled commit failure');
    });
    expect(() => db.acknowledgeBanAlerts([saved[0]!.id])).toThrow('Controlled commit failure');
    expect(db.banAlerts()).toEqual(saved);
  });
});
