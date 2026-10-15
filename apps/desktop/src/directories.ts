import { dialog, shell } from 'electron';
export { detectLogDirectory } from './steam-logs';
export async function selectDirectory(kind: 'logs' | 'replays' | 'decks'): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: kind === 'logs' ? 'GameLogs' : kind === 'decks' ? 'Decks' : 'Recordings',
    properties: kind === 'replays' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
}
export async function openPath(path: string): Promise<void> {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}
