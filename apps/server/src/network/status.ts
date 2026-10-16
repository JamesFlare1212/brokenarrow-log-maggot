import type { ApiHealth, ApiHealthCheck } from '@ba/contracts';
import { object } from '@ba/shared';
import type { Database } from '../storage/database';
import type { BatraceClient } from './client';
import { parsePlayerPage } from './player-page';
export class StatusService {
  private healthPending: Promise<ApiHealth> | null = null;
  private currentHealth: ApiHealth = { state: 'unknown', at: 0, checks: [] };
  constructor(
    private db: Database,
    private client: BatraceClient,
    private online = true,
  ) {}
  health(): ApiHealth {
    // A previous run's result says nothing about this run's connection.
    return this.currentHealth;
  }
  private async check(path: string, parse?: (raw: string) => unknown): Promise<ApiHealthCheck> {
    const at = Date.now();
    try {
      const response = await this.client.get(path, 'health:' + path, 0, {
        health: true,
        force: true,
        parse,
      });
      return { path, ok: true, ms: Date.now() - at, status: response.status ?? 200 };
    } catch (error) {
      const detail = object(error);
      const status = detail.status;
      return {
        path,
        ok: false,
        ms: Date.now() - at,
        status: typeof status === 'number' ? status : null,
        failure: detail.verification
          ? 'verification'
          : detail.blocked
            ? 'blocked'
            : detail.invalidResponse
              ? 'invalid-response'
              : detail.name === 'TimeoutError' || detail.name === 'AbortError'
                ? 'timeout'
                : typeof status === 'number'
                  ? 'http'
                  : 'network',
        ...(typeof detail.rayId === 'string' ? { rayId: detail.rayId } : {}),
      };
    }
  }
  probe(): Promise<ApiHealth> {
    if (!this.online) return Promise.resolve(this.health());
    if (this.healthPending) return this.healthPending;
    this.healthPending = (async () => {
      const paths = [
        '/api/players/search?q=test&limit=1',
        '/api/players/info?stbid=8863',
        '/api/leaderboard/ban?limit=1',
        '/api/players/matches?stbid=8863&limit=1',
      ];
      const checks: ApiHealth['checks'] = [];
      for (const path of paths) {
        const check: ApiHealth['checks'][number] = await this.check(path);
        if (!check.ok && check.failure !== 'verification' && path === paths[1])
          check.fallback = await this.check('/player/8863', (raw) => parsePlayerPage(raw, '8863'));
        checks.push(check);
      }
      const available = checks.some((check) => check.ok || check.fallback?.ok),
        result: ApiHealth = {
          state: checks.every((check) => check.ok) ? 'ok' : available ? 'partial' : 'down',
          at: Date.now(),
          checks,
        };
      this.db.setState('health', result);
      this.currentHealth = result;
      return result;
    })().finally(() => (this.healthPending = null));
    return this.healthPending;
  }
}
