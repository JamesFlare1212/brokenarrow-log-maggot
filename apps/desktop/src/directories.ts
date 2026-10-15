import { dialog, shell } from 'electron';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function selectDirectory(kind: 'logs' | 'replays' | 'decks'): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: kind === 'logs' ? 'GameLogs' : kind === 'decks' ? 'Decks' : 'Recordings',
    properties: kind === 'replays' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
}
export async function detectLogDirectory(): Promise<string> {
  const roots = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'E:\\Steam',
    'F:\\Steam',
  ];
  const libraries = new Set(roots);
  for (const root of roots) {
    try {
      const raw = await readFile(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const match of raw.matchAll(/"path"\s*"([^"]+)"/g))
        if (match[1]) libraries.add(match[1].replace(/\\\\/g, '\\'));
    } catch {
      /* A machine may not have this Steam root. */
    }
  }
  for (const root of libraries) {
    const dir = join(root, 'steamapps', 'common', 'broken_arrow', 'GameLogs');
    if (
      await stat(dir)
        .then((s) => s.isDirectory())
        .catch(() => false)
    )
      return dir;
  }
  return '';
}
export async function openPath(path: string): Promise<void> {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}
