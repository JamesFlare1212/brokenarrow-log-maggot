import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyMatch, emptyPlayer } from '@ba/shared';
import { LogArchive } from '../apps/server/src/logs/archive';
import { Database } from '../apps/server/src/storage/database';

const directories: string[] = [];
const databases: Database[] = [];
async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ba-archive-'));
  directories.push(dir);
  return dir;
}
function database(file = ':memory:'): Database {
  const db = new Database(file);
  databases.push(db);
  return db;
}
function log(fid: string | null, name = '测试玩家', day = 13): string {
  return [
    `[2026-10-${day} 10:00:00.000]`,
    `Log: GetPersonaName ${name}`,
    'Log: Start loading battle... map: Dam, scenario: Test',
    ...(fid ? [`Log: FID:${fid}`] : []),
    'Log: Player list:',
    `ID: 1, Name: ${name}, Team: Alpha`,
    `[2026-10-${day} 10:15:00.000]`,
    'Log: GameController dispose called',
    '',
  ].join('\n');
}
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('complete local match archive', () => {
  it('imports all log files and nested history, including multiple matches and a final line without newline', async () => {
    const dir = await directory();
    await mkdir(join(dir, 'history'));
    await writeFile(join(dir, 'Gamelog__new.log'), log('104', '当前名字', 15));
    await writeFile(join(dir, 'Gamelog__old.log'), log('101') + log(null));
    await writeFile(join(dir, 'history', 'old.TXT'), log('102').trimEnd());
    await writeFile(join(dir, 'other.log'), log('103'));
    await writeFile(join(dir, 'ignored.json'), log('999'));
    const db = database();
    await new LogArchive(db).scan(dir);
    expect(db.matches()).toHaveLength(5);
    expect(db.matches().map((m) => m.fid)).toEqual(
      expect.arrayContaining(['101', '102', '103', '104', null]),
    );
    expect(db.matches('1')).toHaveLength(5);
    expect(db.match('102')).toMatchObject({ durationSec: 900, localPersona: '测试玩家' });
    expect(db.accounts()[0]).toMatchObject({
      name: '当前名字',
      firstSeen: new Date(2026, 9, 13, 10, 15).getTime(),
      lastSeen: new Date(2026, 9, 15, 10, 15).getTime(),
    });
  });

  it('persists checkpoints across restart, shares concurrent scans, and discovers changed and new files without duplicates', async () => {
    const dir = await directory();
    const logs = join(dir, 'logs');
    await mkdir(logs);
    const path = join(logs, 'Gamelog__old.log');
    await writeFile(path, log('101') + log(null));
    const dbPath = join(dir, 'archive.sqlite');
    const db = database(dbPath);
    const changed = vi.fn();
    const archive = new LogArchive(db, changed);
    const first = archive.scan(logs);
    expect(archive.scan(logs)).toBe(first);
    await first;
    const ids = db.matches().map((m) => m.id);
    expect(changed).toHaveBeenCalledTimes(1);
    db.close();
    databases.splice(databases.indexOf(db), 1);
    const reopened = database(dbPath);
    const restart = new LogArchive(reopened, changed);
    await restart.scan(logs);
    expect(changed).toHaveBeenCalledTimes(1);
    await appendFile(path, log('102'));
    await writeFile(join(logs, 'new.txt'), log('103'));
    await restart.scan(logs);
    expect(reopened.matches()).toHaveLength(4);
    expect(reopened.matches().map((m) => m.id)).toEqual(expect.arrayContaining(ids));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('retains unfinished sessions with unknown end time, and merges their later FID and end event', async () => {
    const dir = await directory();
    const path = join(dir, 'Gamelog__unfinished.log');
    await writeFile(
      path,
      '[2026-10-13 10:00:00.000]\nLog: Start loading battle... map: Dam, scenario: Test\n',
    );
    const db = database();
    const archive = new LogArchive(db);
    await archive.scan(dir);
    const initial = db.matches()[0]!;
    expect(initial).toMatchObject({ fid: null, endedAt: null, durationSec: null });
    await appendFile(
      path,
      'Log: FID:101\n[2026-10-13 10:15:00.000]\nLog: GameController dispose called\nLog: [NET_ROOM] Connection closed. Info FightId=101 LiveTime: 890 sec',
    );
    await archive.scan(dir);
    expect(db.matches()).toHaveLength(1);
    expect(db.match('101')).toMatchObject({
      sessionId: initial.sessionId,
      durationSec: 890,
      durationSource: 'log',
      endedAt: new Date(2026, 9, 13, 10, 15).getTime(),
    });
  });

  it('keeps deleted records excluded after log changes, including a late FID for a deleted local session', async () => {
    const dir = await directory();
    const path = join(dir, 'Gamelog__old.log');
    await writeFile(path, log('101') + 'Log: Start loading battle... map: Coast, scenario: Test\n');
    const db = database();
    const archive = new LogArchive(db);
    await archive.scan(dir);
    const local = db.matches().find((m) => m.fid === null)!;
    expect(db.deleteMatch('101')).toBe(true);
    expect(db.deleteMatch(local.id)).toBe(true);
    await appendFile(path, 'Log: FID:102\nLog: GameController dispose called\n' + log('103'));
    await new LogArchive(db).scan(dir);
    expect(db.matches().map((m) => m.id)).toEqual(['103']);
  });

  it('preserves authoritative API facts when replaying historical logs', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'old.log'), log('101'));
    const db = database();
    db.saveMatch({
      ...emptyMatch('101'),
      source: 'api',
      outcome: 'win',
      mode: 'ranked',
      durationSec: 880,
      durationSource: 'api',
      players: [{ ...emptyPlayer('1', '测试玩家'), destructionScore: 1200 }],
      updatedAt: 1234,
    });
    await new LogArchive(db).scan(dir);
    expect(db.match('101')).toMatchObject({
      source: 'api',
      outcome: 'win',
      mode: 'ranked',
      durationSec: 880,
      durationSource: 'api',
      updatedAt: 1234,
      players: [expect.objectContaining({ destructionScore: 1200 })],
    });
  });

  it('returns every record beyond 500, including account views and unknown timestamps', async () => {
    const dir = await directory();
    await writeFile(
      join(dir, 'Gamelog__many.log'),
      Array.from({ length: 525 }, (_, i) => log(String(1000 + i))).join(''),
    );
    const db = database();
    await new LogArchive(db).scan(dir);
    expect(db.matches()).toHaveLength(525);
    expect(db.matches('1')).toHaveLength(525);
    expect(db.matches('1').map((m) => m.fid)).toContain('1000');
    db.saveMatch({
      ...emptyMatch('9000', Date.now()),
      localPlayerId: '1',
      players: [emptyPlayer('1')],
    });
    expect(db.matches()[0]?.id).toBe('9000');
    expect(db.matches('1')).toHaveLength(526);
  });

  it('cancels an in-flight import without writing checkpoints and can retry after a directory error', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'old.log'), log('101'));
    const db = database();
    const archive = new LogArchive(db);
    const pending = archive.scan(dir);
    archive.cancel();
    await pending;
    expect(db.matches()).toHaveLength(0);
    await expect(archive.scan(join(dir, 'missing'))).rejects.toThrow();
    await archive.scan(dir);
    expect(db.matches()).toHaveLength(1);
  });
});
