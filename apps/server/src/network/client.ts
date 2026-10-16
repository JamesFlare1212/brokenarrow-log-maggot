import { setTimeout as sleep } from 'node:timers/promises';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { object } from '@ba/shared';
import type { Database } from '../storage/database';
import { parsePlayerPage, validatePlayerInfo } from './player-page';
import { parseMatchPage, validateMatchInfo } from './match-page';
interface RequestOptions {
  force?: boolean;
  allowStale?: boolean;
  signal?: AbortSignal;
  health?: boolean;
  parse?: (raw: string) => unknown;
  invalidMessage?: string;
  fallback?: { path: string; parse: (raw: string) => unknown };
}
export interface DataResult {
  value: unknown;
  source: 'network' | 'cache' | 'stale';
  at: number;
  attempts?: number;
  status?: number;
}
export interface HttpPort {
  fetch: typeof fetch;
  offline?: boolean;
  challenge?: () => Promise<void>;
}
export function isChallenge(value: string): boolean {
  return /TencentEOCaptchaWidget|EO-Bot-Captcha-Token|Security Verification|__tst_status/.test(
    value,
  );
}
export class BatraceClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastAttempt = 0;
  private pending = new Map<string, Promise<DataResult>>();
  private lifetime = new AbortController();
  constructor(
    private db: Database,
    private http: HttpPort,
    private interval = 1200,
    private now: () => number = Date.now,
    private wait: (ms: number) => Promise<unknown> = (ms) => sleep(ms),
  ) {}
  async get(
    path: string,
    key: string,
    ttl: number,
    options: RequestOptions = {},
  ): Promise<DataResult> {
    this.lifetime.signal.throwIfAborted();
    if (this.http.offline) {
      const hit = this.db.cache(key, true, this.now());
      if (!hit) throw new Error('Offline real-data mode: no recorded response for this request');
      return { value: hit.value, source: 'stale', at: hit.at, attempts: 0 };
    }
    if (!options.force) {
      const hit = this.db.cache(key, false, this.now());
      if (hit) return { value: hit.value, source: 'cache', at: hit.at, attempts: 0 };
    }
    const pendingKey = key + (options.force ? ':force' : '');
    const existing = this.pending.get(pendingKey);
    if (existing) return existing;
    const task = this.request(path, key, ttl, options).finally(() =>
      this.pending.delete(pendingKey),
    );
    this.pending.set(pendingKey, task);
    return task;
  }
  private async request(
    path: string,
    key: string,
    ttl: number,
    options: RequestOptions,
  ): Promise<DataResult> {
    let last: unknown;
    let attempts = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        this.lifetime.signal.throwIfAborted();
        options.signal?.throwIfAborted();
        const run = async () => {
          const delay = Math.max(0, this.interval - (this.now() - this.lastAttempt));
          if (delay) await this.wait(delay);
          this.lifetime.signal.throwIfAborted();
          options.signal?.throwIfAborted();
          if (!options.health) attempts++;
          this.lastAttempt = this.now();
          const headers = object(this.db.state<unknown>('privateHeaders', {}));
          const safeHeaders = new Headers(
            Object.fromEntries(
              Object.entries(headers).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            ),
          );
          safeHeaders.delete('user-agent');
          const response = await this.http.fetch(BATRACE_ORIGIN + path, {
            headers: safeHeaders,
            signal: AbortSignal.any([
              this.lifetime.signal,
              AbortSignal.timeout(15000),
              ...(options.signal ? [options.signal] : []),
            ]),
          });
          const raw = await response.text(),
            html = response.headers.get('content-type')?.includes('text/html') || /^\s*</.test(raw);
          if (html && isChallenge(raw))
            return { challenge: true as const, status: response.status };
          if (!response.ok) {
            const error = new Error(`BATrace HTTP ${response.status}`);
            Object.assign(error, {
              status: response.status,
              retryAfter: Number(response.headers.get('retry-after')) * 1000,
              blocked:
                html &&
                response.headers.get('server')?.toLowerCase() === 'cloudflare' &&
                /cf-error-details|Sorry, you have been blocked/.test(raw),
              rayId: response.headers.get('cf-ray') ?? undefined,
            });
            throw error;
          }
          try {
            return {
              challenge: false as const,
              value: options.parse ? options.parse(raw) : (JSON.parse(raw) as unknown),
              status: response.status,
            };
          } catch {
            throw Object.assign(
              new Error(
                options.invalidMessage ??
                  (options.parse
                    ? 'BATrace returned incomplete player data'
                    : 'BATrace returned invalid JSON'),
              ),
              {
                invalidResponse: true,
                status: response.status,
              },
            );
          }
        };
        const scheduled = this.queue.then(run, run);
        this.queue = scheduled.catch(() => {});
        const result = await scheduled;
        if (result.challenge) {
          last = new Error('BATrace verification did not complete');
          if (options.health || !this.http.challenge)
            throw Object.assign(new Error('BATrace verification required'), {
              verification: true,
              status: result.status,
            });
          try {
            await this.http.challenge();
          } catch (error) {
            throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
              verification: true,
            });
          }
          continue;
        }
        this.lifetime.signal.throwIfAborted();
        const at = this.now();
        if (!options.health) this.db.saveCache(key, result.value, ttl, at);
        return { value: result.value, source: 'network', at, attempts, status: result.status };
      } catch (error) {
        last = error;
        if (this.lifetime.signal.aborted || options.signal?.aborted) throw error;
        const e = object(error);
        if (
          e.verification ||
          e.invalidResponse ||
          e.status === 404 ||
          e.status === 401 ||
          e.status === 403
        )
          break;
        if (attempt < 2) await this.wait(Math.max(this.interval, Number(e.retryAfter) || 0));
      }
    }
    if (options.fallback && !object(last).verification) {
      try {
        const result = await this.request(options.fallback.path, key, ttl, {
          ...options,
          parse: options.fallback.parse,
          fallback: undefined,
          allowStale: false,
        });
        return { ...result, attempts: attempts + (result.attempts ?? 0) };
      } catch (error) {
        if (this.lifetime.signal.aborted || options.signal?.aborted) throw error;
        last = error;
        attempts += Number(object(error).attempts) || 0;
      }
    }
    const stale = options.allowStale ? this.db.cache(key, true, this.now()) : null;
    if (stale) return { value: stale.value, source: 'stale', at: stale.at, attempts };
    throw Object.assign(last instanceof Error ? last : new Error(String(last)), { attempts });
  }
  analysisPlayer(id: string, force = false): Promise<DataResult> {
    return this.get(
      `/api/analysis/player?stbid=${encodeURIComponent(id)}`,
      `analysis:${id}`,
      21600000,
      { force, allowStale: !force },
    );
  }
  playerInfo(id: string, force = false): Promise<DataResult> {
    return this.get(`/api/players/info?stbid=${encodeURIComponent(id)}`, `info:${id}`, 21600000, {
      force,
      allowStale: !force,
      parse: (raw) => validatePlayerInfo(JSON.parse(raw), id),
      fallback: {
        path: `/player/${encodeURIComponent(id)}`,
        parse: (raw) => parsePlayerPage(raw, id),
      },
    });
  }
  playerMatches(id: string, force = false): Promise<DataResult> {
    return this.get(
      `/api/players/matches?stbid=${encodeURIComponent(id)}&limit=10`,
      `myMatches:${id}:10`,
      1800000,
      { force, allowStale: !force },
    );
  }
  match(id: string, force = false): Promise<DataResult> {
    return this.get(`/api/match?matchid=${encodeURIComponent(id)}`, `match:${id}`, 86400000, {
      force,
      allowStale: !force,
      parse: (raw) => validateMatchInfo(JSON.parse(raw)),
      invalidMessage: 'BATrace returned incomplete match data',
      fallback: {
        path: `/match/${encodeURIComponent(id)}`,
        parse: (raw) => parseMatchPage(raw, id),
      },
    });
  }
  analysisMatch(id: string): Promise<DataResult> {
    return this.get(
      `/api/analysis/match?matchid=${encodeURIComponent(id)}`,
      `amatch:${id}`,
      86400000,
    );
  }
  async close(): Promise<void> {
    this.lifetime.abort();
    await Promise.allSettled([...this.pending.values()]);
  }
}
