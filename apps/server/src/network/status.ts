import type { ApiHealth } from '@ba/contracts';
import { object, number } from '@ba/shared';
import type { Database } from '../storage/database';
import type { BatraceClient } from './client';
export class StatusService {
  private healthPending: Promise<ApiHealth> | null = null;
  constructor(
    private db: Database,
    private client: BatraceClient,
  ) {}
  health(): ApiHealth {
    return this.db.state<ApiHealth>('health', { state: 'unknown', at: 0, checks: [] });
  }
  probe(): Promise<ApiHealth> {
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
        const at = Date.now();
        try {
          await this.client.get(path, 'health:' + path, 0, { health: true, force: true });
          checks.push({ path, ok: true, ms: Date.now() - at, status: 200 });
        } catch (error) {
          checks.push({
            path,
            ok: false,
            ms: Date.now() - at,
            status: number(object(error).status),
          });
        }
      }
      const count = checks.filter((c) => c.ok).length,
        result: ApiHealth = {
          state: count === checks.length ? 'ok' : count === 0 ? 'down' : 'partial',
          at: Date.now(),
          checks,
        };
      this.db.setState('health', result);
      return result;
    })().finally(() => (this.healthPending = null));
    return this.healthPending;
  }
}
