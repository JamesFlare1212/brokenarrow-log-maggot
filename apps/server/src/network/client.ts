import { setTimeout as sleep } from 'node:timers/promises';
import { BATRACE_API_ORIGIN, BATRACE_ORIGIN, batraceClientHeaders } from '@ba/contracts';
import type { ApiHealthCheck } from '@ba/contracts';
import { object } from '@ba/shared';
import type { Database } from '../storage/database';
import { parsePlayerPage, validatePlayerInfo } from './player-page';
import { parseMatchPage, validateMatchInfo } from './match-page';
import { failedHealthCheck } from './health';
import { projectConfig, type NetworkConfig } from '../config';
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
}
export class BatraceClient {
  private pending = new Map<string, Promise<DataResult>>();
  private lifetime = new AbortController();
  private resultListeners = new Set<(check: ApiHealthCheck) => void>();
  constructor(
    private db: Database,
    private http: HttpPort,
    private version: string,
    private now: () => number = Date.now,
    private wait: (ms: number, signal?: AbortSignal) => Promise<unknown> = (ms, signal) =>
      sleep(ms, undefined, { signal }),
    private random: () => number = Math.random,
    private settings: NetworkConfig = projectConfig.network,
  ) {}
  get offline(): boolean {
    return this.http.offline === true;
  }
  onResult(listener: (check: ApiHealthCheck) => void): () => void {
    this.resultListeners.add(listener);
    return () => {
      this.resultListeners.delete(listener);
    };
  }
  private report(check: ApiHealthCheck, options: RequestOptions): void {
    if (options.health || this.lifetime.signal.aborted || options.signal?.aborted) return;
    for (const listener of this.resultListeners) listener(check);
  }
  async get(
    path: string,
    key: string,
    ttl: number,
    options: RequestOptions = {},
  ): Promise<DataResult> {
    this.lifetime.signal.throwIfAborted();
    if (this.http.offline) {
      const hit = this.db.cache(key, true, this.now());
      if (!hit) {
        const failure = this.db.state<Record<string, { message: string; status?: number }>>(
          'recordedBatraceFailures',
          {},
        )[key];
        if (failure)
          throw Object.assign(new Error(failure.message), { status: failure.status, attempts: 0 });
        throw new Error('Offline real-data mode: no recorded response for this request');
      }
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
    let startedAt: number | undefined;
    const signal = AbortSignal.any([
      this.lifetime.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    for (let attempt = 0; attempt < this.settings.maxAttempts; attempt++) {
      try {
        signal.throwIfAborted();
        const offset = Math.floor(this.random() * (this.settings.requestOffsetMs + 1));
        if (offset) await this.wait(offset, signal);
        signal.throwIfAborted();
        const run = async () => {
          if (!options.health) attempts++;
          startedAt ??= this.now();
          const headers = object(this.db.state<unknown>('privateHeaders', {}));
          const safeHeaders = new Headers(
            Object.fromEntries(
              Object.entries(headers).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            ),
          );
          for (const [name, value] of Object.entries(batraceClientHeaders(this.version)))
            safeHeaders.set(name, value);
          const origin = path.startsWith('/api/') ? BATRACE_API_ORIGIN : BATRACE_ORIGIN;
          const response = await this.http.fetch(origin + path, {
            headers: safeHeaders,
            signal: AbortSignal.any([
              this.lifetime.signal,
              AbortSignal.timeout(this.settings.requestTimeoutMs),
              ...(options.signal ? [options.signal] : []),
            ]),
          });
          const raw = await response.text(),
            html = response.headers.get('content-type')?.includes('text/html') || /^\s*</.test(raw);
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
        const result = await run();
        this.lifetime.signal.throwIfAborted();
        options.signal?.throwIfAborted();
        const at = this.now();
        this.report({ path, ok: true, ms: at - startedAt!, status: result.status }, options);
        if (!options.health) this.db.saveCache(key, result.value, ttl, at);
        return { value: result.value, source: 'network', at, attempts, status: result.status };
      } catch (error) {
        last = error;
        if (this.lifetime.signal.aborted || options.signal?.aborted) throw error;
        const e = object(error);
        if (e.invalidResponse || e.status === 404 || e.status === 401 || e.status === 403) break;
        if (attempt + 1 < this.settings.maxAttempts)
          await this.wait(Math.max(this.settings.retryDelayMs, Number(e.retryAfter) || 0), signal);
      }
    }
    if (startedAt !== undefined)
      this.report(failedHealthCheck(path, this.now() - startedAt, last), options);
    if (options.fallback) {
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
      projectConfig.cache.ttlMs.player,
      { force, allowStale: !force },
    );
  }
  playerInfo(id: string, force = false): Promise<DataResult> {
    return this.get(
      `/api/players/info?stbid=${encodeURIComponent(id)}`,
      `info:${id}`,
      projectConfig.cache.ttlMs.player,
      {
        force,
        allowStale: !force,
        parse: (raw) => validatePlayerInfo(JSON.parse(raw), id),
        fallback: {
          path: `/player/${encodeURIComponent(id)}`,
          parse: (raw) => parsePlayerPage(raw, id),
        },
      },
    );
  }
  playerMatches(id: string, force = false): Promise<DataResult> {
    return this.get(
      `/api/players/matches?stbid=${encodeURIComponent(id)}&limit=10`,
      `myMatches:${id}:10`,
      projectConfig.cache.ttlMs.playerMatches,
      { force, allowStale: !force },
    );
  }
  match(id: string, force = false): Promise<DataResult> {
    return this.get(
      `/api/match?matchid=${encodeURIComponent(id)}`,
      `match:${id}`,
      projectConfig.cache.ttlMs.match,
      {
        force,
        allowStale: !force,
        parse: (raw) => validateMatchInfo(JSON.parse(raw)),
        invalidMessage: 'BATrace returned incomplete match data',
        fallback: {
          path: `/match/${encodeURIComponent(id)}`,
          parse: (raw) => parseMatchPage(raw, id),
        },
      },
    );
  }
  analysisMatch(id: string, force = false): Promise<DataResult> {
    return this.get(
      `/api/analysis/match?matchid=${encodeURIComponent(id)}`,
      `amatch:${id}`,
      projectConfig.cache.ttlMs.match,
      { force },
    );
  }
  async close(): Promise<void> {
    this.resultListeners.clear();
    this.lifetime.abort();
    await Promise.allSettled([...this.pending.values()]);
  }
}
