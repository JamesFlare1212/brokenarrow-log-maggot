import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  link,
  writeFile,
} from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecordingState } from '@ba/contracts';
import { Database } from '../apps/server/src/storage/database';
import { Application } from '../apps/server/src/app';
import { ReplayFiles } from '../apps/server/src/replays/files';
import * as migration from '../apps/server/src/replays/migration';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, link: vi.fn(actual.link), unlink: vi.fn(actual.unlink) };
});
const root = resolve('.test-data/recording-migration');
const directories: string[] = [],
  databases: Database[] = [],
  applications: Application[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(link).mockImplementation(actual.link);
  vi.mocked(unlink).mockImplementation(actual.unlink);
  for (const application of applications.splice(0)) await application.stop();
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    const child = relative(root, resolve(directory));
    if (!child || child.startsWith('..' + sep) || child === '..' || isAbsolute(child))
      throw new Error('Unsafe fixture cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  directories.push(directory);
  const from = join(directory, 'A'),
    to = join(directory, 'B'),
    other = join(directory, 'C');
  await Promise.all([mkdir(from), mkdir(to), mkdir(other)]);
  await writeFile(join(from, 'Alpha.webm'), 'alpha video');
  await writeFile(join(from, 'Bravo.webm'), 'bravo video');
  await writeFile(join(from, '.rec-part-fixture.webm'), 'unfinished');
  const db = new Database(join(directory, 'fixture.sqlite'));
  databases.push(db);
  db.updateConfig({ replaySaveDir: from });
  return { directory, from, to, other, db, files: new ReplayFiles(db, directory) };
}
async function originalLibrary(from: string) {
  expect(await readFile(join(from, 'Alpha.webm'), 'utf8')).toBe('alpha video');
  expect(await readFile(join(from, 'Bravo.webm'), 'utf8')).toBe('bravo video');
}

describe('recoverable recording migration', () => {
  it('preserves every byte across multiple streamed write chunks', async () => {
    const { from, to, files } = await fixture();
    const contents = Buffer.alloc(2 * 1024 * 1024 + 77);
    for (let index = 0; index < contents.length; index++)
      contents[index] = (index * 31 + Math.floor(index / 251)) % 251;
    await writeFile(join(from, 'Alpha.webm'), contents);
    expect((await files.move(from, to)).committed).toBe(true);
    expect(await readFile(join(to, 'Alpha.webm'))).toEqual(contents);
  });

  it('copies and verifies the complete library before selecting it or removing any original', async () => {
    const { from, to, db, files } = await fixture();
    const update = db.updateConfig.bind(db);
    vi.spyOn(db, 'updateConfig').mockImplementation((patch) => {
      expect(readFileSync(join(from, 'Alpha.webm'), 'utf8')).toBe('alpha video');
      expect(readFileSync(join(from, 'Bravo.webm'), 'utf8')).toBe('bravo video');
      expect(readFileSync(join(to, 'Alpha.webm'), 'utf8')).toBe('alpha video');
      expect(readFileSync(join(to, 'Bravo.webm'), 'utf8')).toBe('bravo video');
      expect(db.config().replaySaveDir).toBe(from);
      return update(patch);
    });
    const result = await files.move(from, to);
    expect(result).toMatchObject({
      committed: true,
      moved: 2,
      copied: ['Alpha.webm', 'Bravo.webm'],
      retained: [],
      failed: [],
    });
    expect(db.config().replaySaveDir).toBe(to);
    await originalLibrary(to);
    expect(await readdir(from)).toEqual(['.rec-part-fixture.webm']);
    expect(await readdir(to)).toEqual(['Alpha.webm', 'Bravo.webm']);
    expect((await files.library()).migration).toEqual(result);
  });

  it('retains every original after a later copy fails and can migrate all of them to another folder', async () => {
    const { from, to, other, db, files } = await fixture();
    const copy = migration.copyVerifiedRecording;
    vi.spyOn(migration, 'copyVerifiedRecording').mockImplementation(async (source, destination) => {
      if (source.endsWith('Bravo.webm')) {
        await writeFile(destination, 'partial copy');
        throw new Error('Controlled copy failure');
      }
      return copy(source, destination);
    });
    const result = await files.move(from, to);
    expect(result).toMatchObject({
      committed: false,
      moved: 0,
      retained: ['Alpha.webm', 'Bravo.webm'],
      failed: [{ name: 'Bravo.webm', message: 'Controlled copy failure' }],
    });
    await originalLibrary(from);
    expect(db.config().replaySaveDir).toBe(from);
    expect(await readdir(to)).toEqual([]);
    vi.restoreAllMocks();
    expect((await files.move(from, other)).committed).toBe(true);
    await originalLibrary(other);
  });

  it('rolls back already published copies when a later publication fails', async () => {
    const { from, to, files } = await fixture();
    const publish = migration.publishRecording;
    vi.spyOn(migration, 'publishRecording').mockImplementation(async (source, destination) => {
      if (destination.endsWith('Bravo.webm')) throw new Error('Controlled publication failure');
      await publish(source, destination);
    });
    const result = await files.move(from, to);
    expect(result).toMatchObject({ committed: false, destinationCopies: [], moved: 0 });
    await originalLibrary(from);
    expect(await readdir(to)).toEqual([]);
  });

  it('never replaces a destination file created after preflight', async () => {
    const { from, to, files } = await fixture();
    const publish = migration.publishRecording;
    vi.spyOn(migration, 'publishRecording').mockImplementation(async (source, destination) => {
      if (destination.endsWith('Bravo.webm')) await writeFile(destination, 'external file');
      await publish(source, destination);
    });
    expect((await files.move(from, to)).committed).toBe(false);
    await originalLibrary(from);
    expect(await readdir(to)).toEqual(['Bravo.webm']);
    expect(await readFile(join(to, 'Bravo.webm'), 'utf8')).toBe('external file');
  });

  it('detects equal-size destination corruption before switching the library', async () => {
    const { from, to, files } = await fixture();
    const publish = migration.publishRecording;
    vi.spyOn(migration, 'publishRecording').mockImplementation(async (source, destination) => {
      await publish(source, destination);
      if (destination.endsWith('Alpha.webm')) await writeFile(destination, 'wrong video');
    });
    const result = await files.move(from, to);
    expect(result.failed).toContainEqual({
      name: 'Alpha.webm',
      message: 'REPLAY_MIGRATION_COPY_MISMATCH',
    });
    expect(result.committed).toBe(false);
    await originalLibrary(from);
    expect(await readdir(to)).toEqual([]);
  });

  it('preserves an externally replaced published target and reports its remaining location', async () => {
    const { from, to, files } = await fixture();
    const publish = migration.publishRecording;
    vi.spyOn(migration, 'publishRecording').mockImplementation(async (source, destination) => {
      if (destination.endsWith('Bravo.webm')) {
        await writeFile(join(to, 'replacement.tmp'), 'external replacement');
        await rename(join(to, 'replacement.tmp'), join(to, 'Alpha.webm'));
        throw new Error('Controlled later failure');
      }
      await publish(source, destination);
    });
    const result = await files.move(from, to);
    expect(result).toMatchObject({ committed: false, destinationCopies: ['Alpha.webm'] });
    await originalLibrary(from);
    expect(await readFile(join(to, 'Alpha.webm'), 'utf8')).toBe('external replacement');
  });

  it('rejects a configured-folder change while copying without removing source files', async () => {
    const { from, to, other, db, files } = await fixture();
    const copy = migration.copyVerifiedRecording;
    vi.spyOn(migration, 'copyVerifiedRecording').mockImplementation(async (source, destination) => {
      const hash = await copy(source, destination);
      db.updateConfig({ replaySaveDir: other });
      return hash;
    });
    expect(await files.move(from, to)).toMatchObject({
      committed: false,
      directory: other,
      failed: [{ name: '', message: 'REPLAY_DIRECTORY_CHANGED' }],
    });
    await originalLibrary(from);
    expect(await readdir(to)).toEqual([]);
  });

  it('rolls back destination copies when committing the configured folder fails', async () => {
    const { from, to, db, files } = await fixture();
    vi.spyOn(db, 'updateConfig').mockImplementation(() => {
      throw new Error('Controlled SQLite failure');
    });
    expect(await files.move(from, to)).toMatchObject({
      committed: false,
      directory: from,
      moved: 0,
    });
    await originalLibrary(from);
    expect(db.config().replaySaveDir).toBe(from);
    expect(await readdir(to)).toEqual([]);
  });

  it('keeps the complete selected destination and reports source cleanup failures across restart', async () => {
    const { directory, from, to, db, files } = await fixture();
    const remove = vi.mocked(unlink).getMockImplementation()!;
    vi.mocked(unlink).mockImplementation(async (file) => {
      if (String(file) === join(from, 'Alpha.webm'))
        throw Object.assign(new Error('Controlled access denial'), { code: 'EACCES' });
      return remove(file);
    });
    const result = await files.move(from, to);
    expect(result).toMatchObject({
      committed: true,
      moved: 1,
      copied: ['Alpha.webm', 'Bravo.webm'],
      retained: ['Alpha.webm'],
      failed: [{ name: 'Alpha.webm', message: 'Controlled access denial' }],
    });
    await originalLibrary(to);
    expect(await readFile(join(from, 'Alpha.webm'), 'utf8')).toBe('alpha video');
    databases.splice(databases.indexOf(db), 1);
    db.close();
    const reopened = new Database(join(directory, 'fixture.sqlite'));
    databases.push(reopened);
    const library = await new ReplayFiles(reopened, directory).library();
    expect(library.directory).toBe(to);
    expect(library.recordings.map((recording) => recording.id).sort()).toEqual([
      'Alpha.webm',
      'Bravo.webm',
    ]);
    expect(library.migration).toEqual(result);
  });

  it('supports a destination filesystem without hard links using an exclusive verified copy', async () => {
    const { from, to, files } = await fixture();
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error('No hard links'), { code: 'ENOTSUP' }),
    );
    expect((await files.move(from, to)).committed).toBe(true);
    await originalLibrary(to);
  });

  it('does not delete an original changed after cutover', async () => {
    const { from, to, db, files } = await fixture();
    const update = db.updateConfig.bind(db);
    vi.spyOn(db, 'updateConfig').mockImplementation((patch) => {
      writeFileSync(join(from, 'Alpha.webm'), 'new external content');
      return update(patch);
    });
    expect(await files.move(from, to)).toMatchObject({
      committed: true,
      moved: 1,
      retained: ['Alpha.webm'],
      failed: [{ name: 'Alpha.webm', message: 'REPLAY_TARGET_CHANGED' }],
    });
    await originalLibrary(to);
    expect(await readFile(join(from, 'Alpha.webm'), 'utf8')).toBe('new external content');
  });
});

describe('recording migration application coordination', () => {
  async function applicationFixture() {
    const fixtureData = await fixture();
    const recording: RecordingState = {
      phase: 'idle',
      sessionId: null,
      fid: null,
      map: '',
      sourceId: '',
      startedAt: null,
      seconds: 0,
      hasAudio: false,
      error: null,
    };
    const application = new Application(
      join(fixtureData.directory, 'application'),
      {
        version: 'migration-test',
        http: {
          offline: true,
          fetch: async () => {
            throw new Error('Offline fixture');
          },
        },
        selectDirectory: async () => null,
        detectLogDirectory: async () => '',
        openPath: async () => {},
        openExternal: async () => {},
        notify: () => {},
        recordings: {
          status: () => recording,
          start: async () => {},
          stop: async () => {},
          abort: async () => {},
          displays: async () => [],
          thumbnail: async () => null,
          displayPreview: async (id) => ({
            requestedId: id,
            sourceId: null,
            label: null,
            selection: 'unavailable',
            thumbnail: null,
            displays: [],
          }),
          playback: async () => '',
        },
      },
      () => {},
      false,
    );
    applications.push(application);
    application.db.updateConfig({ replaySaveDir: fixtureData.from });
    return { ...fixtureData, application, recording };
  }
  it.each(['starting', 'recording', 'stopping'] as const)(
    'rejects migration during %s before touching files',
    async (phase) => {
      const { application, recording, from, to } = await applicationFixture();
      recording.phase = phase;
      await expect(application.invoke('replays.move', { from, to })).rejects.toThrow(
        'REPLAY_MIGRATION_RECORDING_ACTIVE',
      );
      await originalLibrary(from);
      expect(await readdir(to)).toEqual([]);
    },
  );
  it('aborts a migration if capture starts before cutover', async () => {
    const { application, recording, from, to } = await applicationFixture();
    const copy = migration.copyVerifiedRecording;
    vi.spyOn(migration, 'copyVerifiedRecording').mockImplementation(async (source, destination) => {
      const hash = await copy(source, destination);
      recording.phase = 'recording';
      return hash;
    });
    expect(await application.invoke('replays.move', { from, to })).toMatchObject({
      committed: false,
      moved: 0,
      failed: [{ name: '', message: 'REPLAY_MIGRATION_RECORDING_ACTIVE' }],
    });
    await originalLibrary(from);
    expect(application.db.config().replaySaveDir).toBe(from);
    expect(await readdir(to)).toEqual([]);
  });
  it('rejects overlapping directory changes and lets shutdown await the in-flight migration', async () => {
    const { application, from, to, other } = await applicationFixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const copy = migration.copyVerifiedRecording;
    vi.spyOn(migration, 'copyVerifiedRecording').mockImplementation(async (source, destination) => {
      started();
      await held;
      return copy(source, destination);
    });
    const pending = application.invoke('replays.move', { from, to });
    await entered;
    await expect(application.invoke('config.update', { replaySaveDir: other })).rejects.toThrow(
      'REPLAY_MIGRATION_BUSY',
    );
    await expect(application.invoke('replays.move', { from, to: other })).rejects.toThrow(
      'REPLAY_MIGRATION_BUSY',
    );
    const stop = application.stop();
    release();
    expect((await pending).committed).toBe(true);
    await stop;
    await originalLibrary(to);
  });
});
