import { open, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import type { Match } from '@ba/contracts';
import { errorMessage } from '@ba/shared';
import type { Database } from '../storage/database';
import { LogParser } from './parser';

/** Historical imports never feed the live session parser or its side effects. */
export class LogArchive {
  private active: { dir: string; abort: AbortController; promise: Promise<void> } | null = null;

  constructor(
    private db: Database,
    private changed: () => void = () => {},
  ) {}

  scan(directory: string): Promise<void> {
    if (!directory) return Promise.resolve();
    const dir = resolve(directory);
    if (this.active?.dir === dir) return this.active.promise;
    this.cancel();
    const abort = new AbortController();
    const active = { dir, abort, promise: this.readDirectory(dir, abort.signal) };
    this.active = active;
    const clear = () => {
      if (this.active === active) this.active = null;
    };
    void active.promise.then(clear, clear);
    return active.promise;
  }

  cancel(): void {
    this.active?.abort.abort();
    this.active = null;
  }

  private async readDirectory(dir: string, signal: AbortSignal): Promise<void> {
    const errors: string[] = [];
    let imported = false;
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      // Ignore symbolic links so a linked directory cannot introduce cycles.
      for (const entry of entries) {
        if (signal.aborted) return;
        const path = join(directory, entry.name);
        try {
          if (entry.isDirectory()) await visit(path);
          else if (entry.isFile() && /\.(log|txt)$/i.test(entry.name)) {
            const info = await stat(path);
            const fingerprint = `${info.ino}:${info.birthtimeMs}:${info.size}:${info.mtimeMs}`;
            const key = `logArchive:v1:${path}`;
            if (this.db.state(key, '') === fingerprint) continue;
            const matches = await this.readFile(path, info.size, signal);
            if (signal.aborted) return;
            this.db.transaction(() => {
              for (const match of matches) {
                this.db.observe(match.players, match.endedAt ?? match.startedAt ?? 0);
                this.db.saveMatch(match, false);
              }
              // Commit the checkpoint with the matches so interrupted imports can retry.
              this.db.setState(key, fingerprint);
            });
            imported ||= matches.length > 0;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            errors.push(`${path}: ${errorMessage(error)}`);
        }
      }
    };
    try {
      await visit(dir);
    } finally {
      if (imported) this.changed();
    }
    if (!signal.aborted && errors.length) throw new Error(errors.join('\n'));
  }

  private async readFile(path: string, end: number, signal: AbortSignal): Promise<Match[]> {
    const matches = new Map<string, Match>();
    const parser = new LogParser((event) => {
      if (event.type === 'ended' || event.type === 'metadata')
        matches.set(event.match.sessionId, event.match);
    });
    parser.reset(path);
    const handle = await open(path, 'r');
    try {
      const decoder = new StringDecoder('utf8');
      const buffer = Buffer.alloc(64 * 1024);
      let offset = 0;
      let pending = '';
      while (offset < end && !signal.aborted) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, end - offset),
          offset,
        );
        if (!bytesRead) throw new Error('Log changed while reading; retry the scan');
        offset += bytesRead;
        pending += decoder.write(buffer.subarray(0, bytesRead));
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        parser.feed(lines, true);
        await yieldLoop();
      }
      if (signal.aborted) return [];
      // Older logs can end without a newline, or without a clean game-exit event.
      pending += decoder.end();
      if (pending) parser.feed([pending], true);
      const current = parser.snapshot().current;
      if (current) matches.set(current.sessionId, current);
      return [...matches.values()];
    } finally {
      await handle.close();
    }
  }
}
