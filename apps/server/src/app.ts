import { join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type {
  AppEvent,
  Ban,
  BanSyncStatus,
  Bootstrap,
  DeckSwitchAlert,
  Match,
  MigrationStatus,
  RpcMethod,
  RpcInputs,
  RpcOutputs,
  Session,
} from '@ba/contracts';
import {
  rpcSchemas,
  initialUpdateState,
  UPDATE_RELEASES_URL,
  hasAnalyticsChoice,
  isOnlineMatchId,
} from '@ba/contracts';
import {
  array,
  object,
  text,
  number,
  errorMessage,
  MAP_NAMES,
  currentRosterKey,
  previousRosterKey,
  emptyRosterQueries,
  updateRosterQueries,
} from '@ba/shared';
import { Database } from './storage/database';
import { migrateLegacy } from './storage/migrate';
import { BatraceClient } from './network/client';
import { StatusService } from './network/status';
import { Analyzer } from './players/analyzer';
import { TrackerService } from './players/tracker';
import { LogParser, type LogEvent } from './logs/parser';
import { LogWatcher } from './logs/watcher';
import { LogArchive } from './logs/archive';
import { DeckService } from './decks/service';
import { ReplayFiles } from './replays/files';
import { HistoryService } from './history/service';
import { projectConfig } from './config';
import type { Platform } from './ports';
import { AnalyticsService, type AppVersionMarker, type ErrorSource } from './analytics';
import { appVersionMarkerSchema } from './aptabase';
type EventInput = AppEvent extends infer E
  ? E extends AppEvent
    ? Omit<E, 'revision'>
    : never
  : never;
type Handlers = {
  [K in RpcMethod]: (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
};
const AUTO_QUERY_RETRY_DELAY_MS = 5000;
export class Application {
  readonly db: Database;
  readonly files: ReplayFiles;
  readonly parser: LogParser;
  readonly watcher: LogWatcher;
  private archive: LogArchive;
  readonly client: BatraceClient;
  private analyzer: Analyzer;
  private tracker: TrackerService;
  private decks: DeckService;
  private history: HistoryService;
  private statuses: StatusService;
  private revision = 0;
  private queryIds = new Map<string, string>();
  private rosters = emptyRosterQueries();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private syncPending = false;
  private banPending: Promise<Ban[]> | null = null;
  private banSync: BanSyncStatus;
  private publishedBanSnapshot: string;
  private publishedAccountSnapshot: string;
  private autoKey = '';
  private autoRetry: {
    sourceKey: string;
    requestId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private restoredSession = '';
  private disposed = false;
  private closing = false;
  private stopTask: Promise<void> | null = null;
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
  private analytics: AnalyticsService;
  private analyticsRecordingActive = false;
  private recordingMigrationActive = false;
  private recordingRetryPending = false;
  constructor(
    private dir: string,
    private platform: Platform,
    private broadcast: (event: AppEvent) => void,
    private network = true,
  ) {
    this.db = new Database(join(dir, 'assistant.sqlite'));
    this.publishedBanSnapshot = JSON.stringify(this.db.bans());
    this.publishedAccountSnapshot = JSON.stringify({
      list: this.db.accounts(),
      activeAccountId: this.db.state<string | null>('activeAccountId', null),
    });
    const lastSuccessAt = this.db.state<number | null>('lastBanSync', null);
    this.banSync = this.db.state<BanSyncStatus>('banSync', {
      phase: lastSuccessAt ? 'success' : 'idle',
      attemptId: null,
      lastAttemptAt: lastSuccessAt,
      lastSuccessAt,
      error: null,
    });
    if (this.banSync.phase === 'syncing') {
      this.banSync = { ...this.banSync, phase: 'error', error: 'BAN_SYNC_INTERRUPTED' };
      this.db.setState('banSync', this.banSync);
    }
    this.analytics = new AnalyticsService({
      allowed: !!platform.analytics?.enabled && network && !platform.http.offline,
      fetch: platform.http.fetch,
      version: platform.version,
      distribution: platform.analytics?.distribution ?? 'installed',
      pendingUpdates: {
        load: () => this.db.state('analytics:pendingUpdate', null),
        save: (value) => {
          if (!this.disposed) this.db.setState('analytics:pendingUpdate', value);
        },
      },
      sampleRuntime: platform.analytics?.sampleRuntime,
    });
    this.files = new ReplayFiles(this.db, dir);
    this.history = new HistoryService(this.db, dir);
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
    this.client = new BatraceClient(this.db, http, platform.version);
    this.analyzer = new Analyzer(this.client, this.db);
    this.tracker = new TrackerService(this.db, this.client, this.analyzer);
    this.decks = new DeckService(this.db);
    this.statuses = new StatusService(this.db, this.client, !platform.http.offline, (health) =>
      this.event({ type: 'health', health }),
    );
    this.parser = new LogParser((event) => this.onLog(event));
    this.watcher = new LogWatcher(this.parser, (watcher) =>
      this.event({ type: 'watcher', watcher }),
    );
    this.archive = new LogArchive(this.db, () => this.event({ type: 'matches' }));
    this.handlers = {
      'diagnostics.report': (input) => {
        if (input.type === 'feature') this.analytics.feature(input.feature);
        else if (input.type === 'error')
          this.analytics.error(input.source, { name: input.errorType }, undefined, input.frames);
        else if (input.type === 'long_tasks') this.analytics.longTasks(input);
        else this.analytics.performance(input.metric, input.durationMs);
        return null;
      },
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
      'logs.refresh': async () => {
        await this.watcher.poll();
        return this.watcher.status();
      },
      'cache.stats': () => this.db.cacheStats(),
      'config.read': () => {
        const config = this.db.config();
        this.event({ type: 'config', config });
        return { config, revision: this.revision };
      },
      'cache.clear': ({ mode }) => this.db.clearCache(mode),
      'config.update': async (patch) => {
        if (
          this.recordingMigrationActive &&
          patch.replaySaveDir !== undefined &&
          patch.replaySaveDir !== this.db.config().replaySaveDir
        )
          throw new Error('REPLAY_MIGRATION_BUSY');
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
          next = this.db.updateConfig({
            ...patch,
            ...(typeof patch.analyticsEnabled === 'boolean'
              ? {
                  analyticsChoiceSaved: true,
                }
              : {}),
          });
        this.analytics.configure(next.analyticsEnabled && hasAnalyticsChoice(next), next.lang);
        if (platform.updates) this.analytics.observeUpdate(platform.updates.status());
        this.event({ type: 'config', config: next });
        if (before.decksDir !== next.decksDir) {
          this.deckAlert = null;
          this.event({ type: 'decks', alert: null });
        }
        if (before.logDir !== next.logDir) {
          this.archive.cancel();
          this.watcher.start(next.logDir);
          this.scanArchive(next.logDir);
        }
        if (!before.replayEnabled && next.replayEnabled) {
          await this.watcher.poll();
          const session = this.parser.snapshot();
          if (
            session.current &&
            !session.recovering &&
            this.watcher.status().live &&
            !this.watcher.status().error &&
            !this.watcher.status().recovering &&
            !this.watcher.status().checking &&
            ['idle', 'error'].includes(platform.recordings.status().phase)
          ) {
            try {
              this.restoredSession = session.current.sessionId;
              await this.platform.recordings.start(session.current, next);
            } catch (error) {
              this.event({ type: 'error', message: errorMessage(error) }, error);
            }
          }
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
            projectConfig.cache.ttlMs.search,
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
          this.db.rememberSearchPlayers(players, r.at);
          return { players, source: r.source };
        } catch {
          return {
            players: this.db.localSearch(query, this.client.offline),
            source: 'local' as const,
          };
        }
      },
      'players.report': ({ id, force }) => this.analyzer.report(id, force),
      'players.maggot': ({ id, requestId }) =>
        this.analyzer.maggot(id, (done, scanned) =>
          this.event({ type: 'maggot', requestId, id, done, scanned, total: 12 }),
        ),
      'players.profile': ({ id, force, accountId, combined }) =>
        this.tracker.profile(id, force, { accountId, combined }),
      'session.query': (input) => this.query(input),
      'matches.list': ({ accountId }) => this.tracker.list(accountId),
      'matches.scan': async () => {
        await this.archive.scan(this.db.config().logDir);
        return null;
      },
      'matches.detail': async ({ fid, force, accountId }) => {
        const match = await this.tracker.detail(fid, force, false, accountId);
        if (isOnlineMatchId(fid)) this.event({ type: 'matches' });
        return match;
      },
      'matches.add': async ({ fid }) => {
        const match = await this.tracker.detail(fid, true, true);
        this.event({ type: 'matches' });
        return match;
      },
      'matches.planDelete': ({ id }) => this.history.plan('match', id),
      'matches.delete': async ({ token }) => {
        const result = await this.history.execute(token, 'match');
        this.event({ type: 'matches' });
        return result;
      },
      'bans.list': ({ metOnly }) => this.db.bans(metOnly),
      'bans.sync': () => this.syncBans(),
      'bans.acknowledgeAlerts': ({ ids }) => {
        this.db.acknowledgeBanAlerts(ids);
        this.event({ type: 'banAlerts', alerts: this.db.banAlerts() });
        return null;
      },
      'accounts.list': () => this.db.accounts(),
      'accounts.planDelete': ({ id }) => this.history.plan('account', id),
      'accounts.delete': async ({ token }) => {
        const result = await this.history.execute(token, 'account');
        this.event({ type: 'matches' });
        return result;
      },
      'history.backups': () => this.history.backups(),
      'history.restore': async ({ name, version }) => {
        const result = await this.history.restore(name, version);
        this.event({ type: 'matches' });
        return result;
      },
      'history.open': async () => {
        await platform.openPath(this.history.directory());
        return null;
      },
      'decks.list': () => this.decks.list(),
      'decks.backup': (input) => this.decks.backup(input.names, input.packageName, input.directory),
      'decks.planRestore': ({ name, directory, version }) =>
        this.decks.planRestore(name, directory, version),
      'decks.deploy': async ({ token }) => {
        const result = await this.decks.deploy(token);
        this.event({ type: 'decks', alert: this.deckAlert });
        return result;
      },
      'decks.delete': async (input) => {
        const result = await this.decks.remove(input.kind, input.names, input.directory);
        this.event({ type: 'decks', alert: this.deckAlert });
        return result;
      },
      'decks.open': async ({ kind }) => {
        const p = await this.decks.paths();
        if (!p.found) throw new Error('Deck directory not found');
        await platform.openPath(kind === 'decks' ? p.decks : p.backups);
        return null;
      },
      'decks.switch': async ({ action, token }) => {
        const alert = this.deckAlert;
        if (
          action === 'restore' &&
          (!alert ||
            this.parser.snapshot().accountKey !== alert.toKey ||
            !this.decks.isCurrentAlert(alert))
        )
          throw new Error('DECK_RESTORE_CHANGED');
        const result = await this.decks.switchAction(action, token, alert ?? undefined);
        if (!result?.failed.length && this.deckAlert === alert) this.deckAlert = null;
        this.event({ type: 'decks', alert: this.deckAlert });
        return result;
      },
      'replays.list': () => this.files.library(),
      'replays.directory': async () => {
        const library = await this.files.library();
        return { dir: library.directory, count: library.recordings.length };
      },
      'replays.planDelete': ({ directory, names }) => this.files.planDelete(directory, names),
      'replays.planClean': ({ directory, days }) => this.files.planClean(directory, days),
      'replays.delete': async ({ token }) => {
        const result = await this.files.executeDelete(token, 'delete');
        this.event({ type: 'replays' });
        return result;
      },
      'replays.clean': async ({ token }) => {
        const result = await this.files.executeDelete(token, 'clean');
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
      'replays.release': ({ url }) => {
        platform.recordings.releasePlayback?.(url);
        return null;
      },
      'replays.move': async ({ from, to }) => {
        if (this.recordingMigrationActive) throw new Error('REPLAY_MIGRATION_BUSY');
        if (resolve(from) !== resolve(this.files.dir()))
          throw new Error('Recording source directory changed; reopen settings');
        this.recordingMigrationActive = true;
        try {
          const result = await this.files.move(from, to, () => {
            if (['starting', 'recording', 'stopping'].includes(platform.recordings.status().phase))
              throw new Error('REPLAY_MIGRATION_RECORDING_ACTIVE');
          });
          if (result.committed) this.event({ type: 'config', config: this.db.config() });
          this.event({ type: 'replays' });
          return result;
        } finally {
          this.recordingMigrationActive = false;
        }
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
      'replays.stop': async ({ sessionId }) => {
        const recording = platform.recordings.status();
        if (
          recording.sessionId !== sessionId ||
          !['starting', 'recording', 'stopping'].includes(recording.phase)
        )
          throw new Error('RECORDING_TARGET_CHANGED');
        await platform.recordings.stop(this.parser.snapshot().current || undefined);
        return platform.recordings.status();
      },
      'replays.retry': async () => {
        const session = this.parser.snapshot();
        if (
          this.recordingRetryPending ||
          !this.db.config().replayEnabled ||
          !session.current ||
          session.current.endedAt !== null ||
          session.recovering ||
          !this.watcher.status().live ||
          !!this.watcher.status().error ||
          platform.recordings.status().phase !== 'error'
        )
          throw new Error('RECORDING_RETRY_UNAVAILABLE');
        this.recordingRetryPending = true;
        try {
          await platform.recordings.start(session.current, this.db.config());
          return platform.recordings.status();
        } finally {
          this.recordingRetryPending = false;
        }
      },
      'replays.retryAudio': async ({ sessionId }) => {
        if (!this.platform.recordings.retryAudio)
          throw new Error('RECORDING_AUDIO_RETRY_UNAVAILABLE');
        await this.platform.recordings.retryAudio(sessionId);
        return this.platform.recordings.status();
      },
      'displays.list': () => platform.recordings.displays(),
      'displays.preview': ({ id }) => platform.recordings.displayPreview(id),
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
  event(event: EventInput, cause?: unknown): void {
    if (
      (event.type === 'config' && !event.config.autoQueryCurrentMatch) ||
      (event.type === 'watcher' && (event.watcher.error || event.watcher.live === false))
    )
      this.cancelAutomaticRetry();
    this.rosters = updateRosterQueries(this.rosters, {
      ...event,
      revision: this.revision + 1,
    } as AppEvent);
    if (event.type === 'matches') {
      this.publishBanChanges();
      this.publishAccountChanges();
    }
    if (event.type === 'bans') this.publishedBanSnapshot = JSON.stringify(event.list);
    if (!this.disposed && !this.closing) {
      if (event.type === 'recording') {
        const active = event.recording.phase === 'recording';
        if (active !== this.analyticsRecordingActive)
          this.analytics.feature('replays', active ? 'start' : 'stop');
        this.analyticsRecordingActive = active;
      }
      if (event.type === 'updates') this.analytics.observeUpdate(event.updates);
      if (event.type === 'error') this.analytics.error('background', cause ?? new Error());
      if (event.type === 'watcher' && event.watcher.error)
        this.analytics.error('watcher', new Error());
      if (event.type === 'recording' && event.recording.error)
        this.analytics.error('recording', new Error());
    }
    if (!this.disposed && !this.closing)
      this.broadcast({ ...event, revision: ++this.revision } as AppEvent);
    if (
      event.type === 'recording' &&
      event.recording.failure?.kind === 'metadata' &&
      event.recording.failure.savedName
    )
      this.event({ type: 'replays' });
  }
  private publishBanChanges(): void {
    if (this.disposed || this.closing) return;
    const list = this.db.bans(),
      snapshot = JSON.stringify(list);
    if (snapshot === this.publishedBanSnapshot) return;
    this.publishedBanSnapshot = snapshot;
    this.event({ type: 'bans', list, newly: [], alerts: this.db.banAlerts() });
  }
  private publishAccountChanges(): void {
    if (this.disposed || this.closing) return;
    const value = {
      list: this.db.accounts(),
      activeAccountId: this.db.state<string | null>('activeAccountId', null),
    };
    const snapshot = JSON.stringify(value);
    if (snapshot === this.publishedAccountSnapshot) return;
    this.publishedAccountSnapshot = snapshot;
    this.event({ type: 'accounts', ...value });
  }
  reportError(source: ErrorSource, error: unknown): void {
    try {
      if (source === 'startup' && !this.disposed && !this.closing) {
        const config = this.db.config();
        this.analytics.configure(
          config.analyticsEnabled && hasAnalyticsChoice(config),
          config.lang,
        );
      }
      this.analytics.error(source, error);
    } catch {
      // Diagnostic reporting must never replace the original application failure.
    }
  }
  sampleResources(): void {
    this.analytics.sampleResources();
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
      banSync: this.banSync,
      banAlerts: this.db.banAlerts(),
      updates: this.platform.updates?.status() ?? initialUpdateState(this.platform.version),
      revision: this.revision,
      config: this.db.config(),
      session: this.parser.snapshot(),
      rosters: updateRosterQueries(this.rosters, {
        type: 'session',
        session: this.parser.snapshot(),
        revision: this.revision,
      }),
      watcher: this.watcher.status(),
      recording: this.platform.recordings.status(),
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
    const completed = this.analytics.beginOperation(method);
    const task = Promise.resolve().then(() => handler(parsed));
    this.tasks.add(task);
    void task.then(
      (result) => {
        this.tasks.delete(task);
        const failedUpdate =
          method.startsWith('updates.') &&
          result &&
          typeof result === 'object' &&
          'error' in result &&
          !!result.error;
        completed(!failedUpdate);
      },
      (error) => {
        this.tasks.delete(task);
        completed(false, error);
      },
    );
    return task;
  }
  async start(): Promise<void> {
    const startedAt = performance.now();
    this.migration = await migrateLegacy(this.db, this.dir);
    if (this.platform.analytics?.enabled && this.network && !this.platform.http.offline) {
      try {
        let stored: unknown;
        try {
          stored = this.db.state('analytics:appVersion', null);
        } catch {}
        const saved = appVersionMarkerSchema.safeParse(stored);
        const previous = saved.success ? saved.data : null;
        const observed: AppVersionMarker =
          previous?.version === this.platform.version
            ? previous
            : {
                version: this.platform.version,
                ...(previous ? { previousVersion: previous.version } : {}),
                reported: false,
              };
        this.db.setState('analytics:appVersion', observed);
        this.analytics.observeAppVersion(observed, () => {
          if (!this.disposed)
            this.db.setState('analytics:appVersion', { ...observed, reported: true });
        });
      } catch {
        // Optional analytics state must not prevent the application from starting.
      }
    }
    const config = this.db.config();
    this.analytics.configure(config.analyticsEnabled && hasAnalyticsChoice(config), config.lang);
    if (this.platform.updates) this.analytics.observeUpdate(this.platform.updates.status());
    for (const row of this.db.sql.prepare('SELECT id,name FROM map_names').all())
      MAP_NAMES[Number(row.id)] = String(row.name);
    this.watcher.start(this.db.config().logDir);
    this.scanArchive(this.db.config().logDir);
    this.timers.push(
      setInterval(
        () => this.scanArchive(this.db.config().logDir),
        projectConfig.background.archiveScanIntervalMs,
      ),
    );
    this.timers.push(
      setInterval(() => {
        if (!this.network) return;
        this.fire(this.syncBackground());
      }, projectConfig.background.syncIntervalMs),
    );
    this.timers.push(
      setInterval(() => {
        if (this.network) this.fire(this.probeHealth());
      }, projectConfig.background.healthProbeIntervalMs),
    );
    this.timers.push(
      setInterval(() => {
        const recording = this.platform.recordings.status();
        if (recording.phase === 'recording') this.event({ type: 'recording', recording });
      }, 1000),
    );
    if (this.network) {
      this.fire(this.probeHealth());
      this.fire(this.syncBackground());
    }
    this.analytics.performance('service_startup', performance.now() - startedAt);
  }
  private scanArchive(dir: string): void {
    this.fire(
      this.archive
        .scan(dir)
        .catch((error) => this.event({ type: 'error', message: errorMessage(error) }, error)),
    );
  }
  private onLog(event: LogEvent): void {
    if (this.disposed || this.closing) return;
    if (event.type === 'session') {
      const session = event.session;
      if (this.autoRetry && this.autoRetry.sourceKey !== currentRosterKey(session))
        this.cancelAutomaticRetry();
      if (this.deckAlert && this.deckAlert.toKey !== session.accountKey) {
        this.deckAlert = null;
        this.event({ type: 'decks', alert: null });
      }
      this.event({ type: 'session', session });
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = null;
        this.flushSession(this.parser.snapshot());
      }, 250);
    }
    if (event.type === 'reset') {
      this.cancelAutomaticRetry();
      this.queryIds.clear();
      this.autoKey = '';
      const phase = this.platform.recordings.status().phase;
      if (!event.sourceChanged || phase !== 'error') this.restoredSession = '';
      if (event.sourceChanged) {
        if (phase === 'starting' || phase === 'recording') this.stopRecording(event.previous);
      } else if (phase !== 'stopping')
        void this.platform.recordings
          .abort()
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e));
    }
    if (event.type === 'started' && !event.recovering) {
      this.analytics.matchStarted(event.match.sessionId);
      this.deckAlert = null;
      this.event({ type: 'decks', alert: null });
      this.fire(
        this.decks
          .onMatchStart(this.parser.snapshot())
          .then(() => {
            this.deckAlert = null;
            this.event({ type: 'decks', alert: null });
          })
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e)),
      );
    }
    if (event.type === 'ended' || event.type === 'metadata') {
      if (event.recovering) this.db.observe(event.match.players, 0);
      this.db.saveMatch(event.match, !event.recovering);
      this.event({ type: 'matches' });
      if (event.type === 'ended' && !event.recovering) {
        this.stopRecording(event.match);
      }
    }
  }
  private stopRecording(match?: Match): void {
    this.fire(
      this.platform.recordings
        .stop(match)
        .catch((error) => this.event({ type: 'error', message: errorMessage(error) }, error))
        .then(() => this.flushSession(this.parser.snapshot())),
    );
  }
  private flushSession(session: Session): void {
    if (this.disposed || this.closing) return;
    const players = session.current?.players ?? session.lobbyPlayers;
    const watcher = this.watcher.status();
    const live = !!watcher.live && !watcher.error;
    this.db.observe(players, live ? Date.now() : 0);
    this.publishBanChanges();
    if (session.localPlayerId) {
      this.db.observeAccount(
        session.localPlayerId,
        session.localName,
        session.localName,
        live ? Date.now() : 0,
      );
      this.db.setState('activeAccountId', session.localPlayerId);
    }
    this.publishAccountChanges();
    if (session.recovering || watcher.error || watcher.checking) return;
    if (
      session.current &&
      live &&
      !watcher.recovering &&
      this.restoredSession !== session.current.sessionId
    ) {
      if (
        this.db.config().replayEnabled &&
        ['idle', 'error'].includes(this.platform.recordings.status().phase)
      ) {
        this.restoredSession = session.current.sessionId;
        void this.platform.recordings
          .start(session.current, this.db.config())
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e));
      }
    }
    this.fire(
      this.decks
        .switchAlert(session)
        .then((alert) => {
          if (
            alert &&
            this.parser.snapshot().accountKey === alert.toKey &&
            this.decks.isCurrentAlert(alert)
          ) {
            this.deckAlert = alert;
            this.event({ type: 'decks', alert });
          }
        })
        .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e)),
    );
    const key = currentRosterKey(session);
    if (
      this.network &&
      live &&
      this.db.config().autoQueryCurrentMatch &&
      players.length &&
      key !== this.autoKey
    ) {
      this.cancelAutomaticRetry();
      this.autoKey = key;
      this.fire(this.query({ context: 'current', requestId: randomUUID() }, { retry: true }));
    }
  }
  private cancelAutomaticRetry(): void {
    const retry = this.autoRetry;
    if (!retry) return;
    this.autoRetry = null;
    clearTimeout(retry.timer);
    if (
      this.rosters.current.sourceKey === retry.sourceKey &&
      this.rosters.current.requestId === retry.requestId
    )
      this.event({
        type: 'rosterRetry',
        context: 'current',
        requestId: retry.requestId,
        sourceKey: retry.sourceKey,
        retryAt: null,
      });
  }
  private scheduleAutomaticRetry(sourceKey: string, requestId: string, playerIds: string[]): void {
    this.cancelAutomaticRetry();
    const retryAt = Date.now() + AUTO_QUERY_RETRY_DELAY_MS;
    const retry = {
      sourceKey,
      requestId,
      timer: setTimeout(() => {
        if (this.autoRetry !== retry) return;
        this.cancelAutomaticRetry();
        const session = this.parser.snapshot(),
          watcher = this.watcher.status();
        if (
          this.disposed ||
          this.closing ||
          !this.network ||
          !watcher.live ||
          watcher.error ||
          watcher.checking ||
          watcher.recovering ||
          session.recovering ||
          !this.db.config().autoQueryCurrentMatch ||
          currentRosterKey(session) !== sourceKey ||
          this.queryIds.get('current') !== requestId
        )
          return;
        this.fire(
          this.query(
            { context: 'current', requestId: randomUUID() },
            { retry: false, playerIds: new Set(playerIds) },
          ),
        );
      }, AUTO_QUERY_RETRY_DELAY_MS),
    };
    this.autoRetry = retry;
    this.event({ type: 'rosterRetry', context: 'current', sourceKey, requestId, retryAt });
  }
  private async query(
    input: RpcInputs['session.query'],
    automatic: { retry: boolean; playerIds?: ReadonlySet<string> } | null = null,
  ): Promise<RpcOutputs['session.query']> {
    if (input.context === 'current' && !automatic) this.cancelAutomaticRetry();
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
          !/\[Bot\]|^(AI|BOT)[_-]?\d*$/i.test(p.name) &&
          (!automatic?.playerIds || automatic.playerIds.has(p.id)),
      )
      .slice(0, projectConfig.queries.maxRoomPlayers);
    const me = players.find((p) => p.id === session.localPlayerId);
    unique.sort((a, b) => Number(b.teamId !== me?.teamId) - Number(a.teamId !== me?.teamId));
    this.queryIds.set(input.context, input.requestId);
    const sourceKey =
      input.context === 'current'
        ? currentRosterKey(session)
        : previousRosterKey(input.fid, players);
    this.event({
      type: 'rosterQuery',
      requestId: input.requestId,
      context: input.context,
      sourceKey,
      pendingIds: unique.map((player) => player.id),
    });
    let queried = 0,
      cancelled = false;
    const failedIds: string[] = [];
    const active = () =>
      this.queryIds.get(input.context) === input.requestId &&
      (input.context !== 'current' || currentRosterKey(this.parser.snapshot()) === sourceKey);
    await Promise.all(
      unique.map(async (player) => {
        let info = null,
          error: string | null = null;
        try {
          info = this.analyzer.mini(await this.analyzer.report(player.id));
        } catch (e) {
          error = errorMessage(e);
        }
        if (!active()) {
          cancelled = true;
          return;
        }
        if (info) queried++;
        else failedIds.push(player.id);
        this.event({
          type: 'roster',
          requestId: input.requestId,
          sourceKey,
          context: input.context,
          generation: session.generation,
          player,
          info,
          error,
        });
      }),
    );
    if (automatic?.retry && active() && failedIds.length)
      this.scheduleAutomaticRetry(sourceKey, input.requestId, failedIds);
    return {
      requestId: input.requestId,
      queried,
      skipped: players.length - unique.length,
      cancelled,
    };
  }
  private syncBans(): Promise<Ban[]> {
    if (this.banPending) return this.banPending;
    this.banPending = Promise.resolve()
      .then(async () => {
        const attempt: BanSyncStatus = {
          ...this.banSync,
          phase: 'syncing',
          attemptId: randomUUID(),
          lastAttemptAt: Date.now(),
          error: null,
        };
        this.banSync = attempt;
        this.event({ type: 'banSync', status: attempt });
        try {
          this.db.setState('banSync', attempt);
          const result = await this.client.get(
              '/api/leaderboard/ban?limit=500&offset=0',
              'ban:500:0',
              projectConfig.cache.ttlMs.bans,
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
          const status: BanSyncStatus = {
            ...attempt,
            phase: 'success',
            lastSuccessAt: now,
            error: null,
          };
          const newly = this.db.transaction(() => {
            const newly = this.db.saveBans(list);
            this.db.setState('lastBanSync', now);
            this.db.setState('banSync', status);
            return newly;
          });
          this.banSync = status;
          this.event({ type: 'banSync', status });
          const all = this.db.bans();
          this.event({ type: 'bans', list: all, newly, alerts: this.db.banAlerts() });
          if (newly.length) {
            try {
              this.platform.notify('Ban tracker', newly.map((b) => b.name).join(', '));
            } catch (error) {
              this.event({ type: 'error', message: errorMessage(error) }, error);
            }
          }
          return all;
        } catch (error) {
          const status: BanSyncStatus = { ...attempt, phase: 'error', error: errorMessage(error) };
          this.banSync = status;
          try {
            this.db.setState('banSync', status);
          } catch {
            // Keep the runtime failure visible even if local storage is unavailable.
          }
          this.event({ type: 'banSync', status });
          throw error;
        }
      })
      .finally(() => (this.banPending = null));
    return this.banPending;
  }
  private async syncBackground(): Promise<void> {
    if (this.syncPending || this.disposed || this.closing) return;
    this.syncPending = true;
    try {
      const { banPollEnabled, matchSyncEnabled } = this.db.config();
      const jobs: Promise<unknown>[] = [];
      if (banPollEnabled) jobs.push(this.syncBans());
      if (matchSyncEnabled)
        jobs.push(
          Promise.resolve().then(async () => {
            await this.tracker.sync();
            this.event({ type: 'matches' });
          }),
        );
      await Promise.all(
        jobs.map((job) =>
          job.catch((error) => {
            this.event({ type: 'error', message: errorMessage(error) }, error);
          }),
        ),
      );
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
    if (this.stopTask) return this.stopTask;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }
  private async stopInternal(): Promise<void> {
    if (this.disposed) return;
    this.closing = true;
    await this.analytics.flush();
    this.analytics.close();
    const match = this.parser.snapshot().current;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    this.cancelAutomaticRetry();
    this.queryIds.clear();
    this.watcher.stop();
    this.archive.cancel();
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
