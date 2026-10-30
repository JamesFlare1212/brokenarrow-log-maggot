import * as files from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, RecordingState } from '@ba/contracts';
import type { Platform } from '../apps/server/src/ports';
import { Application } from '../apps/server/src/app';
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

const root = resolve('.test-data/log-monitoring-tests');
const applications: Application[] = [];
const directories: string[] = [];
const match =
  'Log: GetPersonaName Alpha\nLog: Start loading battle... map: Dam, scenario: Test\nLog: FID:12345\nLog: Player list:\nID: 1, Name: Alpha, Team: Alpha\nID: 2, Name: Bravo, Team: Bravo\n';
const end = 'Log: GameController dispose called\n';
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function fixture() {
  await files.mkdir(root, { recursive: true });
  const directory = await files.mkdtemp(join(root, 'profile-'));
  directories.push(directory);
  const logs = join(directory, 'logs'),
    moved = join(directory, 'moved');
  await files.mkdir(logs);
  const log = join(logs, 'Gamelog__current.log');
  await files.writeFile(log, 'Log: GetPersonaName Alpha\n');
  let recording: RecordingState = {
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
  const platform: Platform = {
    version: 'log-monitoring-test',
    http: { offline: true, fetch: vi.fn() },
    selectDirectory: async () => null,
    detectLogDirectory: async () => logs,
    openPath: async () => {},
    openExternal: async () => {},
    notify: () => {},
    recordings: {
      status: () => recording,
      start: vi.fn(async (current) => {
        recording = {
          ...recording,
          phase: 'recording',
          sessionId: current.sessionId,
          fid: current.fid,
          map: current.map,
          startedAt: Date.now(),
        };
      }),
      stop: vi.fn(async () => {
        recording = { ...recording, phase: 'idle', sessionId: null };
      }),
      abort: vi.fn(async () => {
        recording = { ...recording, phase: 'idle', sessionId: null };
      }),
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
  };
  const events: AppEvent[] = [];
  const app = new Application(directory, platform, (event) => events.push(event), false);
  applications.push(app);
  app.db.updateConfig({
    logDir: logs,
    decksDir: join(directory, 'decks'),
    replayEnabled: false,
    autoQueryCurrentMatch: false,
  });
  app.watcher.start(logs);
  await app.watcher.poll();
  await files.appendFile(log, match);
  await app.watcher.poll();
  await delay(270);
  const fail = async () => {
    await files.rename(logs, moved);
    await files.writeFile(logs, 'This path is deliberately a regular file.');
    await app.invoke('logs.refresh', null);
  };
  const restore = async () => {
    await files.unlink(logs);
    await files.rename(moved, logs);
  };
  return { app, platform, events, directory, logs, log, moved, fail, restore };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(applications.splice(0).map((app) => app.stop()));
  for (const directory of directories.splice(0)) {
    expect(dirname(resolve(directory))).toBe(root);
    await files.rm(directory, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

describe('verified log monitoring and automatic recording', () => {
  for (const minutes of [0, 3])
    for (const failure of [false, true]) {
      it(`checks an ${minutes}-minute-old source before enabling capture with failure=${failure}`, async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const f = await fixture();
        const original = f.app.parser.snapshot().current!;
        if (failure) await f.fail();
        vi.setSystemTime(Date.now() + minutes * 60_000);
        await f.app.invoke('logs.refresh', null);
        if (failure)
          expect(f.app.watcher.status()).toMatchObject({ live: false, error: expect.any(String) });
        await f.app.invoke('config.update', { replayEnabled: true });
        expect(f.platform.recordings.start).toHaveBeenCalledTimes(
          !failure && minutes === 0 ? 1 : 0,
        );
        expect(f.app.parser.snapshot().current?.sessionId).toBe(original.sessionId);
        if (failure) {
          await files.appendFile(join(f.moved, 'Gamelog__current.log'), end);
          await f.restore();
          await f.app.invoke('logs.refresh', null);
          await delay(270);
          expect(f.app.parser.snapshot().current).toBeNull();
          expect(f.platform.recordings.start).not.toHaveBeenCalled();
        }
      });
    }
  it('clears an obsolete error after successfully inspecting an empty directory', async () => {
    const f = await fixture();
    await f.fail();
    const failed = f.app.watcher.status();
    expect(failed.error).toBeTruthy();
    await files.unlink(f.logs);
    await files.mkdir(f.logs);
    const status = await f.app.invoke('logs.refresh', null);
    expect(status).toMatchObject({
      file: null,
      error: null,
      live: false,
      recovering: false,
      checkedAt: expect.any(Number),
    });
    expect(f.app.parser.snapshot().current).toBeNull();
    expect(f.events.at(-1)).toMatchObject({ type: 'watcher', watcher: status });
    await files.writeFile(f.log, match);
    await f.app.invoke('logs.refresh', null);
    expect(f.app.watcher.status()).toMatchObject({ file: f.log, error: null, live: true });
  });
  it('reads a newly appended end line before enabling capture from an apparently healthy room', async () => {
    const f = await fixture();
    expect(f.app.watcher.status().live).toBe(true);
    await files.appendFile(f.log, end);
    await f.app.invoke('config.update', { replayEnabled: true });
    expect(f.app.parser.snapshot().current).toBeNull();
    expect(f.platform.recordings.start).not.toHaveBeenCalled();
  });
  it('waits for the complete live read before starting with its final match identity', async () => {
    const f = await fixture();
    f.app.db.updateConfig({ replayEnabled: true });
    await files.appendFile(
      f.log,
      end +
        'Log: Start loading battle... map: Harbor, scenario: Test\n' +
        'Log: unrelated tick\n'.repeat(8000) +
        'Log: FID:54321\n',
    );
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const open = files.open;
    vi.spyOn(files, 'open').mockImplementationOnce(async (...args) => {
      const handle = await Reflect.apply(open, undefined, args);
      const read = handle.read.bind(handle);
      let reads = 0;
      vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
        if (++reads === 2) {
          entered();
          await gate;
        }
        return Reflect.apply(read, undefined, readArgs);
      });
      return handle;
    });
    const pending = f.app.invoke('logs.refresh', null);
    await started;
    await delay(270);
    expect(f.app.watcher.status().checking).toBe(true);
    expect(f.platform.recordings.start).not.toHaveBeenCalled();
    release();
    await pending;
    await delay(270);
    expect(f.platform.recordings.start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fid: '54321' }),
      expect.anything(),
    );
  });
  it('starts once after an unreadable live room is fully verified, without retrying a failed capture indefinitely', async () => {
    const f = await fixture();
    await f.fail();
    await f.app.invoke('config.update', { replayEnabled: true });
    expect(f.platform.recordings.start).not.toHaveBeenCalled();
    vi.mocked(f.platform.recordings.start).mockRejectedValueOnce(
      new Error('Controlled capture failure'),
    );
    await f.restore();
    await f.app.invoke('logs.refresh', null);
    await delay(270);
    expect(f.platform.recordings.start).toHaveBeenCalledTimes(1);
    await f.app.invoke('logs.refresh', null);
    await delay(270);
    expect(f.platform.recordings.start).toHaveBeenCalledTimes(1);
  });
  it.each(['read error', 'early EOF'])(
    'retains the failure guard through a partial retry with %s before reading a missed end line',
    async (fault) => {
      const f = await fixture();
      await f.fail();
      await f.app.invoke('config.update', { replayEnabled: true });
      await files.appendFile(
        join(f.moved, 'Gamelog__current.log'),
        'Log: Start loading battle... map: Harbor, scenario: Test\n' +
          'Log: unrelated tick\n'.repeat(8000) +
          end,
      );
      await f.restore();
      const open = files.open;
      vi.spyOn(files, 'open').mockImplementationOnce(async (...args) => {
        const handle = await Reflect.apply(open, undefined, args);
        const read = handle.read.bind(handle);
        let reads = 0;
        vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
          if (++reads === 2) {
            if (fault === 'early EOF') return { bytesRead: 0, buffer: Buffer.alloc(0) };
            throw new Error('Controlled mid-read failure');
          }
          return Reflect.apply(read, undefined, readArgs);
        });
        return handle;
      });
      await f.app.invoke('logs.refresh', null);
      expect(f.app.watcher.status()).toMatchObject({
        live: false,
        error:
          fault === 'early EOF'
            ? 'Log file changed before the current read completed'
            : 'Controlled mid-read failure',
      });
      await delay(270);
      expect(f.platform.recordings.start).not.toHaveBeenCalled();
      await f.app.invoke('logs.refresh', null);
      await delay(270);
      expect(f.app.watcher.status().error).toBeNull();
      expect(f.app.parser.snapshot().current).toBeNull();
      expect(f.platform.recordings.start).not.toHaveBeenCalled();
    },
  );
  it('waits for the same in-flight inspection when a retry overlaps polling', async () => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const read = files.readdir;
    const spy = vi.spyOn(files, 'readdir').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return Reflect.apply(read, undefined, args);
    });
    const first = f.app.invoke('logs.refresh', null);
    await started;
    let settled = false;
    const second = f.app.invoke('logs.refresh', null).then((status) => {
      settled = true;
      return status;
    });
    await delay(20);
    expect(settled).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    expect(await second).toEqual(await first);
  });
  it('keeps an existing capture during read failure and saves it when the source becomes empty', async () => {
    const f = await fixture();
    await f.app.invoke('config.update', { replayEnabled: true });
    expect(f.platform.recordings.status().phase).toBe('recording');
    await files.appendFile(f.log, 'Log: FID:54321\n');
    await f.app.invoke('logs.refresh', null);
    const stopCount = vi.mocked(f.platform.recordings.stop).mock.calls.length;
    const abortCount = vi.mocked(f.platform.recordings.abort).mock.calls.length;
    await f.fail();
    expect(f.platform.recordings.status().phase).toBe('recording');
    expect(f.platform.recordings.stop).toHaveBeenCalledTimes(stopCount);
    expect(f.platform.recordings.abort).toHaveBeenCalledTimes(abortCount);
    await files.unlink(f.logs);
    await files.mkdir(f.logs);
    await f.app.invoke('logs.refresh', null);
    expect(f.platform.recordings.stop).toHaveBeenCalledTimes(stopCount + 1);
    expect(f.platform.recordings.stop).toHaveBeenLastCalledWith(
      expect.objectContaining({ fid: '54321' }),
    );
    expect(f.platform.recordings.abort).toHaveBeenCalledTimes(abortCount);
    expect(f.app.parser.snapshot().current).toBeNull();
  });
  it('does not automatically retry a failed capture when the same source is reopened', async () => {
    const f = await fixture();
    vi.mocked(f.platform.recordings.start).mockRejectedValueOnce(
      new Error('Controlled capture failure'),
    );
    await f.app.invoke('config.update', { replayEnabled: true });
    expect(f.platform.recordings.start).toHaveBeenCalledTimes(1);
    vi.spyOn(f.platform.recordings, 'status').mockReturnValue({
      ...f.platform.recordings.status(),
      phase: 'error',
      error: 'Controlled capture failure',
    });
    const contents = await files.readFile(f.log);
    await files.unlink(f.log);
    await files.writeFile(f.log, contents);
    await f.app.invoke('logs.refresh', null);
    await delay(270);
    expect(f.platform.recordings.start).toHaveBeenCalledTimes(1);
    await f.app.invoke('config.update', { replayEnabled: false });
    await f.app.invoke('config.update', { replayEnabled: true });
    expect(f.platform.recordings.start).toHaveBeenCalledTimes(2);
  });
  it('starts a fully checked next match after the previous capture finishes saving', async () => {
    const f = await fixture();
    await f.app.invoke('config.update', { replayEnabled: true });
    let state = f.platform.recordings.status();
    vi.spyOn(f.platform.recordings, 'status').mockImplementation(() => state);
    let release!: () => void;
    const saving = new Promise<void>((done) => {
      release = done;
    });
    vi.mocked(f.platform.recordings.stop).mockImplementationOnce(async () => {
      state = { ...state, phase: 'stopping' };
      await saving;
      state = { ...state, phase: 'idle', sessionId: null };
    });
    await files.appendFile(f.log, end + match.replace('FID:12345', 'FID:54321'));
    const polls = vi.spyOn(f.app.watcher, 'poll');
    try {
      await f.app.invoke('logs.refresh', null);
      await delay(270);
      expect(f.platform.recordings.start).toHaveBeenCalledTimes(1);
      release();
      await vi.waitFor(() => expect(f.platform.recordings.start).toHaveBeenCalledTimes(2), {
        timeout: 500,
        interval: 10,
      });
      expect(f.platform.recordings.start).toHaveBeenLastCalledWith(
        expect.objectContaining({ fid: '54321' }),
        expect.anything(),
      );
      expect(polls).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
  });
});
