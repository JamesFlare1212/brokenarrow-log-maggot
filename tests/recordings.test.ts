import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema, type Match } from '@ba/contracts';
import { emptyMatch, emptyPlayer } from '@ba/shared';

const electron = vi.hoisted(() => {
  const loadFile = vi.fn(async (_path: string) => {});
  let nextId = 1;
  class FakeBrowserWindow {
    destroyed = false;
    webContents = { id: nextId++, on: vi.fn(), send: vi.fn(), setWindowOpenHandler: vi.fn() };
    constructor(_options: unknown) {
      windows.push(this);
    }
    loadFile(path: string) {
      return loadFile(path);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const windows: FakeBrowserWindow[] = [];
  const getSources = vi.fn<
    () => Promise<
      Array<{
        id: string;
        display_id: string;
        name: string;
        thumbnail: { toDataURL: () => string };
      }>
    >
  >();
  const handle =
    vi.fn<(scheme: string, callback: (request: Request) => Promise<Response>) => void>();
  const unhandle = vi.fn<(scheme: string) => void>();
  const getAllDisplays = vi.fn(() => [
    { id: 1, label: 'Primary', bounds: { width: 1_920, height: 1_080 }, scaleFactor: 1 },
  ]);
  return {
    BrowserWindow: FakeBrowserWindow,
    windows,
    getSources,
    loadFile,
    handle,
    unhandle,
    getAllDisplays,
  };
});
vi.mock('electron', () => ({
  BrowserWindow: electron.BrowserWindow,
  desktopCapturer: { getSources: electron.getSources },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1 }),
    getAllDisplays: electron.getAllDisplays,
  },
  protocol: { handle: electron.handle, unhandle: electron.unhandle },
}));
import { RecordingController } from '../apps/desktop/src/recordings/controller';
import { ReplayProtocol } from '../apps/desktop/src/recordings/protocol';
import { patchDuration, patchDurationFile } from '../apps/desktop/src/recordings/webm';
import { Application } from '../apps/server/src/app';

const source = {
  id: 'screen:1:0',
  display_id: '1',
  name: 'Primary',
  thumbnail: { toDataURL: () => 'data:image/png;base64,AA==' },
};
const workspace = resolve(process.cwd());
const testRoot = resolve(workspace, '.test-data', 'recordings');
const temporary: Array<{ path: string; root: string; workspace: string }> = [];
const controllers: RecordingController[] = [];
const protocols: ReplayProtocol[] = [];
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
  const path = await mkdtemp(join(root, 'recorder-'));
  assertChild(root, path);
  temporary.push({ path, root, workspace: realWorkspace });
  return path;
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function match(fid: string | null = '123'): Match {
  const result = emptyMatch(fid || 'local:fixture');
  result.sessionId = 'match-session-' + (fid || 'late-fid');
  result.map = 'Dam';
  result.mapId = 7;
  result.localPlayerId = '8863';
  result.players = [{ ...emptyPlayer('8863', '王'), teamId: 0 }];
  return result;
}
function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}
async function controller() {
  const dir = await temp(),
    changed = vi.fn(),
    saved = vi.fn(),
    previewed = vi.fn();
  const value = new RecordingController(
    'fixture-preload',
    'fixture-recorder',
    () => dir,
    changed,
    saved,
    previewed,
  );
  controllers.push(value);
  return { value, dir, changed, saved, previewed };
}
async function start(value: RecordingController, current = match()) {
  await value.start(current, configSchema.parse({}));
  const window = electron.windows.at(-1)!;
  const sender = window.webContents.id,
    token = value.config(sender).sessionId;
  value.ready(sender, token, true);
  return { window, sender, token };
}
beforeEach(() => {
  electron.windows.length = 0;
  electron.getSources.mockReset();
  electron.getSources.mockResolvedValue([source]);
  electron.loadFile.mockReset();
  electron.loadFile.mockResolvedValue();
  electron.handle.mockClear();
  electron.unhandle.mockClear();
  electron.getAllDisplays.mockReset();
  electron.getAllDisplays.mockReturnValue([
    { id: 1, label: 'Primary', bounds: { width: 1_920, height: 1_080 }, scaleFactor: 1 },
  ]);
});
afterEach(async () => {
  for (const value of controllers.splice(0)) await value.abort();
  for (const value of protocols.splice(0)) value.close();
  for (const entry of temporary.splice(0)) {
    const target = await realpath(resolve(entry.path));
    assertChild(entry.workspace, target);
    assertChild(entry.root, target);
    await rm(target, { recursive: true, force: true });
  }
});

describe('recording display discovery', () => {
  it.each([
    { width: 1_920, height: 1_080, scaleFactor: 1, resolution: '1920×1080' },
    { width: 2_560, height: 1_440, scaleFactor: 1.5, resolution: '3840×2160' },
    { width: 1_536, height: 864, scaleFactor: 1.25, resolution: '1920×1080' },
    { width: 1_080, height: 1_920, scaleFactor: 2, resolution: '2160×3840' },
  ])('labels physical pixels at $scaleFactor scale ($resolution)', async (display) => {
    electron.getAllDisplays.mockReturnValue([
      {
        id: 1,
        label: 'Primary',
        bounds: { width: display.width, height: display.height },
        scaleFactor: display.scaleFactor,
      },
    ]);
    const { value } = await controller();

    expect(await value.displays()).toEqual([
      {
        id: source.id,
        label: 'Primary · ' + display.resolution,
        thumbnail: source.thumbnail.toDataURL(),
      },
    ]);
  });

  it('uses each matched monitor scale when capture sources have a different order', async () => {
    electron.getAllDisplays.mockReturnValue([
      { id: 2, label: '4K', bounds: { width: 1_920, height: 1_080 }, scaleFactor: 2 },
      { id: 1, label: 'Secondary', bounds: { width: 1_920, height: 1_080 }, scaleFactor: 1 },
    ]);
    electron.getSources.mockResolvedValue([
      source,
      { ...source, id: 'screen:2:0', display_id: '2' },
    ]);
    const { value } = await controller();

    expect((await value.displays()).map((display) => display.label)).toEqual([
      'Secondary · 1920×1080',
      '4K · 3840×2160',
    ]);
  });

  it('retains the capture source name when no monitor metadata is available', async () => {
    electron.getAllDisplays.mockReturnValue([]);
    const { value } = await controller();

    expect((await value.displays())[0]?.label).toBe(source.name);
  });
});

describe('recording lifecycle and IPC ownership', () => {
  it('keeps the startup identity through stop and expires it for a new capture of the same match', async () => {
    const { value, dir } = await controller();
    const current = match();
    await value.start(current, configSchema.parse({}));
    const sessionId = value.status().sessionId;
    expect(sessionId).toBeTruthy();
    expect(sessionId).not.toBe(current.sessionId);
    const sender = electron.windows.at(-1)!.webContents.id;
    const token = value.config(sender).sessionId;
    expect(token).toBe(sessionId);
    value.ready(sender, token, false);
    expect(value.status().sessionId).toBe(sessionId);
    await value.chunk(sender, token, 0, bytes('reviewed capture'));
    const stopping = value.stop();
    expect(value.status()).toMatchObject({ phase: 'stopping', sessionId });
    await value.finish(sender, token, 15, false);
    await stopping;
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(await readFile(join(dir, files[0]!), 'utf8')).toBe('reviewed capture');

    await value.start(current, configSchema.parse({}));
    expect(value.status().sessionId).not.toBe(sessionId);
    const nextSender = electron.windows.at(-1)!.webContents.id;
    expect(() => value.ready(nextSender, token, false)).toThrow(/expired/i);
    expect(value.status().phase).toBe('starting');
  });

  it.each([false, true])(
    'disables recording through the application during startup or capture (ready=%s)',
    async (ready) => {
      const { value, dir } = await controller();
      const sources = deferred<(typeof source)[]>();
      electron.getSources.mockReturnValueOnce(sources.promise);
      const app = new Application(
        dir,
        {
          version: '4.5.1',
          http: {
            offline: true,
            fetch: async () => {
              throw new Error('Recording regression must remain offline');
            },
          },
          selectDirectory: async () => null,
          detectLogDirectory: async () => '',
          openPath: async () => {},
          openExternal: async () => {},
          notify: () => {},
          recordings: {
            status: () => value.status(),
            start: (match, config, test) => value.start(match, config, test),
            stop: (match) => value.stop(match),
            abort: () => value.abort(),
            displays: () => value.displays(),
            thumbnail: (id) => value.thumbnail(id),
            playback: async () => '',
          },
        },
        () => {},
        false,
      );
      const starting = value.start(match(), configSchema.parse({}));
      try {
        await vi.waitFor(() => expect(electron.getSources).toHaveBeenCalledTimes(1));
        const sessionId = value.status().sessionId;
        app.db.updateConfig({ replayEnabled: true });
        if (ready) {
          sources.resolve([source]);
          await starting;
          const sender = electron.windows.at(-1)!.webContents.id;
          const token = value.config(sender).sessionId;
          value.ready(sender, token, false);
          await value.chunk(sender, token, 0, bytes('disabled capture'));
          const disabling = app.invoke('config.update', { replayEnabled: false });
          void disabling.catch(() => {});
          await vi.waitFor(() =>
            expect(value.status()).toMatchObject({ phase: 'stopping', sessionId }),
          );
          await value.finish(sender, token, 15, false);
          await disabling;
          const files = (await readdir(dir)).filter((name) => name.endsWith('.webm'));
          expect(files).toHaveLength(1);
          expect(await readFile(join(dir, files[0]!), 'utf8')).toBe('disabled capture');
        } else {
          await app.invoke('config.update', { replayEnabled: false });
          sources.resolve([source]);
          await starting;
          expect(electron.windows).toHaveLength(0);
          expect((await readdir(dir)).filter((name) => name.endsWith('.webm'))).toEqual([]);
        }
        expect(value.status()).toMatchObject({ phase: 'idle', sessionId: null });
        expect(app.db.config().replayEnabled).toBe(false);
      } finally {
        sources.resolve([source]);
        await starting.catch(() => {});
        await value.abort();
        await app.stop();
      }
    },
  );

  it('does not resurrect a capture aborted while display discovery is pending', async () => {
    const { value, dir } = await controller();
    const sources = deferred<(typeof source)[]>();
    electron.getSources.mockReturnValueOnce(sources.promise);
    const starting = value.start(match(), configSchema.parse({}));
    await vi.waitFor(() => expect(electron.getSources).toHaveBeenCalledTimes(1));
    await value.abort();
    sources.resolve([source]);
    await starting;
    expect(value.status().phase).toBe('idle');
    expect(electron.windows).toHaveLength(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('creates only the newest window when concurrent starts overlap display discovery', async () => {
    const { value } = await controller();
    const oldSources = deferred<(typeof source)[]>(),
      newSources = deferred<(typeof source)[]>();
    electron.getSources
      .mockReturnValueOnce(oldSources.promise)
      .mockReturnValueOnce(newSources.promise);
    const first = value.start(match('123'), configSchema.parse({}));
    await vi.waitFor(() => expect(electron.getSources).toHaveBeenCalledTimes(1));
    const second = value.start(match('456'), configSchema.parse({}));
    await vi.waitFor(() => expect(electron.getSources).toHaveBeenCalledTimes(2));
    oldSources.resolve([source]);
    newSources.resolve([source]);
    await Promise.all([first, second]);
    expect(electron.windows).toHaveLength(1);
    expect(value.status()).toMatchObject({ phase: 'starting', fid: '456' });
  });

  it('does not reopen a window whose page load completes after abort', async () => {
    const { value, dir } = await controller();
    const loaded = deferred<void>();
    electron.loadFile.mockReturnValueOnce(loaded.promise);
    const starting = value.start(match(), configSchema.parse({}));
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));
    await value.abort();
    loaded.resolve();
    await starting;
    expect(electron.windows[0]?.isDestroyed()).toBe(true);
    expect(value.status().phase).toBe('idle');
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects another IPC sender, expired tokens, replayed sequences and oversized chunks', async () => {
    const { value } = await controller();
    const { sender, token } = await start(value);
    expect(() => value.config(sender + 1)).toThrow(/expired/i);
    expect(() => value.ready(sender, 'wrong-token', false)).toThrow(/expired/i);
    await expect(value.chunk(sender + 1, token, 0, bytes('bad'))).rejects.toThrow(/expired/i);
    await expect(value.chunk(sender, 'wrong-token', 0, bytes('bad'))).rejects.toThrow(/expired/i);
    await expect(value.chunk(sender, token, 1, bytes('out of order'))).rejects.toThrow(/invalid/i);
    await expect(value.chunk(sender, token, -1, bytes('negative'))).rejects.toThrow(/invalid/i);
    await expect(value.chunk(sender, token, 0, new ArrayBuffer(0))).rejects.toThrow(/invalid/i);
    await expect(
      value.chunk(sender, token, 0, new ArrayBuffer(16 * 1_024 * 1_024 + 1)),
    ).rejects.toThrow(/invalid/i);
    await value.chunk(sender, token, 0, bytes('good'));
    await expect(value.chunk(sender, token, 0, bytes('replayed'))).rejects.toThrow(/invalid/i);
    await expect(value.finish(sender, token, Number.NaN, false)).rejects.toThrow(/invalid/i);
  });

  it('rejects an empty token instead of bypassing ownership checks', async () => {
    const { value } = await controller();
    const { sender } = await start(value);
    await expect(value.chunk(sender, '', 0, bytes('unauthorized'))).rejects.toThrow(/expired/i);
  });

  it('writes concurrently delivered chunks in order and stop waits for the final file', async () => {
    const { value, dir, saved } = await controller();
    const current = match(null),
      { window, sender, token } = await start(value, current);
    const first = bytes('first|'),
      second = bytes('second|'),
      third = bytes('third');
    const chunks = [
      value.chunk(sender, token, 0, first),
      value.chunk(sender, token, 1, second),
      value.chunk(sender, token, 2, third),
    ];
    let stopped = false;
    const lateFid = { ...current, id: '8049993', fid: '8049993' };
    const stopping = value.stop(lateFid).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(value.status().phase).toBe('stopping');
    expect(window.webContents.send).toHaveBeenCalledWith('ba:recording:stop', false);
    await Promise.all([...chunks, value.finish(sender, token, 90, true), stopping]);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^8049993__/);
    expect(await readFile(join(dir, files[0]!), 'utf8')).toBe('first|second|third');
    expect(saved).toHaveBeenCalledWith(
      files[0],
      90,
      expect.objectContaining({ fid: '8049993', sessionId: current.sessionId }),
    );
    expect(value.status().phase).toBe('idle');
    expect(window.isDestroyed()).toBe(true);
  });

  it('waits for the previous stop to save before starting the next match', async () => {
    const { value, dir, saved } = await controller();
    const first = await start(value, match('123'));
    await value.chunk(first.sender, first.token, 0, bytes('first match'));
    const stopping = value.stop();
    const starting = value.start(match('456'), configSchema.parse({}));
    await Promise.resolve();
    expect(electron.getSources).toHaveBeenCalledTimes(1);
    await value.finish(first.sender, first.token, 30, false);
    await Promise.all([stopping, starting]);
    expect(saved).toHaveBeenCalledTimes(1);
    const completed = (await readdir(dir)).filter(
      (name) => !name.startsWith('.') && name.endsWith('.webm'),
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatch(/^123__/);
    expect(first.window.isDestroyed()).toBe(true);
    expect(value.status()).toMatchObject({ phase: 'starting', fid: '456' });
    await vi.waitFor(async () => {
      const partial = (await readdir(dir)).filter(
        (name) => name.startsWith('.rec-part-') && name.endsWith('.webm'),
      );
      expect(partial).toHaveLength(1);
    });
    const nextWindow = electron.windows.at(-1)!,
      sender = nextWindow.webContents.id,
      token = value.config(sender).sessionId;
    value.ready(sender, token, false);
    await expect(
      value.chunk(first.sender, first.token, 1, bytes('late old chunk')),
    ).rejects.toThrow(/expired/i);
    await expect(value.chunk(sender, first.token, 0, bytes('wrong session'))).rejects.toThrow(
      /expired/i,
    );
    await value.chunk(sender, token, 0, bytes('second match'));
    await value.finish(sender, token, 20, false);
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    expect(
      await readFile(
        join(
          dir,
          files.find((name) => name.startsWith('123__'))!,
        ),
        'utf8',
      ),
    ).toBe('first match');
    expect(
      await readFile(
        join(
          dir,
          files.find((name) => name.startsWith('456__'))!,
        ),
        'utf8',
      ),
    ).toBe('second match');
  });

  it('only forwards bounded JPEG previews from the active recording', async () => {
    const { value, previewed } = await controller();
    const { sender, token } = await start(value);
    value.preview(sender, token, 'javascript:bad', false);
    value.preview(sender, token, 'data:image/jpeg;base64,' + 'A'.repeat(300_000), false);
    expect(previewed).not.toHaveBeenCalled();
    value.preview(sender, token, 'data:image/jpeg;base64,AA==', true);
    expect(previewed).toHaveBeenCalledExactlyOnceWith(token, 'data:image/jpeg;base64,AA==', true);
  });
});

function element(id: string, data: Buffer): Buffer {
  if (data.length >= 127) throw new Error('Fixture element needs a larger size encoding');
  return Buffer.concat([Buffer.from(id, 'hex'), Buffer.from([0x80 | data.length]), data]);
}
function webm(
  options: { scale?: number; durationBytes?: 4 | 8; durationFirst?: boolean } = {},
): Buffer {
  const scale = Buffer.alloc(3);
  scale.writeUIntBE(options.scale ?? 1_000_000, 0, 3);
  const timeScale = element('2ad7b1', scale);
  const duration = options.durationBytes
    ? element('4489', Buffer.alloc(options.durationBytes))
    : Buffer.alloc(0);
  const info = element(
    '1549a966',
    Buffer.concat(options.durationFirst ? [duration, timeScale] : [timeScale, duration]),
  );
  return Buffer.concat([
    Buffer.from('1a45dfa3801853806701ffffffffffffff', 'hex'),
    info,
    element('1f43b675', Buffer.from([0xe7, 0x81, 0])),
  ]);
}
function readDuration(buffer: Buffer, width: 4 | 8 = 8): number {
  const at = buffer.indexOf(Buffer.from([0x44, 0x89, 0x80 | width]));
  if (at < 0) throw new Error('Duration element is missing');
  return width === 4 ? buffer.readFloatBE(at + 3) : buffer.readDoubleBE(at + 3);
}

describe('WebM duration metadata', () => {
  it('inserts duration using the actual TimecodeScale', () => {
    const original = webm({ scale: 2_000_000 });
    const patched = patchDuration(original, 2.5);
    expect(readDuration(patched)).toBe(1_250);
    expect(patched.subarray(-8)).toEqual(original.subarray(-8));
    expect(original.indexOf(Buffer.from('448988', 'hex'))).toBe(-1);
  });

  it.each([4, 8] as const)(
    'updates an existing %i-byte Duration without mutating the source',
    (width) => {
      const original = webm({ scale: 2_000_000, durationBytes: width });
      const patched = patchDuration(original, 7.5);
      expect(readDuration(patched, width)).toBe(3_750);
      expect(readDuration(original, width)).toBe(0);
      expect(patched.length).toBe(original.length);
    },
  );

  it('uses TimecodeScale even when it appears after Duration', () => {
    const original = webm({ scale: 2_000_000, durationBytes: 8, durationFirst: true });
    expect(readDuration(patchDuration(original, 7.5))).toBe(3_750);
  });

  it('patches a real file while preserving the bytes beyond the header read limit', async () => {
    const root = await temp(),
      sourcePath = join(root, 'source.webm'),
      destination = join(root, 'patched.webm');
    const original = Buffer.concat([webm({ durationBytes: 8 }), Buffer.alloc(100_000, 0xab)]);
    await writeFile(sourcePath, original);
    await patchDurationFile(sourcePath, destination, 3);
    const saved = await readFile(destination);
    expect(readDuration(saved)).toBe(3_000);
    expect(saved.length).toBe(original.length);
    expect(saved.subarray(65_536)).toEqual(original.subarray(65_536));
    expect(await readFile(sourcePath)).toEqual(original);
  });
});

describe('local replay HTTP ranges', () => {
  async function fixture() {
    const root = await temp(),
      path = join(root, 'video.webm');
    await writeFile(path, '0123456789');
    const protocol = new ReplayProtocol();
    protocols.push(protocol);
    protocol.register();
    const handler = electron.handle.mock.calls.at(-1)?.[1];
    if (!handler) throw new Error('Protocol handler was not registered');
    return { protocol, handler, url: protocol.url(path) };
  }

  it('streams the full file with byte-range support', async () => {
    const { handler, url } = await fixture();
    const response = await handler(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(await response.text()).toBe('0123456789');
  });

  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-999', '89', 'bytes 8-9/10'],
  ])('serves %s from a real file', async (range, body, contentRange) => {
    const { handler, url } = await fixture();
    const response = await handler(new Request(url, { headers: { Range: range } }));
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(contentRange);
    expect(response.headers.get('Content-Length')).toBe(String(body.length));
    expect(await response.text()).toBe(body);
  });

  it.each(['bytes=99-100', 'bytes=5-2', 'bytes=-', 'bytes=-0', 'bytes=0-1,3-4'])(
    'rejects unsatisfiable range %s',
    async (range) => {
      const { handler, url } = await fixture();
      const response = await handler(new Request(url, { headers: { Range: range } }));
      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe('bytes */10');
      expect(await response.text()).toBe('');
    },
  );

  it('returns HEAD range headers without reading a response body', async () => {
    const { handler, url } = await fixture();
    const response = await handler(
      new Request(url, { method: 'HEAD', headers: { Range: 'bytes=2-5' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(await response.text()).toBe('');
  });

  it('expires tokens and unregisters the handler on close', async () => {
    const { protocol, handler, url } = await fixture();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 7_200_001);
    expect((await handler(new Request(url))).status).toBe(404);
    expect((await handler(new Request('ba-replay://unknown/video.webm'))).status).toBe(404);
    protocol.close();
    expect(electron.unhandle).toHaveBeenCalledWith('ba-replay');
  });
});
