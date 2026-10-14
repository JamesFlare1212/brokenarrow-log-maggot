import { randomUUID } from 'node:crypto';
import type { ApiHealth, HeartbeatState, VersionInfo } from '@ba/contracts';
import { array, object, text, number, errorMessage } from '@ba/shared';
import type { Database } from '../storage/database';
import type { BatraceClient, HttpPort } from './client';
const STATS = 'https://brokenarrow.zolahere.top';
export class StatusService {
  heartbeat: HeartbeatState = { online: null, lastPing: null, error: null };
  version: VersionInfo;
  private healthPending: Promise<ApiHealth> | null = null;
  private heartbeatPending: Promise<HeartbeatState> | null = null;
  constructor(
    private db: Database,
    private client: BatraceClient,
    private http: HttpPort,
    currentVersion: string,
  ) {
    this.version = {
      current: currentVersion,
      latest: currentVersion,
      hasUpdate: false,
      announcement: '',
      url: 'https://github.com/Zawinzala/brokenarrow-log-maggot/releases',
      error: null,
    };
  }
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
  ping(): Promise<HeartbeatState> {
    if (this.heartbeatPending) return this.heartbeatPending;
    this.heartbeatPending = (async () => {
      if (!this.db.config().heartbeatEnabled) {
        this.heartbeat = { online: null, lastPing: null, error: null };
        return this.heartbeat;
      }
      try {
        let uid = this.db.state<string>('heartbeatId', '');
        if (!uid) {
          uid = randomUUID();
          this.db.setState('heartbeatId', uid);
        }
        const active = this.db.state<string | null>('activeAccountId', null),
          account = this.db.accounts().find((a) => a.id === active),
          share = this.db.config().roomPresenceEnabled;
        const response = await this.http.fetch(STATS + '/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: uid,
            v: this.version.current,
            name: share ? account?.name || '' : '',
            uid: share ? active || '' : '',
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`Heartbeat HTTP ${response.status}`);
        const count = await this.http.fetch(STATS + '/online-count', {
          signal: AbortSignal.timeout(8000),
        });
        if (!count.ok) throw new Error(`Online count HTTP ${count.status}`);
        const raw = object(await count.json()),
          data = object(raw.data);
        this.heartbeat = {
          online: number(
            raw.online ?? raw.onlineCount ?? raw.online_count ?? raw.count ?? data.online,
          ),
          lastPing: Date.now(),
          error: null,
        };
      } catch (error) {
        this.heartbeat = { ...this.heartbeat, error: errorMessage(error) };
      }
      return this.heartbeat;
    })().finally(() => (this.heartbeatPending = null));
    return this.heartbeatPending;
  }
  async roomUsers(ids: string[]): Promise<string[]> {
    if (!this.db.config().heartbeatEnabled || !this.db.config().roomPresenceEnabled || !ids.length)
      return [];
    const me = this.db.state<string | null>('activeAccountId', null);
    if (!me) return [];
    const query = new URLSearchParams({
      ids: ids
        .filter((id) => id !== me)
        .slice(0, 32)
        .join(','),
      me,
    });
    const result = await this.http.fetch(STATS + '/room-users?' + query, {
      signal: AbortSignal.timeout(8000),
    });
    if (!result.ok) return [];
    const raw = object(await result.json());
    return array(raw.users)
      .map((v) => text(object(v).id))
      .filter(Boolean);
  }
  async checkVersion(): Promise<VersionInfo> {
    try {
      const response = await this.http.fetch(STATS + '/update-meta', {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Update HTTP ${response.status}`);
      const raw = object(await response.json()),
        latest = text(raw.version);
      if (!/^v?\d+\.\d+\.\d+/.test(latest)) throw new Error('Invalid update metadata');
      const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number),
        remote = parse(latest),
        local = parse(this.version.current);
      let comparison = 0;
      for (let i = 0; i < 3; i++) {
        if (remote[i] !== local[i]) {
          comparison = (remote[i] || 0) - (local[i] || 0);
          break;
        }
      }
      const url = text(raw.exeUrl, this.version.url);
      this.version = {
        ...this.version,
        latest,
        hasUpdate: comparison > 0,
        announcement: text(raw.announcement),
        url: /^https:\/\//.test(url) ? url : this.version.url,
        error: null,
      };
    } catch (error) {
      this.version = { ...this.version, error: errorMessage(error) };
    }
    return this.version;
  }
}
