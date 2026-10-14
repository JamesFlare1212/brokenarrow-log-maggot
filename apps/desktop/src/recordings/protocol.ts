import { protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
export class ReplayProtocol {
  private tokens = new Map<string, { path: string; expires: number }>();
  register(): void {
    protocol.handle('ba-replay', async (request) => {
      const url = new URL(request.url),
        entry = this.tokens.get(url.hostname);
      if (!entry || entry.expires < Date.now()) return new Response(null, { status: 404 });
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
    for (const [token, entry] of this.tokens)
      if (entry.expires < Date.now()) this.tokens.delete(token);
    if (this.tokens.size >= 128) this.tokens.delete(this.tokens.keys().next().value || '');
    const token = randomUUID();
    this.tokens.set(token, { path, expires: Date.now() + 7200000 });
    return `ba-replay://${token}/video.webm`;
  }
  close(): void {
    this.tokens.clear();
    protocol.unhandle('ba-replay');
  }
}
