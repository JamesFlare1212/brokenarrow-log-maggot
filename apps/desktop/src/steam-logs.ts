import { execFile } from 'node:child_process';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parseVdf, type VdfObject } from './steam-vdf';

const APP_ID = '1604270';
const LIVE_WINDOW_MS = 120_000;
// A static script with UTF-8 output preserves non-ASCII installation paths. No user input
// is interpolated into PowerShell, and both registry views are opened explicitly.
const STEAM_ROOTS_SCRIPT = String.raw`
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$baRoots = @()
foreach ($baHive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach ($baView in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $baBase = $null
    $baKey = $null
    try {
      $baBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey($baHive, $baView)
      $baKey = $baBase.OpenSubKey('Software\Valve\Steam')
      if ($baKey) {
        foreach ($baName in @('SteamPath', 'InstallPath')) {
          $baValue = $baKey.GetValue($baName)
          if ($baValue -is [string] -and $baValue) { $baRoots += $baValue }
        }
      }
    } catch {} finally {
      if ($baKey) { $baKey.Dispose() }
      if ($baBase) { $baBase.Dispose() }
    }
  }
}
ConvertTo-Json -InputObject @($baRoots) -Compress
`;

function uniquePaths(paths: readonly string[]): string[] {
  const result = new Map<string, string>();
  for (const path of paths) {
    if (!isAbsolute(path)) continue;
    const normalized = resolve(path);
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (!result.has(key)) result.set(key, normalized);
  }
  return [...result.values()];
}

export async function getSteamRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  let registered: string[] = [];
  try {
    const stdout = await new Promise<string>((yes, no) => {
      execFile(
        join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', STEAM_ROOTS_SCRIPT],
        { encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024 },
        (error, output) => (error ? no(error) : yes(output)),
      );
    });
    const values: unknown = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
    if (Array.isArray(values))
      registered = values.filter((value): value is string => typeof value === 'string');
  } catch {
    // Registry access can be unavailable; known installation locations remain usable.
  }
  const defaults = [
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files',
  ].map((base) => join(base, 'Steam'));
  return uniquePaths([
    ...registered,
    ...defaults,
    join(process.env.SystemDrive || 'C:', '\\Steam'),
    'D:\\Steam',
    'E:\\Steam',
    'F:\\Steam',
  ]);
}

async function metadata(path: string): Promise<VdfObject> {
  try {
    return parseVdf(await readFile(path, 'utf8'));
  } catch {
    // Missing, inaccessible or partially rewritten metadata must not hide other libraries.
    return {};
  }
}

interface Candidate {
  dir: string;
  installed: boolean;
  latestLog: number | null;
}

async function inspect(dir: string, installed: boolean): Promise<Candidate | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const names = entries.filter(
      (entry) => entry.isFile() && /^Gamelog__.*\.(log|txt)$/i.test(entry.name),
    );
    const files = await Promise.all(
      names.map(async (entry) => {
        const path = join(dir, entry.name);
        try {
          return { path, info: await stat(path) };
        } catch {
          return null;
        }
      }),
    );
    const readable = files.filter((file) => file !== null).filter((file) => file.info.isFile());
    readable.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    for (const file of readable) {
      try {
        const handle = await open(file.path, 'r');
        try {
          await handle.read(Buffer.alloc(1), 0, 1, 0);
          return { dir, installed, latestLog: file.info.mtimeMs };
        } finally {
          await handle.close();
        }
      } catch {
        // Logs can rotate or become inaccessible between enumeration and opening.
      }
    }
    // An installed game may not have produced its first log yet. Unverified empty folders
    // and folders whose existing logs are all unreadable are not successful detections.
    return installed && names.length === 0 ? { dir, installed, latestLog: null } : null;
  } catch {
    return null;
  }
}

/** Search only known Steam roots and their declared libraries, without a disk-wide scan. */
export async function findLogDirectory(
  roots: readonly string[],
  now = Date.now(),
): Promise<string> {
  const knownRoots = uniquePaths(roots);
  const declared = await Promise.all(
    knownRoots.flatMap((root) =>
      ['steamapps', 'config'].map(async (folder) => {
        const data = (await metadata(join(root, folder, 'libraryfolders.vdf'))).libraryfolders;
        if (!data || typeof data === 'string') return [];
        return Object.entries(data).flatMap(([key, value]) => {
          if (!/^\d+$/.test(key)) return [];
          const path = typeof value === 'string' ? value : value.path;
          return typeof path === 'string' ? [path] : [];
        });
      }),
    ),
  );
  const libraries = uniquePaths([...knownRoots, ...declared.flat()]);
  const found = await Promise.all(
    libraries.map(async (library) => {
      const common = join(library, 'steamapps', 'common');
      const manifest = (await metadata(join(library, 'steamapps', `appmanifest_${APP_ID}.acf`)))
        .appstate;
      const candidates = new Map<string, boolean>();
      if (manifest && typeof manifest !== 'string' && manifest.appid === APP_ID) {
        const name = manifest.installdir;
        // Steam's installdir is a folder name underneath steamapps/common.
        if (
          typeof name === 'string' &&
          name &&
          name !== '.' &&
          name !== '..' &&
          !/[\\/:<>"|?*\x00-\x1f]/.test(name)
        ) {
          const flags = manifest.stateflags;
          const installed =
            typeof flags === 'string' && /^\d+$/.test(flags) && (Number(flags) & 4) !== 0;
          candidates.set(join(common, name, 'GameLogs'), installed);
        }
      }
      const fallback = join(common, 'broken_arrow', 'GameLogs');
      if (!candidates.has(fallback)) candidates.set(fallback, false);
      return Promise.all([...candidates].map(([dir, installed]) => inspect(dir, installed)));
    }),
  );
  const candidates = found.flat().filter((candidate) => candidate !== null);
  const live = (candidate: Candidate) =>
    candidate.latestLog !== null && now - candidate.latestLog < LIVE_WINDOW_MS;
  candidates.sort(
    (a, b) =>
      Number(live(b)) - Number(live(a)) ||
      Number(b.installed) - Number(a.installed) ||
      (b.latestLog ?? -1) - (a.latestLog ?? -1),
  );
  return candidates[0]?.dir ?? '';
}

export async function detectLogDirectory(): Promise<string> {
  return findLogDirectory(await getSteamRoots());
}
