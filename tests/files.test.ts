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
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { filename } from '@ba/shared';
import { Database } from '../apps/server/src/storage/database';
import { ReplayFiles, replayName } from '../apps/server/src/replays/files';
import { childPath } from '../apps/server/src/files/paths';
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
    await expect(files.remove('link.webm')).rejects.toThrow(/local recording/i);
    expect((await files.list()).map((item) => item.id)).toEqual(['target.webm']);
    expect(await readFile(target, 'utf8')).toBe('protected target');
  });

  it('moves completed recordings without overwriting collisions or moving temporary files', async () => {
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
    const files = new ReplayFiles(database(), root);
    expect(await files.move(from, to)).toEqual({ moved: 1, failed: ['conflict.webm'] });
    expect(await readFile(join(from, 'conflict.webm'), 'utf8')).toBe('source');
    expect(await readFile(join(to, 'conflict.webm'), 'utf8')).toBe('destination');
    expect(await readFile(join(to, 'good.webm'), 'utf8')).toBe('good recording');
    expect(await readdir(from)).toEqual(
      expect.arrayContaining(['conflict.webm', '.rec-part-fixture.webm', 'notes.txt']),
    );
    expect(await files.move(to, to)).toEqual({ moved: 0, failed: [] });
  });
});
