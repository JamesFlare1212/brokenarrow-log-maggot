import { mkdir, mkdtemp, open, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findLogDirectory, getSteamRoots } from '../apps/desktop/src/steam-logs';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execute }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), stat: vi.fn(actual.stat) };
});

const testRoot = resolve('.test-data', 'log-detection');
const temporary: string[] = [];
const now = new Date('2026-10-15T12:00:00Z').getTime();

async function temp(): Promise<string> {
  await mkdir(testRoot, { recursive: true });
  const path = await mkdtemp(join(testRoot, 'steam-'));
  temporary.push(path);
  return path;
}

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function manifest(library: string, name = 'broken_arrow', flags = '4', appid = '1604270') {
  await put(
    join(library, 'steamapps', 'appmanifest_1604270.acf'),
    `"AppState" { "appid" "${appid}" "installdir" ${JSON.stringify(name)} "StateFlags" "${flags}" }`,
  );
}

function logDir(library: string, name = 'broken_arrow'): string {
  return join(library, 'steamapps', 'common', name, 'GameLogs');
}

async function log(
  library: string,
  age = 5_000,
  name = 'broken_arrow',
  file = 'Gamelog__test.log',
) {
  const directory = logDir(library, name);
  const path = join(directory, file);
  await put(path, 'Log: GetPersonaName Player\n');
  const modified = new Date(now - age);
  await utimes(path, modified, modified);
  return directory;
}

beforeEach(() => {
  execute.mockImplementation((_file, _args, _options, callback) => {
    callback(null, '[]', '');
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0)) {
    const root = await realpath(testRoot);
    const target = await realpath(path);
    const child = relative(root, target);
    if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child))
      throw new Error('Refusing to clean outside the log detection test root');
    await rm(target, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'win32')('Steam registry discovery', () => {
  it('keeps custom Unicode installation paths and deduplicates Windows path variants', async () => {
    execute.mockImplementation((_file, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify(['G:/游戏/Steam', 'g:\\游戏\\steam\\', '', 42, 'relative']),
        '',
      );
    });
    const roots = await getSteamRoots();
    expect(roots[0]).toBe('G:\\游戏\\Steam');
    expect(roots.filter((path) => path.toLowerCase() === 'g:\\游戏\\steam')).toHaveLength(1);
    expect(roots.every(isAbsolute)).toBe(true);
    expect(execute).toHaveBeenLastCalledWith(
      expect.stringMatching(/WindowsPowerShell.*powershell\.exe$/),
      expect.arrayContaining(['-NoProfile', '-NonInteractive']),
      expect.objectContaining({ windowsHide: true, timeout: 4000, encoding: 'utf8' }),
      expect.any(Function),
    );
  });

  it.each(['blocked', 'invalid-json', 'wrong-shape'])(
    'falls back when registry discovery is %s',
    async (failure) => {
      vi.stubEnv('ProgramFiles(x86)', 'R:\\Programs (x86)');
      execute.mockImplementation((_file, _args, _options, callback) => {
        callback(
          failure === 'blocked' ? new Error('Access denied') : null,
          failure === 'wrong-shape' ? '{}' : 'invalid',
          '',
        );
      });
      expect(await getSteamRoots()).toContain('R:\\Programs (x86)\\Steam');
    },
  );
});

describe('Steam game log directory detection', () => {
  it('finds logs beneath a custom Steam root without requiring a manifest', async () => {
    const root = join(await temp(), 'G 盘', '游戏', 'Steam');
    const expected = await log(root);
    expect(await findLogDirectory([root], now)).toBe(expected);
  });

  it('reads modern library metadata, escaped paths and BOM without following comments or nested app fields', async () => {
    const root = await temp();
    const library = join(root, '其他盘 游戏库');
    const decoy = join(root, 'decoy');
    await put(
      join(root, 'steamapps', 'libraryfolders.vdf'),
      `\uFEFF"libraryfolders" {
        // "path" ${JSON.stringify(decoy)}
        "0" { "path" ${JSON.stringify(library)} "apps" { "path" ${JSON.stringify(decoy)} } }
        "1" { "path" ${JSON.stringify(library)} }
        "metadata" { "path" ${JSON.stringify(decoy)} }
      }`,
    );
    await log(decoy, 0);
    const expected = await log(library, 10_000);
    expect(await findLogDirectory([root], now)).toBe(expected);
  });

  it('reads legacy numbered library paths from the older config location', async () => {
    const root = await temp();
    const library = join(root, 'legacy-library');
    await put(
      join(root, 'config', 'libraryfolders.vdf'),
      `"LibraryFolders" { "1" ${JSON.stringify(library)} }`,
    );
    const expected = await log(library);
    expect(await findLogDirectory([root], now)).toBe(expected);
  });

  it('uses the exact App ID and manifest installdir for a renamed Unicode game directory', async () => {
    const root = await temp();
    await manifest(root, 'Broken Arrow 正式版');
    const expected = await log(root, 5_000, 'Broken Arrow 正式版');
    expect(await findLogDirectory([root], now)).toBe(expected);
  });

  it('keeps a confirmed, fully installed empty GameLogs folder usable before the first log', async () => {
    const root = await temp();
    await manifest(root);
    await mkdir(logDir(root), { recursive: true });
    expect(await findLogDirectory([root], now)).toBe(logDir(root));
  });

  it.each([
    ['4', '999'],
    ['1024', '1604270'],
    ['', '1604270'],
  ])('does not trust an empty directory with StateFlags=%s and appid=%s', async (flags, appid) => {
    const root = await temp();
    await manifest(root, 'broken_arrow', flags, appid);
    await mkdir(logDir(root), { recursive: true });
    expect(await findLogDirectory([root], now)).toBe('');
  });

  it('rejects unconfirmed empty directories, unrelated text files and directories named like logs', async () => {
    const root = await temp();
    await put(join(logDir(root), 'debug.log'), 'unrelated log');
    await mkdir(join(logDir(root), 'Gamelog__directory.log'));
    expect(await findLogDirectory([root], now)).toBe('');
  });

  it('prefers an actively written native log over a stale confirmed installation', async () => {
    const base = await temp();
    const old = join(base, 'old');
    const current = join(base, 'current');
    await manifest(old);
    await log(old, 86_400_000);
    const expected = await log(current);
    expect(await findLogDirectory([old, current], now)).toBe(expected);
  });

  it('prefers a confirmed installation over idle unconfirmed remnants', async () => {
    const base = await temp();
    const old = join(base, 'old');
    const current = join(base, 'current');
    await log(old, 180_000);
    await manifest(current);
    await mkdir(logDir(current), { recursive: true });
    expect(await findLogDirectory([old, current], now)).toBe(logDir(current));
  });

  it('selects the newest native game log across equally confirmed installations and ignores newer unrelated logs', async () => {
    const base = await temp();
    const old = join(base, 'old');
    const current = join(base, 'current');
    await manifest(old);
    await manifest(current);
    await log(old, 40_000);
    await log(old, 0, 'broken_arrow', 'debug.txt');
    const expected = await log(current, 5_000, 'broken_arrow', 'GAMELOG__current.TXT');
    expect(await findLogDirectory([old, current], now)).toBe(expected);
  });

  it('continues through missing libraries, malformed metadata and file paths used as directories', async () => {
    const base = await temp();
    const bad = join(base, 'bad');
    const current = join(base, 'current');
    await put(
      join(bad, 'steamapps', 'libraryfolders.vdf'),
      '"libraryfolders" { "0" { "path" "unterminated',
    );
    await put(join(bad, 'steamapps', 'appmanifest_1604270.acf'), '"AppState" {');
    await put(logDir(bad), 'not a directory');
    const expected = await log(current);
    expect(await findLogDirectory([join(base, 'missing'), bad, current], now)).toBe(expected);
  });

  it('tries an older readable game log when the newest one is locked or unreadable', async () => {
    const root = await temp();
    const expected = await log(root, 40_000, 'broken_arrow', 'Gamelog__older.log');
    await log(root, 5_000, 'broken_arrow', 'Gamelog__locked.log');
    vi.mocked(open).mockRejectedValueOnce(
      Object.assign(new Error('Access denied'), { code: 'EACCES' }),
    );
    expect(await findLogDirectory([root], now)).toBe(expected);
  });

  it('does not report success for a confirmed folder whose only log is unreadable', async () => {
    const root = await temp();
    await manifest(root);
    await log(root);
    vi.mocked(open).mockRejectedValueOnce(
      Object.assign(new Error('Access denied'), { code: 'EACCES' }),
    );
    expect(await findLogDirectory([root], now)).toBe('');
  });

  it('continues when one log is removed between directory enumeration and stat', async () => {
    const root = await temp();
    const expected = await log(root);
    await log(root, 1_000, 'broken_arrow', 'Gamelog__removed.log');
    vi.mocked(stat).mockRejectedValueOnce(
      Object.assign(new Error('File removed'), { code: 'ENOENT' }),
    );
    expect(await findLogDirectory([root], now)).toBe(expected);
  });

  it.each(['../escape', '..\\escape', 'G:\\escape', '/escape', '.', '..'])(
    'rejects escaping manifest installdir %s',
    async (name) => {
      const root = await temp();
      await manifest(root, name);
      expect(await findLogDirectory([root], now)).toBe('');
    },
  );

  it('returns an empty result when no known library has usable game logs', async () => {
    expect(await findLogDirectory([], now)).toBe('');
    expect(await findLogDirectory([join(await temp(), 'missing'), 'relative'], now)).toBe('');
  });
});
