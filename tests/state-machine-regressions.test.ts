// Regression scenarios from docs/state-machine-risk-audit.md.
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema, type AppEvent, type RecordingState, type Session } from '@ba/contracts';
import { emptyMatch } from '@ba/shared';
import type { Platform } from '../apps/server/src/ports';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, unlink: vi.fn(actual.unlink), rename: vi.fn(actual.rename) };
});

const electron = vi.hoisted(() => {
  let id = 0;
  const windows: FakeWindow[] = [];
  class FakeWindow {
    destroyed = false;
    webContents = { id: ++id, on: vi.fn(), send: vi.fn(), setWindowOpenHandler: vi.fn() };
    constructor(_options: unknown) {
      windows.push(this);
    }
    async loadFile(_path: string) {}
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { windows, FakeWindow };
});
vi.mock('electron', () => ({
  BrowserWindow: electron.FakeWindow,
  desktopCapturer: {
    getSources: async () => [{ id: 'screen:1:0', display_id: '1' }],
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1 }),
  },
}));

import { RecordingController } from '../apps/desktop/src/recordings/controller';
import { Application } from '../apps/server/src/app';
import { Database } from '../apps/server/src/storage/database';
import { DeckService } from '../apps/server/src/decks/service';
import { zipCreate } from '../apps/server/src/decks/zip';
import { ReplayFiles } from '../apps/server/src/replays/files';
import { LogParser } from '../apps/server/src/logs/parser';
import { LogWatcher } from '../apps/server/src/logs/watcher';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const workspace = resolve(process.cwd());
const testRoot = resolve(workspace, '.test-data/state-machine-risks');
const directories: string[] = [];
const cleanups: Array<() => void | Promise<void>> = [];
const releases: Array<() => void> = [];
function assertChild(root: string, target: string) {
  const child = relative(root, target);
  if (!child || isAbsolute(child) || child === '..' || child.startsWith('..' + sep))
    throw new Error('Audit cleanup escaped its test root');
}
async function directory() {
  await mkdir(testRoot, { recursive: true });
  const path = await mkdtemp(join(testRoot, 'audit-'));
  directories.push(path);
  return path;
}
function database() {
  const db = new Database(':memory:');
  cleanups.push(() => db.close());
  return db;
}
function platform(): Platform {
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
  return {
    version: '4.5.9',
    http: { fetch: vi.fn() },
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
      playback: async () => '',
    },
  };
}
async function application(p = platform(), events: AppEvent[] = []) {
  const dir = await directory();
  const app = new Application(dir, p, (event) => events.push(event), false);
  app.db.updateConfig({ decksDir: join(dir, 'Decks') });
  cleanups.push(async () => {
    try {
      await app.stop();
    } catch {
      if (app.db.sql.isOpen) app.db.close();
    }
  });
  return app;
}
function match(fid: string) {
  return { ...emptyMatch(fid), fid, sessionId: `session-${fid}` };
}
async function recording() {
  const dir = await directory();
  const saved = vi.fn();
  const value = new RecordingController('preload', 'page', () => dir, vi.fn(), saved, vi.fn());
  cleanups.push(() => value.abort());
  await value.start(match('123'), configSchema.parse({}));
  const sender = electron.windows.at(-1)!.webContents.id;
  const token = value.config(sender).sessionId;
  value.ready(sender, token, false, 'av1');
  await value.chunk(sender, token, 0, new TextEncoder().encode('capture').buffer);
  return { value, saved, sender, token, dir };
}
async function deckFixture() {
  const root = await directory();
  const decks = join(root, 'Decks'),
    backups = join(root, 'DeckBackups');
  await mkdir(decks);
  await mkdir(backups);
  await writeFile(
    join(backups, '上一局卡组包.zip'),
    await zipCreate([{ name: 'fixture.dek', data: Buffer.from('deck') }]),
  );
  const db = database();
  db.updateConfig({ decksDir: decks });
  db.setState('deckSync', {
    pkgKey: 'persona:Alice',
    pkgName: 'Alice',
    pkgFid: '123',
    pkgUpdatedAt: 1,
    alertedPairs: [],
  });
  const session: Session = {
    ...new LogParser(() => {}).snapshot(),
    loginSeen: true,
    localName: 'Bob',
    accountKey: 'persona:Bob',
  };
  return { db, service: new DeckService(db), session, decks, backups };
}
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(unlink).mockReset().mockImplementation(actual.unlink);
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  electron.windows.length = 0;
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  const root = await realpath(testRoot);
  assertChild(await realpath(workspace), root);
  for (const path of directories.splice(0)) {
    const target = await realpath(path);
    assertChild(root, target);
    await rm(target, { recursive: true, force: true });
  }
});

describe('state-machine ownership regressions', () => {
  it('SM-01: failure cleanup cannot overwrite a replacement recording', async () => {
    const { value, sender, token } = await recording();
    const gate = deferred<void>(),
      entered = deferred<void>();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    releases.push(() => gate.resolve());
    vi.mocked(unlink).mockImplementationOnce(async (path) => {
      entered.resolve();
      await gate.promise;
      await actual.unlink(path);
    });
    const failing = value.failure(sender, token, 'Old encoder failure');
    await entered.promise;
    await value.start(match('456'), configSchema.parse({}));
    const replacement = value.status().sessionId;
    gate.resolve();
    await failing;
    expect(value.status()).toMatchObject({ phase: 'starting', fid: '456', sessionId: replacement });
  });

  it('SM-01: superseded discard cleanup cannot reset a newer recording', async () => {
    const { value } = await recording();
    const gate = deferred<void>(),
      entered = deferred<void>();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    releases.push(() => gate.resolve());
    vi.mocked(unlink).mockImplementationOnce(async (path) => {
      entered.resolve();
      await gate.promise;
      await actual.unlink(path);
    });
    const superseded = value.start(match('456'), configSchema.parse({}));
    await entered.promise;
    await value.start(match('789'), configSchema.parse({}));
    const replacement = value.status().sessionId;
    gate.resolve();
    await superseded;
    expect(value.status()).toMatchObject({ phase: 'starting', fid: '789', sessionId: replacement });
  });

  it('SM-02: a revoked finalizer cannot publish a saved callback after abort returns', async () => {
    const { value, saved, sender, token, dir } = await recording();
    const gate = deferred<void>(),
      renamed = deferred<void>();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    releases.push(() => gate.resolve());
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await actual.rename(from, to);
      renamed.resolve();
      await gate.promise;
    });
    const finishing = value.finish(sender, token, 10, false);
    await renamed.promise;
    await value.abort();
    expect(saved).not.toHaveBeenCalled();
    await value.start(match('456'), configSchema.parse({}));
    const replacement = value.status().sessionId;
    gate.resolve();
    await finishing;
    expect(saved).not.toHaveBeenCalled();
    expect(value.status()).toMatchObject({ phase: 'starting', fid: '456', sessionId: replacement });
    expect((await readdir(dir)).filter((name) => !name.startsWith('.'))).toEqual([]);
  });

  it('SM-03: new matches invalidate old current-roster requests without a lobby reset', async () => {
    const events: AppEvent[] = [],
      app = await application(platform(), events);
    const report = deferred<{ value: unknown; source: 'network'; at: number }>();
    releases.push(() => report.resolve({ value: { matchCount: 1 }, source: 'network', at: 0 }));
    vi.spyOn(app.client, 'analysisPlayer').mockReturnValue(report.promise);
    app.parser.feed([
      'Log: Start loading battle... map: Dam, scenario: First',
      'Log: Player list:',
      'ID: 1, Name: Old name, Team: Alpha',
    ]);
    const generation = app.parser.snapshot().generation;
    const querying = app.invoke('session.query', { context: 'current', requestId: randomUUID() });
    await vi.waitFor(() => expect(app.client.analysisPlayer).toHaveBeenCalledTimes(1));
    app.parser.feed([
      'Log: Start loading battle... map: Dam, scenario: Second',
      'Log: Player list:',
      'ID: 1, Name: New name, Team: Bravo',
    ]);
    expect(app.parser.snapshot().generation).toBe(generation);
    report.resolve({
      value: { matchCount: 1, trend: { points: [] } },
      source: 'network',
      at: Date.now(),
    });
    await querying;
    expect(events.filter((event) => event.type === 'roster')).toEqual([]);
  });

  it('keeps finalization single-owner and accepts no chunks after finish begins', async () => {
    const { value, saved, sender, token } = await recording();
    const first = value.finish(sender, token, 10, false);
    const duplicate = value.finish(sender, token, 10, false);
    await expect(value.chunk(sender, token, 1, new Uint8Array([1]).buffer)).rejects.toThrow(
      /invalid/i,
    );
    await Promise.all([first, duplicate]);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('never deletes a replacement file when the same match is finalized in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_900_000_000_000);
    const { value, saved, sender, token, dir } = await recording();
    const gate = deferred<void>(),
      renamed = deferred<void>();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    releases.push(() => gate.resolve());
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await actual.rename(from, to);
      renamed.resolve();
      await gate.promise;
    });
    const old = value.finish(sender, token, 10, false);
    await renamed.promise;
    await value.abort();
    await value.start(match('123'), configSchema.parse({}));
    const nextSender = electron.windows.at(-1)!.webContents.id;
    const nextToken = value.config(nextSender).sessionId;
    value.ready(nextSender, nextToken, false, 'av1');
    await value.chunk(nextSender, nextToken, 0, new TextEncoder().encode('replacement').buffer);
    await value.finish(nextSender, nextToken, 20, false);
    gate.resolve();
    await old;
    const files = (await readdir(dir)).filter((name) => !name.startsWith('.'));
    expect(files).toHaveLength(1);
    expect(await readFile(join(dir, files[0]!), 'utf8')).toBe('replacement');
    expect(saved).toHaveBeenCalledExactlyOnceWith(files[0], 20, expect.anything());
  });

  it('SM-04: delayed switch alerts cannot restore an obsolete backup identity', async () => {
    const { db, service, session, decks, backups } = await deckFixture();
    const gate = deferred<{ decks: string; backups: string; found: boolean }>();
    vi.spyOn(service, 'paths').mockReturnValueOnce(gate.promise);
    const alert = service.switchAlert(session);
    await vi.waitFor(() => expect(service.paths).toHaveBeenCalledTimes(1));
    db.setState('deckSync', { pkgKey: 'persona:Charlie', pkgName: 'Charlie', alertedPairs: [] });
    gate.resolve({ decks, backups, found: true });
    await alert;
    expect(db.state('deckSync', {})).toMatchObject({ pkgKey: 'persona:Charlie' });
  });

  it('SM-04: concurrent evaluations produce at most one account-switch reminder', async () => {
    const { service, session } = await deckFixture();
    const alerts = await Promise.all([service.switchAlert(session), service.switchAlert(session)]);
    expect(alerts.filter(Boolean)).toHaveLength(1);
  });

  it('does not consume a switch reminder for a session revoked during directory lookup', async () => {
    const { db, service, session, decks, backups } = await deckFixture();
    const gate = deferred<{ decks: string; backups: string; found: boolean }>();
    vi.spyOn(service, 'paths').mockReturnValueOnce(gate.promise);
    let active = true;
    const alert = service.switchAlert(session, () => active);
    await vi.waitFor(() => expect(service.paths).toHaveBeenCalledTimes(1));
    active = false;
    gate.resolve({ decks, backups, found: true });
    expect(await alert).toBeNull();
    expect(db.state('deckSync', {})).toMatchObject({ alertedPairs: [] });
    expect(await service.switchAlert(session)).toMatchObject({ to: 'Bob' });
  });

  it('rejects a switch-alert publication after the application account changes', async () => {
    const events: AppEvent[] = [];
    const app = await application(platform(), events);
    const gate = deferred<Awaited<ReturnType<DeckService['switchAlert']>>>();
    releases.push(() => gate.resolve(null));
    const evaluate = vi.spyOn(DeckService.prototype, 'switchAlert').mockReturnValue(gate.promise);
    app.parser.feed(['Log: GetPersonaName Bob', 'Log: [AUTH] Rest: Login success']);
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
    app.parser.feed(['Log: GetPersonaName Charlie']);
    gate.resolve({ pair: 'Alice>Bob', from: 'Alice', to: 'Bob', count: 1, names: [], fid: '123' });
    await gate.promise;
    await Promise.resolve();
    expect(events.filter((event) => event.type === 'decks' && event.alert)).toEqual([]);
    expect(app.snapshot().deckAlert).toBeNull();
  });

  it('SM-05: losing the selected log clears live status', async () => {
    const dir = await directory(),
      path = join(dir, 'Gamelog__audit.log');
    await writeFile(path, 'Log: GetPersonaName Fixture\n');
    const watcher = new LogWatcher(new LogParser(() => {}), () => {});
    cleanups.push(() => watcher.stop());
    watcher.start(dir);
    await vi.waitFor(() =>
      expect(watcher.status()).toMatchObject({ file: path, live: true, recovering: false }),
    );
    await unlink(path);
    await watcher.poll();
    expect(watcher.status()).toMatchObject({ file: null, live: false });
  });

  it('SM-06: recording failure cannot skip database disposal during shutdown', async () => {
    const p = platform();
    p.recordings.stop = vi.fn(async () => {
      throw new Error('Recording save failed');
    });
    const app = await application(p),
      close = vi.spyOn(app.db, 'close');
    await expect(app.stop()).rejects.toThrow('Recording save failed');
    expect(close).toHaveBeenCalledTimes(1);
    await expect(app.stop()).rejects.toThrow('Recording save failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('drains an admitted report before SQL close even when recording stop fails', async () => {
    const p = platform();
    p.recordings.stop = vi.fn(async () => {
      throw new Error('Recording save failed');
    });
    const app = await application(p),
      close = vi.spyOn(app.db, 'close');
    const report = deferred<{ value: unknown; source: 'network'; at: number }>();
    releases.push(() => report.resolve({ value: { matchCount: 1 }, source: 'network', at: 0 }));
    vi.spyOn(app.client, 'analysisPlayer').mockReturnValue(report.promise);
    const loading = app.invoke('players.report', { id: '1' });
    await vi.waitFor(() => expect(app.client.analysisPlayer).toHaveBeenCalledTimes(1));
    const stopped = expect(app.stop()).rejects.toThrow('Recording save failed');
    expect(close).not.toHaveBeenCalled();
    report.resolve({ value: { matchCount: 1 }, source: 'network', at: Date.now() });
    await Promise.all([loading, stopped]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('clears every derived watcher flag when stopped after an error', async () => {
    const dir = await directory();
    const watcher = new LogWatcher(new LogParser(() => {}), () => {});
    cleanups.push(() => watcher.stop());
    watcher.start(join(dir, 'missing'));
    await vi.waitFor(() => expect(watcher.status().error).toBeTruthy());
    watcher.stop();
    expect(watcher.status()).toMatchObject({
      listening: false,
      file: null,
      live: false,
      recovering: false,
      error: null,
    });
    watcher.start(dir);
    await watcher.poll();
    expect(watcher.status()).toMatchObject({
      listening: true,
      file: null,
      live: false,
      error: null,
    });
  });

  it('SM-07: a completed copy with failed source deletion remains retryable', async () => {
    const db = database(),
      from = await directory(),
      to = await directory();
    const files = new ReplayFiles(db, from),
      source = join(from, 'audit.mp4');
    await writeFile(source, 'recording');
    vi.mocked(rename).mockRejectedValue(
      Object.assign(new Error('Cross-device'), { code: 'EXDEV' }),
    );
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(unlink).mockImplementationOnce(async (path) => {
      if (path === source) throw Object.assign(new Error('Locked source'), { code: 'EACCES' });
      await actual.unlink(path);
    });
    expect(await files.move(from, to)).toEqual({ moved: 0, failed: ['audit.mp4'] });
    expect(await readFile(join(to, 'audit.mp4'), 'utf8')).toBe('recording');
    expect(await readdir(from)).toContain('audit.mp4');
    expect(await new ReplayFiles(db, from).move(from, to)).toEqual({ moved: 1, failed: [] });
  });

  it.each(['source', 'destination'] as const)(
    'refuses a migration retry after its %s was changed',
    async (changed) => {
      const db = database(),
        from = await directory(),
        to = await directory();
      const files = new ReplayFiles(db, from),
        source = join(from, 'audit.mp4'),
        dest = join(to, 'audit.mp4');
      await writeFile(source, 'recording');
      vi.mocked(rename).mockRejectedValue(
        Object.assign(new Error('Cross-device'), { code: 'EXDEV' }),
      );
      vi.mocked(unlink).mockRejectedValueOnce(
        Object.assign(new Error('Locked source'), { code: 'EACCES' }),
      );
      expect(await files.move(from, to)).toEqual({ moved: 0, failed: ['audit.mp4'] });
      await writeFile(changed === 'source' ? source : dest, 'different');
      expect(await files.move(from, to)).toEqual({ moved: 0, failed: ['audit.mp4'] });
      expect(await readFile(source, 'utf8')).toBe(changed === 'source' ? 'different' : 'recording');
      expect(await readFile(dest, 'utf8')).toBe(
        changed === 'destination' ? 'different' : 'recording',
      );
    },
  );

  it('does not adopt an unrelated destination even when its bytes match', async () => {
    const db = database(),
      from = await directory(),
      to = await directory();
    await writeFile(join(from, 'audit.mp4'), 'same');
    await writeFile(join(to, 'audit.mp4'), 'same');
    expect(await new ReplayFiles(db, from).move(from, to)).toEqual({
      moved: 0,
      failed: ['audit.mp4'],
    });
    expect(await readFile(join(from, 'audit.mp4'), 'utf8')).toBe('same');
  });

  it('reopens the migration journal before retrying source deletion', async () => {
    const root = await directory(),
      from = join(root, 'from'),
      to = join(root, 'to');
    await mkdir(from);
    await mkdir(to);
    const dbFile = join(root, 'migration.sqlite');
    const first = new Database(dbFile);
    await writeFile(join(from, 'audit.mp4'), 'recording');
    vi.mocked(rename).mockRejectedValue(
      Object.assign(new Error('Cross-device'), { code: 'EXDEV' }),
    );
    vi.mocked(unlink).mockRejectedValueOnce(Object.assign(new Error('Locked'), { code: 'EACCES' }));
    try {
      expect(await new ReplayFiles(first, root).move(from, to)).toEqual({
        moved: 0,
        failed: ['audit.mp4'],
      });
    } finally {
      first.close();
    }
    const reopened = new Database(dbFile);
    try {
      expect(await new ReplayFiles(reopened, root).move(from, to)).toEqual({
        moved: 1,
        failed: [],
      });
      expect(await readFile(join(to, 'audit.mp4'), 'utf8')).toBe('recording');
      expect(await readdir(from)).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it('validates a queued migration against the directory selected by its predecessor', async () => {
    const app = await application(),
      from = await directory(),
      to = await directory(),
      other = await directory();
    app.db.updateConfig({ replaySaveDir: from });
    await writeFile(join(from, 'audit.mp4'), 'recording');
    const gate = deferred<void>(),
      entered = deferred<void>();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    releases.push(() => gate.resolve());
    vi.mocked(rename).mockImplementationOnce(async (source, dest) => {
      entered.resolve();
      await gate.promise;
      await actual.rename(source, dest);
    });
    const first = app.invoke('replays.move', { from, to });
    await entered.promise;
    const second = expect(app.invoke('replays.move', { from, to: other })).rejects.toThrow(
      /source directory changed/i,
    );
    gate.resolve();
    expect(await first).toEqual({ moved: 1, failed: [] });
    await second;
    expect(app.db.config().replaySaveDir).toBe(to);
  });
});
