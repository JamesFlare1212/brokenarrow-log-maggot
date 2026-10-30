import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readdir, stat, unlink, mkdir, mkdtemp, rmdir, lstat } from 'node:fs/promises';
import type {
  Replay,
  ReplayLibrary,
  ReplayDeletePlan,
  ReplayDeleteResult,
  ReplayMoveResult,
  TeamId,
} from '@ba/contracts';
import { mapName, filename, object, errorMessage } from '@ba/shared';
import type { Database } from '../storage/database';
import { childPath } from '../files/paths';
import { copyVerifiedRecording, publishRecording, recordingDigest } from './migration';
export function replayName(
  meta: {
    fid: string | null;
    id: string | null;
    name: string;
    teamId: TeamId;
    mapId: number | null;
  },
  now = Date.now(),
): string {
  return `${meta.fid || 'nofid'}__${meta.id || '0'}__${meta.teamId ?? ''}__${meta.mapId ?? ''}__${now}__${Buffer.from(meta.name).toString('hex')}.webm`;
}
export class ReplayFiles {
  private queue: Promise<unknown> = Promise.resolve();
  private deletions = new Map<
    string,
    {
      plan: ReplayDeletePlan;
      identities: Map<string, string>;
      directoryIdentity: string | null;
      expiresAt: number;
    }
  >();
  constructor(
    private db: Database,
    private userDir: string,
  ) {}
  dir(): string {
    return this.db.config().replaySaveDir || join(this.userDir, 'replays');
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
  private checkDirectory(directory: string): void {
    const key = (path: string) =>
      process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if (key(this.dir()) !== key(directory)) throw new Error('REPLAY_DIRECTORY_CHANGED');
  }
  private async directoryIdentity(directory: string): Promise<string | null> {
    try {
      const info = await stat(directory);
      return `${info.dev}:${info.ino}`;
    } catch (error) {
      if (object(error).code === 'ENOENT') return null;
      throw error;
    }
  }
  private async identity(directory: string, name: string): Promise<string> {
    const info = await lstat(childPath(directory, name, '.webm'));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Not a local recording');
    return `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.ctimeMs}:${info.mtimeMs}:${info.size}`;
  }
  async library(): Promise<ReplayLibrary> {
    const directory = this.dir();
    return {
      directory,
      recordings: await this.list(directory),
      migration: this.db.state<ReplayMoveResult | null>('replay:lastMigration', null),
    };
  }
  async list(dir = this.dir()): Promise<Replay[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (object(error).code === 'ENOENT') return [];
      throw error;
    }
    const out: Replay[] = [];
    for (const f of entries) {
      if (!f.isFile() || !f.name.toLowerCase().endsWith('.webm') || f.name.startsWith('.'))
        continue;
      filename(f.name, '.webm');
      let s;
      try {
        s = await lstat(childPath(dir, f.name, '.webm'));
      } catch (error) {
        if (object(error).code === 'ENOENT') continue;
        throw error;
      }
      if (!s.isFile() || s.isSymbolicLink()) continue;
      const parts = f.name.slice(0, -5).split('__'),
        fid = /^\d+$/.test(parts[0] || '') ? parts[0] || null : null,
        match = fid ? this.db.match(fid) : null,
        t = parts[2] ? Number(parts[2]) : null,
        teamId: TeamId = t === 0 || t === 1 || t === 100 ? t : null,
        recordedAt =
          parts.length === 6 && /^\d{1,16}$/.test(parts[4] || '') ? Number(parts[4]) : null,
        hasRecordingTime =
          recordedAt !== null &&
          Number.isSafeInteger(recordedAt) &&
          recordedAt > 0 &&
          Number.isFinite(new Date(recordedAt).getTime());
      out.push({
        id: f.name,
        fid,
        map: match?.map || mapName(Number(parts[3]) || null),
        uploaderId: parts[1] || null,
        uploaderName: parts.length === 6 ? Buffer.from(parts[5] || '', 'hex').toString('utf8') : '',
        teamId,
        size: s.size,
        createdAt: hasRecordingTime ? recordedAt : s.mtimeMs,
        dateSource: hasRecordingTime ? 'recording' : 'modified',
        durationSec:
          this.db.state<{ duration: number } | null>('replay:' + f.name, null)?.duration ??
          match?.durationSec ??
          null,
        test: (parts[0] || '').startsWith('-') || f.name.startsWith('test_'),
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  async path(name: string, directory = this.dir()): Promise<string> {
    const path = childPath(directory, name, '.webm'),
      s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink()) throw new Error('Not a local recording');
    return path;
  }
  private async removeAt(directory: string, name: string): Promise<void> {
    const path = await this.path(name, directory);
    const key = 'replay:' + name;
    let metadata: unknown;
    try {
      metadata = this.db.state<unknown>(key, null);
      this.db.sql.prepare('DELETE FROM app_state WHERE key=?').run(key);
    } catch (error) {
      throw new Error('REPLAY_METADATA_DELETE_FAILED', { cause: error });
    }
    try {
      await unlink(path);
    } catch (error) {
      if (metadata !== null && object(error).code !== 'ENOENT') {
        try {
          this.db.setState(key, metadata);
        } catch (restoreError) {
          throw new Error('REPLAY_METADATA_RECOVERY_FAILED', { cause: restoreError });
        }
      }
      if (object(error).code === 'ENOENT') throw error;
      throw new Error('REPLAY_FILE_DELETE_FAILED', { cause: error });
    }
  }
  planDelete(directory: string, names: string[]): Promise<ReplayDeletePlan> {
    return this.plan(directory, names, null);
  }
  planClean(directory: string, days: number): Promise<ReplayDeletePlan> {
    return this.plan(directory, null, days);
  }
  private plan(
    directory: string,
    names: string[] | null,
    days: number | null,
  ): Promise<ReplayDeletePlan> {
    return this.exclusive(async () => {
      this.checkDirectory(directory);
      const createdAt = Date.now();
      const list = await this.list(directory);
      const selected = names ? new Set(names.map((name) => filename(name, '.webm'))) : null;
      if (
        selected &&
        [...selected].some((name) => !list.some((recording) => recording.id === name))
      )
        throw new Error('REPLAY_TARGET_CHANGED');
      const recordings = list.filter((recording) =>
        selected
          ? selected.has(recording.id)
          : days === 0 || recording.createdAt < createdAt - days! * 86400000,
      );
      const identities = new Map<string, string>();
      for (const recording of recordings)
        identities.set(recording.id, await this.identity(directory, recording.id));
      const plan: ReplayDeletePlan = {
        token: randomUUID(),
        directory,
        createdAt,
        days,
        recordings,
      };
      for (const [token, snapshot] of this.deletions)
        if (snapshot.expiresAt <= createdAt) this.deletions.delete(token);
      while (this.deletions.size >= 8) this.deletions.delete(this.deletions.keys().next().value!);
      this.deletions.set(plan.token, {
        plan,
        identities,
        directoryIdentity: await this.directoryIdentity(directory),
        expiresAt: createdAt + 10 * 60000,
      });
      return structuredClone(plan);
    });
  }
  executeDelete(token: string, kind: 'delete' | 'clean'): Promise<ReplayDeleteResult> {
    return this.exclusive(async () => {
      const snapshot = this.deletions.get(token);
      this.deletions.delete(token);
      if (
        !snapshot ||
        snapshot.expiresAt <= Date.now() ||
        (kind === 'delete') !== (snapshot.plan.days === null)
      )
        throw new Error('REPLAY_DELETE_EXPIRED');
      const { plan } = snapshot;
      this.checkDirectory(plan.directory);
      if ((await this.directoryIdentity(plan.directory)) !== snapshot.directoryIdentity)
        throw new Error('REPLAY_DIRECTORY_CHANGED');
      const result: ReplayDeleteResult = {
        directory: plan.directory,
        removed: 0,
        completed: [],
        failed: [],
        skipped: [],
      };
      for (const recording of plan.recordings) {
        try {
          if (
            (await this.identity(plan.directory, recording.id)) !==
            snapshot.identities.get(recording.id)
          )
            throw new Error('REPLAY_TARGET_CHANGED');
          await this.removeAt(plan.directory, recording.id);
          result.completed.push(recording.id);
          result.removed++;
        } catch (error) {
          if (object(error).code === 'ENOENT') result.skipped.push(recording.id);
          else result.failed.push({ name: recording.id, message: errorMessage(error) });
        }
      }
      return result;
    });
  }
  move(from: string, to: string, guard: () => void = () => {}): Promise<ReplayMoveResult> {
    return this.exclusive(() => this.moveAt(from, to, guard));
  }
  private async moveAt(from: string, to: string, guard: () => void): Promise<ReplayMoveResult> {
    this.checkDirectory(from);
    guard();
    const result: ReplayMoveResult = {
      createdAt: Date.now(),
      from,
      to,
      directory: this.dir(),
      committed: false,
      moved: 0,
      copied: [],
      retained: [],
      destinationCopies: [],
      failed: [],
    };
    const namesAt = async (directory: string) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
        if (object(error).code === 'ENOENT') return [];
        throw error;
      });
      return entries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith('.webm') && !entry.name.startsWith('.'),
        )
        .map((entry) => entry.name)
        .sort();
    };
    const names = await namesAt(from);
    result.retained = [...names];
    const originalDirectory = await this.directoryIdentity(from);
    const originals = new Map<string, string>();
    const digests = new Map<string, string>();
    const published = new Map<string, string | null>();
    let stage: string | null = null,
      currentName = '';
    const fail = (name: string, error: unknown) =>
      result.failed.push({ name, message: errorMessage(error) });
    try {
      await mkdir(to, { recursive: true });
      const destinationDirectory = await this.directoryIdentity(to);
      if (originalDirectory === destinationDirectory) {
        this.checkDirectory(from);
        guard();
        this.db.updateConfig({ replaySaveDir: to });
        result.committed = true;
        result.directory = to;
        result.retained = [];
        return result;
      }
      for (const name of names) {
        currentName = name;
        originals.set(name, await this.identity(from, name));
        try {
          await lstat(childPath(to, name, '.webm'));
          fail(name, new Error('REPLAY_MIGRATION_COLLISION'));
        } catch (error) {
          if (object(error).code !== 'ENOENT') throw error;
        }
      }
      if (result.failed.length) return result;
      stage = await mkdtemp(join(to, '.baradar-migration-'));
      for (const name of names) {
        currentName = name;
        digests.set(
          name,
          await copyVerifiedRecording(
            childPath(from, name, '.webm'),
            childPath(stage, name, '.webm'),
          ),
        );
        if ((await this.identity(from, name)) !== originals.get(name))
          throw new Error('REPLAY_TARGET_CHANGED');
      }
      for (const name of names) {
        currentName = name;
        await publishRecording(childPath(stage, name, '.webm'), childPath(to, name, '.webm'));
        published.set(name, null);
        published.set(name, await this.identity(to, name));
      }
      currentName = '';
      if (
        (await this.directoryIdentity(from)) !== originalDirectory ||
        (await this.directoryIdentity(to)) !== destinationDirectory ||
        JSON.stringify(await namesAt(from)) !== JSON.stringify(names)
      )
        throw new Error('REPLAY_TARGET_CHANGED');
      for (const name of names) {
        currentName = name;
        if ((await recordingDigest(childPath(to, name, '.webm'))) !== digests.get(name))
          throw new Error('REPLAY_MIGRATION_COPY_MISMATCH');
        if (
          (await this.identity(from, name)) !== originals.get(name) ||
          (await this.identity(to, name)) !== published.get(name)
        )
          throw new Error('REPLAY_TARGET_CHANGED');
      }
      currentName = '';
      this.checkDirectory(from);
      guard();
      result.committed = true;
      result.directory = to;
      result.copied = [...names];
      try {
        this.db.transaction(() => {
          this.db.updateConfig({ replaySaveDir: to });
          this.db.setState('replay:lastMigration', result);
        });
      } catch (error) {
        result.committed = false;
        result.directory = this.dir();
        result.copied = [];
        throw error;
      }
      // The complete verified library is now selected before any original is removed.
      for (const name of names) {
        try {
          if ((await this.identity(from, name)) !== originals.get(name))
            throw new Error('REPLAY_TARGET_CHANGED');
          await unlink(childPath(from, name, '.webm'));
          result.retained = result.retained.filter((item) => item !== name);
          result.moved++;
        } catch (error) {
          fail(name, error);
        }
      }
    } catch (error) {
      fail(currentName, error);
      for (const [name, version] of published) {
        try {
          if (!version || (await this.identity(to, name)) !== version)
            throw new Error('REPLAY_TARGET_CHANGED');
          await unlink(childPath(to, name, '.webm'));
        } catch (cleanupError) {
          result.destinationCopies.push(name);
          fail(name, cleanupError);
        }
      }
    } finally {
      if (stage) {
        for (const name of names)
          await unlink(childPath(stage, name, '.webm')).catch((error) => {
            if (object(error).code !== 'ENOENT') fail(name, error);
          });
        await rmdir(stage).catch((error) => fail(stage!, error));
      }
      result.directory = this.dir();
      try {
        this.db.setState('replay:lastMigration', result);
      } catch (error) {
        fail('', error);
      }
    }
    return result;
  }
}
