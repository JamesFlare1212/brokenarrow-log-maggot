import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  realpath,
  rm,
  symlink,
  lstat,
  utimes,
  rename,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filename } from '@ba/shared';
import { Database } from '../apps/server/src/storage/database';
import { ReplayFiles, replayName } from '../apps/server/src/replays/files';
import { atomicWrite, childPath } from '../apps/server/src/files/paths';
import * as filePaths from '../apps/server/src/files/paths';
import { DeckService } from '../apps/server/src/decks/service';
import { LogParser } from '../apps/server/src/logs/parser';
import { zipCreate, zipExtract } from '../apps/server/src/decks/zip';

const workspace = resolve(process.cwd());
const testRoot = resolve(workspace, '.test-data', 'recordings');
const temporary: Array<{ path: string; root: string; workspace: string }> = [];
const databases: Database[] = [];

function assertChild(root: string, target: string): void {
  const child = relative(resolve(root), resolve(target));
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
    throw new Error('Refusing to clean a directory outside the test root');
  }
}
async function temp(): Promise<string> {
  await mkdir(testRoot, { recursive: true });
  const root = await realpath(testRoot),
    realWorkspace = await realpath(workspace);
  assertChild(realWorkspace, root);
  const path = await mkdtemp(join(root, 'files-'));
  assertChild(root, path);
  temporary.push({ path, root, workspace: realWorkspace });
  return path;
}
function database(): Database {
  const db = new Database(':memory:');
  databases.push(db);
  return db;
}
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const entry of temporary.splice(0)) {
    const target = await realpath(resolve(entry.path));
    assertChild(entry.workspace, target);
    assertChild(entry.root, target);
    await rm(target, { recursive: true, force: true });
  }
});

function centralOffset(zip: Buffer): number {
  return zip.readUInt32LE(zip.length - 22 + 16);
}
async function archiveWithName(name: string): Promise<Buffer> {
  const valid = 'x'.repeat(name.length - 4) + '.dek';
  const zip = await zipCreate([{ name: valid, data: Buffer.from('X') }]);
  zip.write(name, 30, 'utf8');
  zip.write(name, centralOffset(zip) + 46, 'utf8');
  return zip;
}

describe('deck ZIP integrity and capacity', () => {
  it('round trips stored and deflated entries, including UTF-8 names', async () => {
    const small = Buffer.from('X'),
      compressed = Buffer.from('deck-data-'.repeat(1_000));
    const zip = await zipCreate([
      { name: 'small.dek', data: small },
      { name: '前线卡组.dek', data: compressed },
    ]);
    expect(zip.readUInt16LE(8)).toBe(0);
    const firstCentral = centralOffset(zip);
    const nextCentral = firstCentral + 46 + zip.readUInt16LE(firstCentral + 28);
    expect(zip.readUInt16LE(nextCentral + 10)).toBe(8);
    const entries = await zipExtract(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['small.dek', '前线卡组.dek']);
    expect(entries[0]?.data).toEqual(small);
    expect(entries[1]?.data).toEqual(compressed);
  });

  it('rejects a stored payload whose bytes no longer match its CRC', async () => {
    const zip = await zipCreate([{ name: 'one.dek', data: Buffer.from('X') }]);
    const dataAt = 30 + zip.readUInt16LE(26);
    zip[dataAt] = (zip[dataAt] ?? 0) ^ 1;
    await expect(zipExtract(zip)).rejects.toThrow(/integrity/i);
  });

  it('checks the CRC of a successfully inflated entry', async () => {
    const zip = await zipCreate([{ name: 'compressed.dek', data: Buffer.alloc(4_096, 1) }]);
    const crcAt = centralOffset(zip) + 16;
    zip[crcAt] = (zip[crcAt] ?? 0) ^ 1;
    await expect(zipExtract(zip)).rejects.toThrow(/integrity/i);
  });

  it.each(['../x.dek', 'C:\\x.dek', 'CON.dek', 'NUL.DEK', 'file.txt'])(
    'rejects unsafe imported ZIP entry %s',
    async (name) => {
      await expect(zipExtract(await archiveWithName(name))).rejects.toThrow(/file name|\.dek/i);
    },
  );

  it('rejects case-insensitive duplicate names on Windows', async () => {
    const zip = await zipCreate([
      { name: 'One.dek', data: Buffer.from('A') },
      { name: 'one.dek', data: Buffer.from('B') },
    ]);
    await expect(zipExtract(zip)).rejects.toThrow(/duplicate/i);
  });

  it('rejects a truncated central directory', async () => {
    const zip = await zipCreate([{ name: 'one.dek', data: Buffer.from('X') }]);
    zip.writeUInt32LE(zip.length, centralOffset(zip) + 42);
    await expect(zipExtract(zip)).rejects.toThrow(/unsafe|corrupt|truncated/i);
  });

  it('bounds the size of one deck before compressing it', async () => {
    await expect(
      zipCreate([{ name: 'large.dek', data: Buffer.alloc(8 * 1_024 * 1_024 + 1) }]),
    ).rejects.toThrow(/size limit/i);
  });

  it('bounds the cumulative uncompressed size of a backup', async () => {
    const data = Buffer.alloc(8 * 1_024 * 1_024);
    const files = Array.from({ length: 13 }, (_, i) => ({ name: `deck-${i}.dek`, data }));
    await expect(zipCreate(files)).rejects.toThrow(/size limit/i);
  });

  it('rejects too many entries in both written and imported archives', async () => {
    await expect(
      zipCreate(
        Array.from({ length: 2_001 }, (_, i) => ({ name: `${i}.dek`, data: Buffer.alloc(0) })),
      ),
    ).rejects.toThrow(/too many/i);
    const archive = Buffer.alloc(22);
    archive.writeUInt32LE(0x06054b50);
    archive.writeUInt16LE(2_001, 8);
    archive.writeUInt16LE(2_001, 10);
    await expect(zipExtract(archive)).rejects.toThrow(/directory/i);
  });

  it('rejects an entry advertising output larger than the allowed decompression limit', async () => {
    const zip = await zipCreate([{ name: 'one.dek', data: Buffer.from('X') }]);
    zip.writeUInt32LE(8 * 1_024 * 1_024 + 1, centralOffset(zip) + 24);
    await expect(zipExtract(zip)).rejects.toThrow(/unsafe/i);
  });
});

describe('deck backup preservation', () => {
  it('preserves the existing archive and removes staging files after a name collision', async () => {
    const root = await temp();
    const decksDir = join(root, 'Decks');
    await mkdir(decksDir);
    await writeFile(join(decksDir, 'Alpha.dek'), 'original');
    const db = database();
    db.updateConfig({ decksDir });
    const decks = new DeckService(db);
    await decks.backup(['Alpha.dek'], 'manual');
    const archive = join(root, 'DeckBackups', 'manual.zip');
    const original = await readFile(archive);
    await writeFile(join(decksDir, 'Alpha.dek'), 'changed');
    await expect(decks.backup(['Alpha.dek'], 'manual.zip')).rejects.toThrow('DECK_BACKUP_EXISTS');
    expect(await readFile(archive)).toEqual(original);
    expect(await readdir(join(root, 'DeckBackups'))).toEqual(['manual.zip']);
    await decks.backup(['Alpha.dek'], 'recovery');
    expect(
      (
        await zipExtract(await readFile(join(root, 'DeckBackups', 'recovery.zip')))
      )[0]?.data.toString(),
    ).toBe('changed');
  });

  it('publishes exactly one complete archive when two writers use the same new name', async () => {
    const root = await temp();
    const first = await zipCreate([{ name: 'Alpha.dek', data: Buffer.from('first') }]);
    const second = await zipCreate([{ name: 'Bravo.dek', data: Buffer.from('second') }]);
    const results = await Promise.allSettled([
      atomicWrite(root, 'shared.zip', first, false),
      atomicWrite(root, 'shared.zip', second, false),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const saved = await readFile(join(root, 'shared.zip'));
    expect(saved.equals(first) || saved.equals(second)).toBe(true);
    await expect(zipExtract(saved)).resolves.toHaveLength(1);
    expect(await readdir(root)).toEqual(['shared.zip']);
  });

  it('retains intentional replacement for the automatic previous-match archive', async () => {
    const root = await temp();
    const decksDir = join(root, 'Decks');
    await mkdir(decksDir);
    await writeFile(join(decksDir, 'Alpha.dek'), 'first');
    const db = database();
    db.updateConfig({ decksDir });
    const decks = new DeckService(db);
    const session = new LogParser(() => {}).snapshot();
    session.accountKey = 'persona:Alpha';
    session.localName = 'Alpha';
    await decks.onMatchStart(session);
    await writeFile(join(decksDir, 'Alpha.dek'), 'second');
    await decks.onMatchStart(session);
    const entries = await zipExtract(await readFile(join(root, 'DeckBackups', '上一局卡组包.zip')));
    expect(entries[0]?.data.toString()).toBe('second');
    expect(await readdir(join(root, 'DeckBackups'))).toEqual(['上一局卡组包.zip']);
  });
});

describe('reviewed deck operations', () => {
  async function fixture() {
    const root = await temp();
    const decksDir = join(root, 'Decks');
    await mkdir(decksDir);
    const db = database();
    db.updateConfig({ decksDir });
    return { root, decksDir, db, decks: new DeckService(db) };
  }

  it('reports partial deletion and retries only the files that remain', async () => {
    const { decksDir, decks } = await fixture();
    await writeFile(join(decksDir, 'Alpha.dek'), 'alpha');
    await writeFile(join(decksDir, 'Charlie.dek'), 'charlie');
    const result = await decks.remove(
      'decks',
      ['Alpha.dek', 'Missing.dek', 'Charlie.dek'],
      decksDir,
    );
    expect(result).toMatchObject({
      removed: 2,
      completed: ['Alpha.dek', 'Charlie.dek'],
      skipped: [],
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.name).toBe('Missing.dek');
    expect(await readdir(decksDir)).toEqual([]);
    await writeFile(join(decksDir, 'Missing.dek'), 'recovered');
    const retry = await decks.remove(
      'decks',
      result.failed.map((failure) => failure.name),
      decksDir,
    );
    expect(retry).toEqual({ removed: 1, completed: ['Missing.dek'], failed: [], skipped: [] });
  });

  it('rejects deletion and backup against a different configured directory', async () => {
    const { root, decksDir, db, decks } = await fixture();
    const other = join(root, 'OtherDecks');
    await mkdir(other);
    await writeFile(join(decksDir, 'Shared.dek'), 'original directory');
    await writeFile(join(other, 'Shared.dek'), 'new directory');
    db.updateConfig({ decksDir: other });
    await expect(decks.remove('decks', ['Shared.dek'], decksDir)).rejects.toThrow(
      'DECK_DIRECTORY_CHANGED',
    );
    await expect(decks.backup(['Shared.dek'], 'wrong-directory', decksDir)).rejects.toThrow(
      'DECK_DIRECTORY_CHANGED',
    );
    expect(await readFile(join(decksDir, 'Shared.dek'), 'utf8')).toBe('original directory');
    expect(await readFile(join(other, 'Shared.dek'), 'utf8')).toBe('new directory');
  });

  it('previews conflicts and preserves original decks in an independently restorable archive', async () => {
    const { root, decksDir, decks } = await fixture();
    await writeFile(join(decksDir, 'Alpha.dek'), 'backup alpha');
    await decks.backup(['Alpha.dek'], 'snapshot');
    await writeFile(join(decksDir, 'Alpha.dek'), 'current alpha');
    await writeFile(join(decksDir, 'Unrelated.dek'), 'keep');
    const plan = await decks.planRestore('snapshot.zip', decksDir);
    expect(plan).toMatchObject({
      directory: decksDir,
      name: 'snapshot.zip',
      files: ['Alpha.dek'],
      replacements: ['Alpha.dek'],
    });
    const result = await decks.deploy(plan.token);
    expect(result).toMatchObject({
      deployed: 1,
      completed: ['Alpha.dek'],
      failed: [],
      skipped: [],
    });
    expect(await readFile(join(decksDir, 'Alpha.dek'), 'utf8')).toBe('backup alpha');
    expect(await readFile(join(decksDir, 'Unrelated.dek'), 'utf8')).toBe('keep');
    const recovery = await zipExtract(
      await readFile(join(root, 'DeckBackups', result.recoveryBackup!)),
    );
    expect(recovery.map((entry) => [entry.name, entry.data.toString()])).toEqual([
      ['Alpha.dek', 'current alpha'],
    ]);
    await decks.deploy((await decks.planRestore(result.recoveryBackup!, decksDir)).token);
    expect(await readFile(join(decksDir, 'Alpha.dek'), 'utf8')).toBe('current alpha');
    await expect(decks.deploy(plan.token)).rejects.toThrow('DECK_RESTORE_EXPIRED');
  });

  it('rejects a blocked later restore target before replacing an earlier deck', async () => {
    const { root, decksDir, decks } = await fixture();
    await writeFile(join(decksDir, 'Alpha.dek'), 'current alpha');
    await mkdir(join(decksDir, 'Blocked.dek'));
    await mkdir(join(root, 'DeckBackups'));
    await writeFile(
      join(root, 'DeckBackups', 'snapshot.zip'),
      await zipCreate([
        { name: 'Alpha.dek', data: Buffer.from('replacement') },
        { name: 'Blocked.dek', data: Buffer.from('blocked') },
      ]),
    );
    await expect(decks.planRestore('snapshot.zip', decksDir)).rejects.toThrow('DECK_UNSAFE_TARGET');
    expect(await readFile(join(decksDir, 'Alpha.dek'), 'utf8')).toBe('current alpha');
  });

  it('reports completed, failed and skipped restores and retains recoverable original bytes after a write failure', async () => {
    const { root, decksDir, decks } = await fixture();
    for (const name of ['Alpha.dek', 'Bravo.dek', 'Charlie.dek'])
      await writeFile(join(decksDir, name), 'backup ' + name);
    await decks.backup(['Alpha.dek', 'Bravo.dek', 'Charlie.dek'], 'snapshot');
    for (const name of ['Alpha.dek', 'Bravo.dek', 'Charlie.dek'])
      await writeFile(join(decksDir, name), 'original ' + name);
    const plan = await decks.planRestore('snapshot.zip', decksDir);
    const write = filePaths.atomicWrite;
    const fault = vi.spyOn(filePaths, 'atomicWrite').mockImplementation(async (...args) => {
      if (args[1] === 'Bravo.dek') throw new Error('Injected disk write failure');
      return write(...args);
    });
    const result = await decks.deploy(plan.token);
    fault.mockRestore();
    expect(result).toMatchObject({
      deployed: 1,
      completed: ['Alpha.dek'],
      failed: [{ name: 'Bravo.dek', message: 'Injected disk write failure' }],
      skipped: ['Charlie.dek'],
    });
    expect(await readFile(join(decksDir, 'Alpha.dek'), 'utf8')).toBe('backup Alpha.dek');
    expect(await readFile(join(decksDir, 'Bravo.dek'), 'utf8')).toBe('original Bravo.dek');
    expect(await readFile(join(decksDir, 'Charlie.dek'), 'utf8')).toBe('original Charlie.dek');
    const recovery = await zipExtract(
      await readFile(join(root, 'DeckBackups', result.recoveryBackup!)),
    );
    expect(recovery.map((entry) => entry.data.toString())).toEqual([
      'original Alpha.dek',
      'original Bravo.dek',
      'original Charlie.dek',
    ]);
    await decks.deploy((await decks.planRestore(result.recoveryBackup!, decksDir)).token);
    expect(await readFile(join(decksDir, 'Alpha.dek'), 'utf8')).toBe('original Alpha.dek');
  });

  it('rejects a backup version changed after confirmation was prepared', async () => {
    const { root, decksDir, decks } = await fixture();
    await writeFile(join(decksDir, 'Alpha.dek'), 'backup');
    await decks.backup(['Alpha.dek'], 'snapshot');
    const plan = await decks.planRestore('snapshot.zip', decksDir);
    await writeFile(
      join(root, 'DeckBackups', 'snapshot.zip'),
      await zipCreate([{ name: 'Alpha.dek', data: Buffer.from('changed backup') }]),
    );
    await expect(decks.deploy(plan.token)).rejects.toThrow('DECK_RESTORE_CHANGED');
    expect(await readFile(join(decksDir, 'Alpha.dek'), 'utf8')).toBe('backup');
  });

  it('rejects current decks changed after confirmation was prepared', async () => {
    const { decksDir, decks } = await fixture();
    await writeFile(join(decksDir, 'Alpha.dek'), 'backup');
    await decks.backup(['Alpha.dek'], 'snapshot');
    const plan = await decks.planRestore('snapshot.zip', decksDir);
    await writeFile(join(decksDir, 'Alpha.dek'), 'changed after review');
    await expect(decks.deploy(plan.token)).rejects.toThrow('DECK_RESTORE_CHANGED');
    expect(await readFile(join(decksDir, 'Alpha.dek'), 'utf8')).toBe('changed after review');
  });

  it('rejects restore execution after a directory switch', async () => {
    const { root, decksDir, db, decks } = await fixture();
    await writeFile(join(decksDir, 'Alpha.dek'), 'backup');
    await decks.backup(['Alpha.dek'], 'snapshot');
    const plan = await decks.planRestore('snapshot.zip', decksDir);
    const other = join(root, 'OtherDecks');
    await mkdir(other);
    await writeFile(join(other, 'Alpha.dek'), 'other');
    db.updateConfig({ decksDir: other });
    await expect(decks.deploy(plan.token)).rejects.toThrow('DECK_DIRECTORY_CHANGED');
    expect(await readFile(join(other, 'Alpha.dek'), 'utf8')).toBe('other');
  });

  it('binds automatic backup contents and account ownership to the directory enumerated before a configuration change', async () => {
    const { root, decksDir, db, decks } = await fixture();
    const other = join(root, 'Other', 'Decks');
    await mkdir(other, { recursive: true });
    await writeFile(join(decksDir, 'Shared.dek'), 'source A');
    await writeFile(join(other, 'Shared.dek'), 'source B');
    const paths = decks.paths.bind(decks);
    vi.spyOn(decks, 'paths').mockImplementationOnce(async () => {
      const captured = await paths();
      db.updateConfig({ decksDir: other });
      return captured;
    });
    const owner = new LogParser(() => {}).snapshot();
    owner.accountKey = 'persona:Alpha';
    owner.localName = 'Alpha';
    owner.loginSeen = true;
    await decks.onMatchStart(owner);
    const entries = await zipExtract(await readFile(join(root, 'DeckBackups', '上一局卡组包.zip')));
    expect(entries[0]?.data.toString()).toBe('source A');
    expect(db.state('deckSync', {})).toMatchObject({
      pkgKey: 'persona:Alpha',
      directory: decksDir,
    });
    const next = { ...owner, accountKey: 'persona:Bravo', localName: 'Bravo' };
    expect(await decks.switchAlert(next)).toBeNull();
    db.updateConfig({ decksDir });
    const alert = await decks.switchAlert(next);
    expect(alert).toMatchObject({ from: 'Alpha', directory: decksDir, toKey: 'persona:Bravo' });
    expect(decks.isCurrentAlert(alert!)).toBe(true);
    await writeFile(join(decksDir, 'Shared.dek'), 'next match');
    await decks.onMatchStart(next);
    expect(decks.isCurrentAlert(alert!)).toBe(false);
    await expect(decks.planRestore('上一局卡组包.zip', decksDir, alert!.version)).rejects.toThrow(
      'DECK_RESTORE_CHANGED',
    );
  });
  it('serializes notice generation with automatic backup ownership updates', async () => {
    const { decksDir, db, decks } = await fixture();
    await writeFile(join(decksDir, 'Alpha.dek'), 'first match');
    const owner = new LogParser(() => {}).snapshot();
    Object.assign(owner, { accountKey: 'persona:Alpha', localName: 'Alpha', loginSeen: true });
    await decks.onMatchStart(owner);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paths = decks.paths.bind(decks);
    const calls = vi.spyOn(decks, 'paths').mockImplementationOnce(async () => {
      entered();
      await gate;
      return paths();
    });
    const next = { ...owner, accountKey: 'persona:Bravo', localName: 'Bravo' };
    const notice = decks.switchAlert(next);
    await started;
    await writeFile(join(decksDir, 'Alpha.dek'), 'second match');
    const backup = decks.onMatchStart(next);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const callsBeforeRelease = calls.mock.calls.length;
    release();
    const alert = await notice;
    await backup;
    expect(callsBeforeRelease).toBe(1);
    expect(db.state('deckSync', {})).toMatchObject({ pkgKey: 'persona:Bravo', pkgName: 'Bravo' });
    expect(decks.isCurrentAlert(alert!)).toBe(false);
  });
});

describe('file path boundaries', () => {
  it.each([
    '..',
    '../x.dek',
    '..\\x.dek',
    '/x.dek',
    'C:\\x.dek',
    'CON.dek',
    'aux.DEK',
    'LPT1.dek',
    'x.dek ',
    'x.dek.',
    'file.txt',
  ])('rejects %s as a deck file', (value) => {
    expect(() => filename(value, '.dek')).toThrow();
    expect(() => childPath(testRoot, value, '.dek')).toThrow();
  });

  it('accepts a normal UTF-8 basename in its intended directory', () => {
    const path = childPath(testRoot, '前线.Dek', '.dek');
    expect(path).toBe(join(testRoot, '前线.Dek'));
  });
});

describe('local recordings', () => {
  async function recordingFixture() {
    const root = await temp();
    const db = database();
    db.updateConfig({ replaySaveDir: root });
    return { root, db, files: new ReplayFiles(db, root) };
  }

  it('uses the generated recording timestamp and explicitly labels legacy modification dates', async () => {
    const { root, files } = await recordingFixture();
    const now = Date.now();
    const recent = replayName(
      { fid: null, id: '1', name: 'Recent', teamId: 0, mapId: 7 },
      now - 2 * 86400000,
    );
    const old = replayName(
      { fid: null, id: '2', name: 'Old', teamId: 1, mapId: 7 },
      now - 90 * 86400000,
    );
    await writeFile(join(root, recent), 'recent recording');
    await writeFile(join(root, old), 'old recording');
    await writeFile(join(root, 'legacy.webm'), 'legacy');
    await utimes(join(root, recent), new Date(now), new Date(now - 60 * 86400000));
    await utimes(join(root, old), new Date(now), new Date(now - 86400000));
    await utimes(join(root, 'legacy.webm'), new Date(now), new Date(now - 50 * 86400000));
    const library = await files.library();
    expect(library.directory).toBe(root);
    expect(library.recordings.find((recording) => recording.id === recent)).toMatchObject({
      createdAt: now - 2 * 86400000,
      dateSource: 'recording',
    });
    expect(library.recordings.find((recording) => recording.id === 'legacy.webm')).toMatchObject({
      createdAt: now - 50 * 86400000,
      dateSource: 'modified',
    });
    const plan = await files.planClean(root, 30);
    expect(plan.recordings.map((recording) => recording.id).sort()).toEqual(
      [old, 'legacy.webm'].sort(),
    );
    const result = await files.executeDelete(plan.token, 'clean');
    expect(result).toMatchObject({ removed: 2, failed: [], skipped: [] });
    expect(await readdir(root)).toEqual([recent]);
  });

  it('keeps the confirmed cutoff and excludes recordings added while confirmation is open', async () => {
    const { root, files } = await recordingFixture();
    let now = 1793200000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const old = replayName(
      { fid: null, id: '1', name: 'Old', teamId: 0, mapId: 7 },
      now - 35 * 86400000,
    );
    const boundary = replayName(
      { fid: null, id: '2', name: 'Boundary', teamId: 0, mapId: 7 },
      now - 30 * 86400000 + 20000,
    );
    await writeFile(join(root, old), 'delete');
    await writeFile(join(root, boundary), 'keep at reviewed cutoff');
    const plan = await files.planClean(root, 30);
    expect(plan.recordings.map((recording) => recording.id)).toEqual([old]);
    now += 60000;
    const added = replayName(
      { fid: null, id: '3', name: 'Added', teamId: 0, mapId: 7 },
      now - 60 * 86400000,
    );
    await writeFile(join(root, added), 'added after review');
    await files.executeDelete(plan.token, 'clean');
    expect(await readdir(root)).toEqual(expect.arrayContaining([boundary, added]));
    await expect(lstat(join(root, old))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not let two overlapping reviewed cleanups delete a newly completed recording', async () => {
    const { root, files } = await recordingFixture();
    await writeFile(join(root, 'Alpha.webm'), 'original');
    const first = await files.planClean(root, 0);
    const second = await files.planClean(root, 0);
    await files.executeDelete(first.token, 'clean');
    await writeFile(join(root, 'Bravo.webm'), 'new recording');
    expect(await files.executeDelete(second.token, 'clean')).toMatchObject({
      removed: 0,
      completed: [],
      failed: [],
      skipped: ['Alpha.webm'],
    });
    expect(await readFile(join(root, 'Bravo.webm'), 'utf8')).toBe('new recording');
    await expect(files.executeDelete(second.token, 'clean')).rejects.toThrow(
      'REPLAY_DELETE_EXPIRED',
    );
  });

  it('rejects a directory change before executing either single or bulk deletion', async () => {
    const { root, db, files } = await recordingFixture();
    const other = join(root, 'Other');
    await mkdir(other);
    await writeFile(join(root, 'Shared.webm'), 'directory A');
    await writeFile(join(other, 'Shared.webm'), 'directory B');
    const single = await files.planDelete(root, ['Shared.webm']);
    const bulk = await files.planClean(root, 0);
    db.updateConfig({ replaySaveDir: other });
    await expect(files.executeDelete(single.token, 'delete')).rejects.toThrow(
      'REPLAY_DIRECTORY_CHANGED',
    );
    await expect(files.executeDelete(bulk.token, 'clean')).rejects.toThrow(
      'REPLAY_DIRECTORY_CHANGED',
    );
    expect(await readFile(join(root, 'Shared.webm'), 'utf8')).toBe('directory A');
    expect(await readFile(join(other, 'Shared.webm'), 'utf8')).toBe('directory B');
  });

  it('keeps executing against the reviewed directory if configuration changes during deletion', async () => {
    const { root, db, files } = await recordingFixture();
    const other = join(root, 'Other');
    await mkdir(other);
    for (const name of ['Alpha.webm', 'Bravo.webm']) {
      await writeFile(join(root, name), 'A ' + name);
      await writeFile(join(other, name), 'B ' + name);
    }
    const plan = await files.planClean(root, 0);
    const path = files.path.bind(files);
    vi.spyOn(files, 'path').mockImplementationOnce(async (name, directory) => {
      const result = await path(name, directory);
      db.updateConfig({ replaySaveDir: other });
      return result;
    });
    const result = await files.executeDelete(plan.token, 'clean');
    expect(result).toMatchObject({ directory: root, removed: 2, failed: [] });
    expect(await readdir(other)).toEqual(['Alpha.webm', 'Bravo.webm']);
    expect((await readdir(root)).filter((name) => name.endsWith('.webm'))).toEqual([]);
  });

  it('preserves a different file that replaces a reviewed recording at the same name', async () => {
    const { root, db, files } = await recordingFixture();
    await writeFile(join(root, 'Shared.webm'), 'reviewed');
    db.setState('replay:Shared.webm', { duration: 66 });
    const plan = await files.planDelete(root, ['Shared.webm']);
    await rename(join(root, 'Shared.webm'), join(root, 'preserved-original'));
    await writeFile(join(root, 'Shared.webm'), 'replacement must remain');
    const result = await files.executeDelete(plan.token, 'delete');
    expect(result).toMatchObject({
      removed: 0,
      completed: [],
      failed: [{ name: 'Shared.webm', message: 'REPLAY_TARGET_CHANGED' }],
    });
    expect(await readFile(join(root, 'Shared.webm'), 'utf8')).toBe('replacement must remain');
    expect(db.state('replay:Shared.webm', null)).toEqual({ duration: 66 });
  });

  it('preserves a file on metadata failure and reports the other deletions accurately', async () => {
    const { root, db, files } = await recordingFixture();
    for (const name of ['Alpha.webm', 'Bravo.webm', 'Charlie.webm']) {
      await writeFile(join(root, name), name);
      db.setState('replay:' + name, { duration: 66 });
    }
    db.sql.exec(
      "CREATE TRIGGER block_recording_metadata BEFORE DELETE ON app_state WHEN OLD.key = 'replay:Bravo.webm' BEGIN SELECT RAISE(FAIL, 'metadata blocked'); END",
    );
    const result = await files.executeDelete((await files.planClean(root, 0)).token, 'clean');
    expect(result.removed).toBe(2);
    expect(result.completed.sort()).toEqual(['Alpha.webm', 'Charlie.webm']);
    expect(result.failed).toEqual([
      { name: 'Bravo.webm', message: 'REPLAY_METADATA_DELETE_FAILED' },
    ]);
    expect(await readdir(root)).toEqual(['Bravo.webm']);
    expect(db.state('replay:Bravo.webm', null)).toEqual({ duration: 66 });
    db.sql.exec('DROP TRIGGER block_recording_metadata');
    await files.executeDelete((await files.planClean(root, 0)).token, 'clean');
    expect(db.state('replay:Bravo.webm', null)).toBeNull();
    await writeFile(join(root, 'Bravo.webm'), 'different file');
    expect((await files.list())[0]?.durationSec).toBeNull();
  });

  it('restores metadata if the file cannot be unlinked after validation', async () => {
    const { root, db, files } = await recordingFixture();
    await writeFile(join(root, 'Alpha.webm'), 'protected');
    db.setState('replay:Alpha.webm', { duration: 66 });
    const plan = await files.planDelete(root, ['Alpha.webm']);
    const path = files.path.bind(files);
    vi.spyOn(files, 'path').mockImplementationOnce(async (name, directory) => {
      const result = await path(name, directory);
      await rename(result, join(root, 'preserved-original'));
      await mkdir(result);
      return result;
    });
    const result = await files.executeDelete(plan.token, 'delete');
    expect(result.failed).toEqual([{ name: 'Alpha.webm', message: 'REPLAY_FILE_DELETE_FAILED' }]);
    expect(await readFile(join(root, 'preserved-original'), 'utf8')).toBe('protected');
    expect(db.state('replay:Alpha.webm', null)).toEqual({ duration: 66 });
  });

  it('hides unfinished recording files and preserves encoded player metadata', async () => {
    const root = await temp(),
      db = database();
    db.updateConfig({ replaySaveDir: root });
    const files = new ReplayFiles(db, root);
    const name = replayName(
      { fid: '123', id: '8863', name: '王', teamId: null, mapId: 7 },
      1_700_000_000_000,
    );
    await Promise.all([
      writeFile(join(root, name), 'visible'),
      writeFile(join(root, '.rec-part-' + randomUUID() + '.webm'), 'partial'),
      writeFile(join(root, '.rec-final-' + randomUUID() + '.webm'), 'partial'),
      writeFile(join(root, 'readme.txt'), 'notes'),
    ]);
    const list = await files.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: name,
      fid: '123',
      uploaderId: '8863',
      uploaderName: '王',
      teamId: null,
      map: 'Dam',
      size: 7,
    });
    expect(await files.path(name)).toBe(join(root, name));
  });

  it('refuses a symbolic link and leaves its target untouched', async () => {
    const root = await temp(),
      db = database();
    const target = join(root, 'target.webm'),
      link = join(root, 'link.webm');
    await writeFile(target, 'protected target');
    try {
      await symlink(target, link, 'file');
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        !['EPERM', 'EACCES'].includes(String((error as NodeJS.ErrnoException).code))
      )
        throw error;
      // Windows without file-symlink privileges still supports directory junctions.
      const directory = join(root, 'linked-directory');
      await mkdir(directory);
      await symlink(directory, link, 'junction');
    }
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    db.updateConfig({ replaySaveDir: root });
    const files = new ReplayFiles(db, root);
    await expect(files.path('link.webm')).rejects.toThrow(/local recording/i);
    await expect(files.planDelete(root, ['link.webm'])).rejects.toThrow('REPLAY_TARGET_CHANGED');
    expect((await files.list()).map((item) => item.id)).toEqual(['target.webm']);
    expect(await readFile(target, 'utf8')).toBe('protected target');
  });

  it('keeps the complete original library when a destination collision prevents migration', async () => {
    const root = await temp(),
      from = join(root, 'from'),
      to = join(root, 'to');
    await Promise.all([mkdir(from), mkdir(to)]);
    await Promise.all([
      writeFile(join(from, 'conflict.webm'), 'source'),
      writeFile(join(to, 'conflict.webm'), 'destination'),
      writeFile(join(from, 'good.webm'), 'good recording'),
      writeFile(join(from, '.rec-part-fixture.webm'), 'unfinished'),
      writeFile(join(from, 'notes.txt'), 'notes'),
    ]);
    const db = database();
    db.updateConfig({ replaySaveDir: from });
    const files = new ReplayFiles(db, root);
    expect(await files.move(from, to)).toMatchObject({
      committed: false,
      moved: 0,
      retained: ['conflict.webm', 'good.webm'],
      failed: [{ name: 'conflict.webm', message: 'REPLAY_MIGRATION_COLLISION' }],
    });
    expect(await readFile(join(from, 'conflict.webm'), 'utf8')).toBe('source');
    expect(await readFile(join(to, 'conflict.webm'), 'utf8')).toBe('destination');
    expect(await readFile(join(from, 'good.webm'), 'utf8')).toBe('good recording');
    expect(await readdir(to)).toEqual(['conflict.webm']);
    expect(await readdir(from)).toEqual(
      expect.arrayContaining(['conflict.webm', '.rec-part-fixture.webm', 'notes.txt']),
    );
    expect(await files.move(from, from)).toMatchObject({ committed: true, moved: 0, failed: [] });
  });
});
