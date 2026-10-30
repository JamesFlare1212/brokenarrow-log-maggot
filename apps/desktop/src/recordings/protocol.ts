import { protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
export class ReplayProtocol {
  private tokens = new Map<string, { path: string; expires: number; active: boolean }>();
  private closed = false;
  private generation = 0;
  register(): void {
    this.closed = false;
    protocol.handle('ba-replay', async (request) => {
      const url = new URL(request.url),
        entry = this.tokens.get(url.hostname);
      if (!entry || (!entry.active && entry.expires < Date.now()))
        return new Response(null, { status: 404 });
      try {
        const info = await stat(entry.path),
          range = request.headers.get('range');
        let start = 0,
          end = info.size - 1,
          partial = false;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2]))
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${info.size}` },
            });
          if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
          else start = Number(match[1]);
          if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
          if (start > end || start >= info.size)
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${info.size}` },
            });
          partial = true;
        }
        const headers: Record<string, string> = {
          'Content-Type': 'video/webm',
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Cache-Control': 'no-store',
        };
        if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
        return new Response(
          request.method === 'HEAD'
            ? null
            : (Readable.toWeb(
                createReadStream(entry.path, { start, end }),
              ) as ReadableStream<Uint8Array>),
          { status: partial ? 206 : 200, headers },
        );
      } catch {
        return new Response(null, { status: 404 });
      }
    });
  }
  url(path: string): string {
    return this.issue(path, false);
  }
  lease(path: string): string {
    return this.issue(path, true);
  }
  async withSession(run: () => Promise<{ url: string }>): Promise<{ url: string }> {
    if (this.closed) throw new Error('Replay session has closed');
    const generation = this.generation;
    const result = await run();
    if (generation !== this.generation || this.closed) {
      this.release(result.url);
      throw new Error('Replay session has changed');
    }
    return result;
  }
  private issue(path: string, active: boolean): string {
    if (this.closed) throw new Error('Replay session has closed');
    for (const [token, entry] of this.tokens)
      if (!entry.active && entry.expires < Date.now()) this.tokens.delete(token);
    if (this.tokens.size >= 128) {
      const inactive = [...this.tokens].find(([, entry]) => !entry.active);
      if (!inactive) throw new Error('REPLAY_PLAYBACK_LIMIT');
      this.tokens.delete(inactive[0]);
    }
    const token = randomUUID();
    this.tokens.set(token, { path, expires: Date.now() + 7200000, active });
    return `ba-replay://${token}/video.webm`;
  }
  release(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'ba-replay:') this.tokens.delete(parsed.hostname);
    } catch {
      // Ignore an already-ended or invalid playback handle during teardown.
    }
  }
  clear(): void {
    this.generation++;
    this.tokens.clear();
  }
  close(): void {
    this.closed = true;
    this.clear();
    protocol.unhandle('ba-replay');
  }
}
