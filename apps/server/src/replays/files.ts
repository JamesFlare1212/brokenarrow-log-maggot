import { join, resolve } from 'node:path';
import { readdir, stat, unlink, mkdir, rename, copyFile, lstat } from 'node:fs/promises';
import type { Replay, TeamId } from '@ba/contracts';
import { mapName, recordingExtension, object } from '@ba/shared';
import type { Database } from '../storage/database';
import { childPath } from '../files/paths';
export function replayName(
  meta: {
    fid: string | null;
    id: string | null;
    name: string;
    teamId: TeamId;
    mapId: number | null;
  },
  now = Date.now(),
  extension: '.mp4' | '.webm' = '.webm',
): string {
  return `${meta.fid || 'nofid'}__${meta.id || '0'}__${meta.teamId ?? ''}__${meta.mapId ?? ''}__${now}__${Buffer.from(meta.name).toString('hex')}${extension}`;
}
export class ReplayFiles {
  constructor(
    private db: Database,
    private userDir: string,
  ) {}
  dir(): string {
    return this.db.config().replaySaveDir || join(this.userDir, 'replays');
  }
  async list(): Promise<Replay[]> {
    const dir = this.dir();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (object(error).code === 'ENOENT') return [];
      throw error;
    }
    const out: Replay[] = [];
    for (const f of entries) {
      if (!f.isFile() || !/\.(mp4|webm)$/i.test(f.name) || f.name.startsWith('.')) continue;
      const extension = recordingExtension(f.name);
      const s = await stat(childPath(dir, f.name, extension)),
        parts = f.name.slice(0, -extension.length).split('__'),
        fid = /^\d+$/.test(parts[0] || '') ? parts[0] || null : null,
        match = fid ? this.db.match(fid) : null,
        t = parts[2] ? Number(parts[2]) : null,
        teamId: TeamId = t === 0 || t === 1 || t === 100 ? t : null;
      out.push({
        id: f.name,
        fid,
        map: match?.map || mapName(Number(parts[3]) || null),
        uploaderId: parts[1] || null,
        uploaderName: parts.length === 6 ? Buffer.from(parts[5] || '', 'hex').toString('utf8') : '',
        teamId,
        size: s.size,
        createdAt: s.mtimeMs,
        durationSec:
          this.db.state<{ duration: number } | null>('replay:' + f.name, null)?.duration ??
          match?.durationSec ??
          null,
        test: (parts[0] || '').startsWith('-') || f.name.startsWith('test_'),
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  async path(name: string): Promise<string> {
    const path = childPath(this.dir(), name, recordingExtension(name)),
      s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink()) throw new Error('Not a local recording');
    return path;
  }
  async remove(name: string): Promise<{ removed: boolean }> {
    await unlink(await this.path(name));
    this.db.sql.prepare('DELETE FROM app_state WHERE key=?').run('replay:' + name);
    return { removed: true };
  }
  async clean(days: number): Promise<{ removed: number }> {
    const list = await this.list(),
      cutoff = Date.now() - days * 86400000;
    let removed = 0;
    for (const r of list)
      if (days === 0 || r.createdAt < cutoff) {
        await this.remove(r.id);
        removed++;
      }
    return { removed };
  }
  async move(from: string, to: string): Promise<{ moved: number; failed: string[] }> {
    if (resolve(from) === resolve(to)) return { moved: 0, failed: [] };
    await mkdir(to, { recursive: true });
    const entries = await readdir(from, { withFileTypes: true });
    let moved = 0;
    const failed: string[] = [];
    for (const f of entries) {
      if (!f.isFile() || !/\.(mp4|webm)$/i.test(f.name) || f.name.startsWith('.')) continue;
      const extension = recordingExtension(f.name);
      const source = childPath(from, f.name, extension),
        dest = childPath(to, f.name, extension);
      try {
        if (
          await stat(dest)
            .then(() => true)
            .catch(() => false)
        )
          throw new Error('Destination already exists');
        try {
          await rename(source, dest);
        } catch (error) {
          if (object(error).code !== 'EXDEV') throw error;
          await copyFile(source, dest, 1);
          const a = await stat(source),
            b = await stat(dest);
          if (a.size !== b.size) throw new Error('Copy size mismatch');
          await unlink(source);
        }
        moved++;
      } catch {
        failed.push(f.name);
      }
    }
    return { moved, failed };
  }
}
