import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import { readdir, stat, unlink, mkdir, rename, copyFile, lstat } from 'node:fs/promises';
import type { Replay, TeamId } from '@ba/contracts';
import { mapName, recordingExtension, object } from '@ba/shared';
import type { Database } from '../storage/database';
import { childPath } from '../files/paths';
function pathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
function fingerprint(info: Stats): string {
  return `${info.ino}:${info.birthtimeMs}:${info.size}:${info.mtimeMs}`;
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyCopy(source: string, dest: string, expected?: string) {
  const [beforeSource, beforeDest] = await Promise.all([lstat(source), lstat(dest)]);
  if (
    !beforeSource.isFile() ||
    beforeSource.isSymbolicLink() ||
    !beforeDest.isFile() ||
    beforeDest.isSymbolicLink() ||
    beforeSource.size !== beforeDest.size
  )
    throw new Error('Invalid recording copy');
  const [sourceHash, destHash] = await Promise.all([digest(source), digest(dest)]);
  const [afterSource, afterDest] = await Promise.all([lstat(source), lstat(dest)]);
  if (
    sourceHash !== destHash ||
    (expected !== undefined && sourceHash !== expected) ||
    fingerprint(beforeSource) !== fingerprint(afterSource) ||
    fingerprint(beforeDest) !== fingerprint(afterDest)
  )
    throw new Error('Recording changed during migration');
  return {
    source: fingerprint(afterSource),
    destination: fingerprint(afterDest),
    digest: sourceHash,
  };
}
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
  private moves: Promise<void> = Promise.resolve();
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
  move(
    from: string,
    to: string,
    validate: () => void = () => {},
  ): Promise<{ moved: number; failed: string[] }> {
    const task = this.moves.then(() => {
      validate();
      return this.moveFiles(from, to);
    });
    this.moves = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private async moveFiles(from: string, to: string): Promise<{ moved: number; failed: string[] }> {
    if (pathKey(from) === pathKey(to)) return { moved: 0, failed: [] };
    await mkdir(to, { recursive: true });
    const entries = await readdir(from, { withFileTypes: true });
    let moved = 0;
    const failed: string[] = [];
    for (const f of entries) {
      if (!f.isFile() || !/\.(mp4|webm)$/i.test(f.name) || f.name.startsWith('.')) continue;
      const extension = recordingExtension(f.name);
      const source = childPath(from, f.name, extension),
        dest = childPath(to, f.name, extension);
      const key =
        'replayMove:' +
        createHash('sha256')
          .update(JSON.stringify([pathKey(source), pathKey(dest)]))
          .digest('hex');
      try {
        const existing = await lstat(dest).catch((error: unknown) => {
          if (object(error).code === 'ENOENT') return null;
          throw error;
        });
        if (existing) {
          const saved = object(this.db.state(key, null));
          if (
            typeof saved.digest !== 'string' ||
            saved.destination !== fingerprint(existing) ||
            saved.source !== fingerprint(await lstat(source))
          )
            throw new Error('Destination already exists');
          await verifyCopy(source, dest, saved.digest);
          await unlink(source);
        } else {
          const before = await lstat(source);
          if (!before.isFile() || before.isSymbolicLink()) throw new Error('Not a local recording');
          try {
            await rename(source, dest);
          } catch (error) {
            if (object(error).code !== 'EXDEV') throw error;
            await copyFile(source, dest, 1);
            const copied = await verifyCopy(source, dest);
            if (copied.source !== fingerprint(before))
              throw new Error('Recording source changed during migration');
            // Persist ownership before removing the source, so a locked source can retry after restart.
            this.db.setState(key, copied);
            await unlink(source);
          }
        }
        this.db.sql.prepare('DELETE FROM app_state WHERE key=?').run(key);
        moved++;
      } catch {
        failed.push(f.name);
      }
    }
    return { moved, failed };
  }
}
