import { join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type {
  AppEvent,
  Ban,
  Bootstrap,
  DeckSwitchAlert,
  Match,
  MigrationStatus,
  RpcMethod,
  RpcInputs,
  RpcOutputs,
  Session,
} from '@ba/contracts';
import { rpcSchemas, initialUpdateState, UPDATE_RELEASES_URL } from '@ba/contracts';
import { array, object, text, number, errorMessage, MAP_NAMES } from '@ba/shared';
import { Database } from './storage/database';
import { migrateLegacy } from './storage/migrate';
import { BatraceClient } from './network/client';
import { StatusService } from './network/status';
import { Analyzer } from './players/analyzer';
import { TrackerService } from './players/tracker';
import { LogParser, type LogEvent } from './logs/parser';
import { LogWatcher } from './logs/watcher';
import { DeckService } from './decks/service';
import { ReplayFiles } from './replays/files';
import type { Platform } from './ports';
type EventInput = AppEvent extends infer E
  ? E extends AppEvent
    ? Omit<E, 'revision'>
    : never
  : never;
type Handlers = {
  [K in RpcMethod]: (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
};
export class Application {
  readonly db: Database;
  readonly files: ReplayFiles;
  readonly parser: LogParser;
  readonly watcher: LogWatcher;
  readonly client: BatraceClient;
  private analyzer: Analyzer;
  private tracker: TrackerService;
  private decks: DeckService;
  private statuses: StatusService;
  private revision = 0;
  private queryIds = new Map<string, string>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private syncPending = false;
  private banPending: Promise<Ban[]> | null = null;
  private autoKey = '';
  private restoredSession = '';
  private disposed = false;
  private closing = false;
  private tasks = new Set<Promise<unknown>>();
  private lifetime = new AbortController();
  private deckAlert: DeckSwitchAlert | null = null;
  private migration: MigrationStatus = {
    completed: false,
    imported: {},
    warnings: [],
    backupDir: null,
  };
  private handlers: Handlers;
  constructor(
    private dir: string,
    private platform: Platform,
    private broadcast: (event: AppEvent) => void,
    private network = true,
  ) {
    this.db = new Database(join(dir, 'assistant.sqlite'));
    this.files = new ReplayFiles(this.db, dir);
    const http = {
      ...platform.http,
      fetch: ((input, options = {}) =>
        platform.http.fetch(input, {
          ...options,
          signal: AbortSignal.any([
            this.lifetime.signal,
            ...(options.signal ? [options.signal] : []),
          ]),
        })) as typeof fetch,
    };
    this.client = new BatraceClient(this.db, http, (usage) => this.event({ type: 'usage', usage }));
    this.analyzer = new Analyzer(this.client, this.db);
    this.tracker = new TrackerService(this.db, this.client, this.analyzer);
    this.decks = new DeckService(this.db);
    this.statuses = new StatusService(this.db, this.client);
    this.parser = new LogParser((event) => this.onLog(event));
    this.watcher = new LogWatcher(this.parser, (watcher) =>
      this.event({ type: 'watcher', watcher }),
    );
    this.handlers = {
      'updates.check': () => platform.updates?.check() ?? initialUpdateState(platform.version),
      'updates.download': () => {
        if (!platform.updates) throw new Error('Updates unavailable');
        return platform.updates.download();
      },
      'updates.install': () => {
        if (!platform.updates) throw new Error('Updates unavailable');
        return platform.updates.install();
      },
      'updates.openDownload': async () => {
        await platform.openExternal(UPDATE_RELEASES_URL);
        return null;
      },
      'app.bootstrap': () => this.snapshot(),
      'config.update': async (patch) => {
        if (
          patch.logDir &&
          !(await stat(patch.logDir)
            .then((s) => s.isDirectory())
            .catch(() => false))
        )
          throw new Error('GameLogs directory does not exist');
        if (
          patch.decksDir &&
          !(await stat(patch.decksDir)
            .then((s) => s.isDirectory())
            .catch(() => false))
        )
          throw new Error('Decks directory does not exist');
        const before = this.db.config(),
          next = this.db.updateConfig(patch);
        this.event({ type: 'config', config: next });
        if (before.logDir !== next.logDir) this.watcher.start(next.logDir);
        if (before.inputHookEnabled && !next.inputHookEnabled) {
          this.platform.apm.disable();
          this.event({ type: 'apm', apm: this.platform.apm.status() });
        }
        if (
          !before.inputHookEnabled &&
          next.inputHookEnabled &&
          this.watcher.status().live &&
          this.parser.snapshot().current
        ) {
          this.platform.apm.start(this.parser.snapshot().current!);
          this.event({ type: 'apm', apm: this.platform.apm.status() });
        }
        if (before.replayEnabled && !next.replayEnabled)
          await this.platform.recordings.stop(this.parser.snapshot().current || undefined);
        if (!before.replayEnabled && next.replayEnabled) {
          const session = this.parser.snapshot();
          if (session.current && !session.recovering && this.watcher.status().live)
            await this.platform.recordings.start(session.current, next);
        }
        return next;
      },
      'directory.select': ({ kind }) => platform.selectDirectory(kind),
      'directory.detect': () => platform.detectLogDirectory(),
      'players.search': async ({ query }) => {
        try {
          const r = await this.client.get(
            `/api/players/search?q=${encodeURIComponent(query)}&limit=20`,
            `search:${query}:20`,
            600000,
            { allowStale: true },
          );
          const players = array(object(r.value).players)
            .map(object)
            .map((p) => ({
              id: text(p.id),
              name: text(p.name),
              level: number(p.level),
              rating: number(p.rating),
            }))
            .filter((p) => /^\d+$/.test(p.id));
          this.db.observe(players);
          return { players, source: r.source };
        } catch {
          return { players: this.db.localSearch(query), source: 'local' as const };
        }
      },
      'players.report': ({ id, force }) => this.analyzer.report(id, force),
      'players.maggot': ({ id, requestId }) =>
        this.analyzer.maggot(id, (done, scanned) =>
          this.event({ type: 'maggot', requestId, id, done, scanned, total: 12 }),
        ),
      'players.profile': ({ id, force }) => this.tracker.profile(id, force),
      'session.query': (input) => this.query(input),
      'matches.list': ({ accountId }) => this.db.matches(accountId),
      'matches.detail': async ({ fid, force }) => {
        const match = await this.tracker.detail(fid, force);
        this.event({ type: 'matches' });
        return match;
      },
      'matches.add': async ({ fid }) => {
        const match = await this.tracker.detail(fid, true);
        this.event({ type: 'matches' });
        return match;
      },
      'matches.delete': ({ id }) => {
        const removed = this.db.deleteMatch(id);
        this.event({ type: 'matches' });
        return { removed };
      },
      'bans.list': ({ metOnly }) => this.db.bans(metOnly),
      'bans.sync': () => this.syncBans(),
      'accounts.list': () => this.db.accounts(),
      'accounts.delete': ({ id }) => {
        const result = this.db.deleteAccount(id);
        this.event({ type: 'matches' });
        return result;
      },
      'decks.list': () => this.decks.list(),
      'decks.backup': (input) => this.decks.backup(input.names, input.packageName),
      'decks.deploy': async ({ name }) => {
        const result = await this.decks.deploy(name);
        this.event({ type: 'decks', alert: this.deckAlert });
        return result;
      },
      'decks.delete': (input) => this.decks.remove(input.kind, input.names),
      'decks.open': async ({ kind }) => {
        const p = await this.decks.paths();
        if (!p.found) throw new Error('Deck directory not found');
        await platform.openPath(kind === 'decks' ? p.decks : p.backups);
        return null;
      },
      'decks.switch': async ({ action }) => {
        await this.decks.switchAction(action);
        this.deckAlert = null;
        this.event({ type: 'decks', alert: null });
        return null;
      },
      'replays.list': () => this.files.list(),
      'replays.directory': async () => ({
        dir: this.files.dir(),
        count: (await this.files.list()).length,
      }),
      'replays.delete': async ({ name }) => {
        const result = await this.files.remove(name);
        this.event({ type: 'replays' });
        return result;
      },
      'replays.clean': async ({ days }) => {
        const result = await this.files.clean(days);
        this.event({ type: 'replays' });
        return result;
      },
      'replays.open': async () => {
        await platform.openPath(this.files.dir());
        return null;
      },
      'replays.play': async ({ name }) => ({
        url: await platform.recordings.playback(await this.files.path(name)),
      }),
      'replays.move': async ({ from, to }) => {
        if (resolve(from) !== resolve(this.files.dir()))
          throw new Error('Recording source directory changed; reopen settings');
        const result = await this.files.move(from, to);
        if (!result.failed.length) {
          const config = this.db.updateConfig({ replaySaveDir: to });
          this.event({ type: 'config', config });
        }
        this.event({ type: 'replays' });
        return result;
      },
      'replays.test': async () => {
        if (
          platform.recordings.status().phase !== 'idle' &&
          platform.recordings.status().phase !== 'error'
        )
          throw new Error('A recording is already active');
        const match = this.parser.snapshot().current || { ...this.blankTestMatch() };
        await platform.recordings.start(match, this.db.config(), true);
        return null;
      },
      'displays.list': () => platform.recordings.displays(),
      'displays.thumbnail': ({ id }) => platform.recordings.thumbnail(id),
      'api.health': ({ force }) => (force ? this.probeHealth() : this.statuses.health()),
      'external.open': async ({ url }) => {
        await platform.openExternal(url);
        return null;
      },
    };
  }
  private blankTestMatch(): Match {
    return {
      id: 'test:' + randomUUID(),
      fid: null,
      sessionId: randomUUID(),
      mapId: null,
      map: 'Recording test',
      scenario: '',
      startedAt: Date.now(),
      endedAt: null,
      durationSec: null,
      durationSource: null,
      localDeck: '',
      points: null,
      players: [],
      mode: 'unknown',
      winnerTeamId: null,
      localPlayerId: null,
      localPersona: '',
      outcome: 'unknown',
      eloBefore: null,
      eloAfter: null,
      restarted: false,
      source: 'log',
      updatedAt: Date.now(),
    };
  }
  event(event: EventInput): void {
    if (!this.disposed && !this.closing)
      this.broadcast({ ...event, revision: ++this.revision } as AppEvent);
  }
  private fire(task: Promise<unknown>): void {
    this.tasks.add(task);
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task),
    );
  }
  snapshot(): Bootstrap {
    return {
      updates: this.platform.updates?.status() ?? initialUpdateState(this.platform.version),
      revision: this.revision,
      config: this.db.config(),
      session: this.parser.snapshot(),
      watcher: this.watcher.status(),
      usage: this.db.usage(),
      recording: this.platform.recordings.status(),
      apm: this.platform.apm.status(),
      health: this.statuses.health(),
      version: { current: this.platform.version },
      migration: this.migration,
      deckAlert: this.deckAlert,
    };
  }
  async invoke<K extends RpcMethod>(method: K, input: unknown): Promise<RpcOutputs[K]> {
    if (this.disposed || this.closing) throw new Error('Application closed');
    const parsed = rpcSchemas[method].parse(input) as RpcInputs[K],
      handler = this.handlers[method] as (
        input: RpcInputs[K],
      ) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
    const task = Promise.resolve(handler(parsed));
    this.tasks.add(task);
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task),
    );
    return task;
  }
  async start(): Promise<void> {
    this.migration = await migrateLegacy(this.db, this.dir);
    for (const row of this.db.sql.prepare('SELECT id,name FROM map_names').all())
      MAP_NAMES[Number(row.id)] = String(row.name);
    this.watcher.start(this.db.config().logDir);
    this.timers.push(
      setInterval(() => {
        if (!this.network) return;
        this.fire(this.syncBackground());
        this.fire(this.probeHealth());
      }, 3600000),
    );
    this.timers.push(
      setInterval(() => {
        const apm = this.platform.apm.status();
        if (apm.status === 'active') this.event({ type: 'apm', apm });
        const recording = this.platform.recordings.status();
        if (recording.phase === 'recording') this.event({ type: 'recording', recording });
      }, 1000),
    );
    if (this.network) this.fire(this.syncBackground());
  }
  private onLog(event: LogEvent): void {
    if (this.disposed || this.closing) return;
    if (event.type === 'session') {
      const session = event.session;
      this.event({ type: 'session', session });
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = null;
        this.flushSession(this.parser.snapshot());
      }, 250);
    }
    if (event.type === 'reset') {
      this.queryIds.clear();
      this.autoKey = '';
      this.restoredSession = '';
      this.platform.apm.stop();
      if (this.platform.recordings.status().phase !== 'stopping')
        void this.platform.recordings
          .abort()
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }));
    }
    if (event.type === 'started' && !event.recovering) {
      const config = this.db.config();
      if (config.inputHookEnabled) this.platform.apm.start(event.match);
      this.fire(
        this.decks
          .onMatchStart(this.parser.snapshot())
          .then(() => this.event({ type: 'decks', alert: null }))
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) })),
      );
      if (config.replayEnabled)
        void this.platform.recordings
          .start(event.match, config)
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }));
    }
    if (event.type === 'ended' || event.type === 'metadata') {
      if (event.recovering) this.db.observe(event.match.players, 0);
      this.db.saveMatch(event.match, !event.recovering);
      this.event({ type: 'matches' });
      if (event.type === 'ended' && !event.recovering) {
        this.platform.apm.stop();
        this.event({ type: 'apm', apm: this.platform.apm.status() });
        void this.platform.recordings
          .stop(event.match)
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }));
      }
    }
  }
  private flushSession(session: Session): void {
    if (this.disposed || this.closing) return;
    const players = session.current?.players ?? session.lobbyPlayers;
    const live = !!this.watcher.status().live;
    this.db.observe(players, live ? Date.now() : 0);
    if (session.localPlayerId) {
      this.db.observeAccount(
        session.localPlayerId,
        session.localName,
        session.localName,
        live ? Date.now() : 0,
      );
      this.db.setState('activeAccountId', session.localPlayerId);
    }
    if (session.recovering) return;
    if (
      session.current &&
      this.parser.isRecoveredMatch() &&
      this.watcher.status().live &&
      this.restoredSession !== session.current.sessionId
    ) {
      this.restoredSession = session.current.sessionId;
      if (this.db.config().inputHookEnabled) this.platform.apm.start(session.current);
      if (this.db.config().replayEnabled && this.platform.recordings.status().phase === 'idle')
        void this.platform.recordings
          .start(session.current, this.db.config())
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }));
    }
    this.fire(
      this.decks
        .switchAlert(session)
        .then((alert) => {
          if (alert) {
            this.deckAlert = alert;
            this.event({ type: 'decks', alert });
          }
        })
        .catch((e) => this.event({ type: 'error', message: errorMessage(e) })),
    );
    const key =
      session.generation +
      ':' +
      (session.current?.fid ?? session.lobbyId) +
      ':' +
      players
        .map((p) => p.id + ':' + p.teamId)
        .sort()
        .join(',');
    if (
      this.network &&
      live &&
      this.db.config().autoQueryCurrentMatch &&
      players.length &&
      key !== this.autoKey
    ) {
      this.autoKey = key;
      void this.query({ context: 'current', requestId: randomUUID() }).catch((e) =>
        this.event({ type: 'error', message: errorMessage(e) }),
      );
    }
  }
  private async query(input: RpcInputs['session.query']): Promise<RpcOutputs['session.query']> {
    const session = this.parser.snapshot(),
      players =
        input.context === 'previous'
          ? input.players || []
          : (session.current?.players ?? session.lobbyPlayers);
    const unique = [...new Map(players.map((p) => [p.id, p])).values()]
      .filter(
        (p) =>
          /^\d+$/.test(p.id) &&
          p.id !== '0' &&
          p.teamId !== 100 &&
          !/\[Bot\]|^(AI|BOT)[_-]?\d*$/i.test(p.name),
      )
      .slice(0, 20);
    const me = players.find((p) => p.id === session.localPlayerId);
    unique.sort((a, b) => Number(b.teamId !== me?.teamId) - Number(a.teamId !== me?.teamId));
    this.queryIds.set(input.context, input.requestId);
    let queried = 0,
      cancelled = false;
    for (const player of unique) {
      if (
        this.queryIds.get(input.context) !== input.requestId ||
        (input.context === 'current' && this.parser.snapshot().generation !== session.generation)
      ) {
        cancelled = true;
        break;
      }
      let info = null,
        error: string | null = null;
      try {
        info = this.analyzer.mini(await this.analyzer.report(player.id));
        queried++;
      } catch (e) {
        error = errorMessage(e);
      }
      if (this.queryIds.get(input.context) !== input.requestId) {
        cancelled = true;
        break;
      }
      this.event({
        type: 'roster',
        requestId: input.requestId,
        context: input.context,
        generation: session.generation,
        player,
        info,
        error,
      });
    }
    return {
      requestId: input.requestId,
      queried,
      skipped: players.length - unique.length,
      cancelled,
    };
  }
  private syncBans(): Promise<Ban[]> {
    if (this.banPending) return this.banPending;
    this.banPending = (async () => {
      const result = await this.client.get(
          '/api/leaderboard/ban?limit=500&offset=0',
          'ban:500:0',
          3600000,
          { force: true },
        ),
        now = Date.now(),
        list: Ban[] = array(object(result.value).leaderboard)
          .map(object)
          .map((p) => ({
            id: text(p.id),
            name: text(p.name),
            steamId: text(p.steam_id),
            rating: number(p.rating),
            firstSeenAt: now,
            lastSeenAt: now,
            encountered: false,
          }))
          .filter((b) => /^\d+$/.test(b.id));
      const newly = this.db.saveBans(list);
      this.db.setState('lastBanSync', now);
      const all = this.db.bans();
      this.event({ type: 'bans', list: all, newly });
      if (newly.length) this.platform.notify('Ban tracker', newly.map((b) => b.name).join(', '));
      return all;
    })().finally(() => (this.banPending = null));
    return this.banPending;
  }
  private async syncBackground(): Promise<void> {
    if (this.syncPending || this.disposed || this.closing) return;
    this.syncPending = true;
    try {
      if (this.db.config().banPollEnabled) await this.syncBans();
      if (this.db.config().matchSyncEnabled) {
        await this.tracker.sync();
        this.event({ type: 'matches' });
      }
    } catch (e) {
      this.event({ type: 'error', message: errorMessage(e) });
    } finally {
      this.syncPending = false;
    }
  }
  private async probeHealth() {
    const health = await this.statuses.probe();
    this.event({ type: 'health', health });
    return health;
  }
  async stop(): Promise<void> {
    if (this.disposed || this.closing) return;
    this.closing = true;
    const match = this.parser.snapshot().current;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    this.queryIds.clear();
    this.watcher.stop();
    this.platform.apm.disable();
    const recording = this.platform.recordings.stop(match || undefined);
    void recording.catch(() => {});
    this.lifetime.abort();
    await this.client.close();
    await Promise.allSettled(
      [...this.tasks, this.banPending].filter((p): p is Promise<unknown> => p !== null),
    );
    await recording;
    this.disposed = true;
    this.db.close();
  }
}
