import type { ApiHealth, ApiHealthCheck } from '@ba/contracts';
import type { Database } from '../storage/database';
import type { BatraceClient } from './client';
import { parsePlayerPage } from './player-page';
import { parseMatchPage, validateMatchInfo } from './match-page';
import { failedHealthCheck } from './health';
interface HealthProbe {
  path: string;
  parse?: (raw: string) => unknown;
  fallback?: { path: string; parse: (raw: string) => unknown };
}
export class StatusService {
  private healthPending: Promise<ApiHealth> | null = null;
  private currentHealth: ApiHealth = { state: 'unknown', at: 0, checks: [] };
  private checks = new Map<string, ApiHealth['checks'][number]>();
  constructor(
    private db: Database,
    private client: BatraceClient,
    private online = true,
    private changed: (health: ApiHealth) => void = () => {},
  ) {
    client.onResult((check) => {
      if (!this.online) return;
      this.update(check);
      this.changed(this.publish());
    });
  }
  health(): ApiHealth {
    // A previous run's result says nothing about this run's connection.
    return this.currentHealth;
  }
  private update(check: ApiHealthCheck): void {
    const path = check.path.split('?')[0]!;
    const endpoint = path.startsWith('/player/')
      ? '/api/players/info'
      : path.startsWith('/match/')
        ? '/api/match'
        : path;
    if (endpoint === path) {
      this.checks.set(endpoint, check);
    } else {
      const previous = this.checks.get(endpoint);
      if (previous && !previous.ok) this.checks.set(endpoint, { ...previous, fallback: check });
    }
  }
  private publish(): ApiHealth {
    const checks = [...this.checks.values()];
    const available = checks.some((check) => check.ok || check.fallback?.ok);
    const result: ApiHealth = {
      state: checks.every((check) => check.ok) ? 'ok' : available ? 'partial' : 'down',
      at: Date.now(),
      checks,
    };
    this.db.setState('health', result);
    this.currentHealth = result;
    return result;
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
      return failedHealthCheck(path, Date.now() - at, error);
    }
  }
  probe(): Promise<ApiHealth> {
    if (!this.online) return Promise.resolve(this.health());
    if (this.healthPending) return this.healthPending;
    this.healthPending = (async () => {
      const probes: HealthProbe[] = [
        { path: '/api/players/search?q=test&limit=1' },
        {
          path: '/api/players/info?stbid=8863',
          fallback: { path: '/player/8863', parse: (raw) => parsePlayerPage(raw, '8863') },
        },
        { path: '/api/leaderboard/ban?limit=1' },
        { path: '/api/players/matches?stbid=8863&limit=1' },
        {
          path: '/api/match?matchid=9227650',
          parse: (raw) => validateMatchInfo(JSON.parse(raw)),
          fallback: {
            path: '/match/9227650',
            parse: (raw) => parseMatchPage(raw, '9227650'),
          },
        },
      ];
      for (const probe of probes) {
        const check: ApiHealth['checks'][number] = await this.check(probe.path, probe.parse);
        this.update(check);
        if (!check.ok && check.failure !== 'verification' && probe.fallback)
          this.update(await this.check(probe.fallback.path, probe.fallback.parse));
      }
      return this.publish();
    })().finally(() => (this.healthPending = null));
    return this.healthPending;
  }
}
