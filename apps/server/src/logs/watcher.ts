import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import type { WatcherStatus } from '@ba/contracts';
import { errorMessage } from '@ba/shared';
import { LogParser } from './parser';
export class LogWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private polling: { generation: number; done: Promise<void> } | null = null;
  private offset = 0;
  private decoder = new StringDecoder('utf8');
  private pending = '';
  private pendingRecovering = false;
  private recoveryEnd = 0;
  private identity = '';
  private state: WatcherStatus = {
    dir: '',
    file: null,
    listening: false,
    recovering: false,
    error: null,
    live: false,
    checkedAt: null,
    checking: false,
  };
  constructor(
    private parser: LogParser,
    private changed: (status: WatcherStatus) => void,
  ) {}
  status(): WatcherStatus {
    return { ...this.state };
  }
  start(dir: string): void {
    this.stop();
    this.state.dir = dir;
    this.state.listening = !!dir;
    this.changed(this.status());
    if (!dir) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 1500);
  }
  stop(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state.listening = false;
    this.state.error = null;
    this.state.recovering = false;
    this.state.live = false;
    this.state.checkedAt = null;
    this.state.checking = false;
    this.clear();
    this.parser.reset();
  }
  private clear(): void {
    this.offset = 0;
    this.pending = '';
    this.pendingRecovering = false;
    this.recoveryEnd = 0;
    this.decoder = new StringDecoder('utf8');
    this.identity = '';
    this.state.file = null;
  }
  poll(): Promise<void> {
    if (this.polling)
      return this.polling.generation === this.generation
        ? this.polling.done
        : this.polling.done.then(() => this.poll());
    const generation = this.generation;
    const done = this.inspect().finally(() => {
      if (this.polling?.done === done) this.polling = null;
    });
    this.polling = { generation, done };
    return done;
  }
  private async inspect(): Promise<void> {
    if (!this.state.listening) return;
    const generation = this.generation;
    const retrying = this.state.error !== null;
    this.state.checking = true;
    try {
      const entries = await readdir(this.state.dir, { withFileTypes: true });
      const candidates = await Promise.all(
        entries
          .filter((e) => e.isFile() && /\.(log|txt)$/i.test(e.name))
          .map(async (e) => {
            const path = join(this.state.dir, e.name);
            return { path, info: await stat(path), native: /^Gamelog__/i.test(e.name) };
          }),
      );
      if (generation !== this.generation) return;
      candidates.sort(
        (a, b) => Number(b.native) - Number(a.native) || b.info.mtimeMs - a.info.mtimeMs,
      );
      const selected = candidates[0];
      if (!selected) {
        if (this.state.file) {
          this.clear();
          this.parser.reset();
        }
        this.state.error = null;
        this.state.live = false;
        this.state.recovering = false;
        this.state.checkedAt = Date.now();
        this.state.checking = false;
        this.changed(this.status());
        return;
      }
      const identity = selected.path + ':' + selected.info.ino + ':' + selected.info.birthtimeMs;
      this.state.live = Date.now() - selected.info.mtimeMs < 120000;
      if (identity !== this.identity || selected.info.size < this.offset) {
        this.clear();
        this.identity = identity;
        this.state.file = selected.path;
        this.parser.reset(selected.path);
        this.recoveryEnd = selected.info.size;
      }
      const recovering = this.offset < this.recoveryEnd;
      const startingOffset = this.offset;
      this.state.recovering = recovering;
      this.changed(this.status());
      const end = selected.info.size,
        handle = await open(selected.path, 'r');
      try {
        const buffer = Buffer.alloc(64 * 1024);
        while (this.offset < end && generation === this.generation) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, end - this.offset),
            this.offset,
          );
          if (generation !== this.generation) break;
          if (!bytesRead) throw new Error('Log file changed before the current read completed');
          this.offset += bytesRead;
          const firstRecovering = this.pendingRecovering || recovering;
          this.pending += this.decoder.write(buffer.subarray(0, bytesRead));
          const lines = this.pending.split('\n');
          this.pending = lines.pop() ?? '';
          if (lines.length) {
            this.parser.feed(lines.slice(0, 1), firstRecovering);
            if (lines.length > 1) this.parser.feed(lines.slice(1), recovering);
            this.pendingRecovering = recovering && buffer[bytesRead - 1] !== 10;
          } else this.pendingRecovering = firstRecovering;
          await yieldLoop();
        }
      } finally {
        await handle.close();
      }
      if (generation !== this.generation) return;
      this.state.error = null;
      this.state.checkedAt = Date.now();
      this.state.checking = false;
      if (
        recovering ||
        retrying ||
        this.offset !== startingOffset ||
        this.parser.snapshot().recovering
      ) {
        this.parser.recovered();
        this.state.recovering = false;
      }
      this.changed(this.status());
    } catch (error) {
      if (generation === this.generation) {
        this.state.error = errorMessage(error);
        this.state.live = false;
        this.state.recovering = false;
        this.state.checking = false;
        this.changed(this.status());
      }
    }
  }
}
