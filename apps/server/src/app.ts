import { join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  AppEvent,
  ApmState,
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
import {
  rpcSchemas,
  initialUpdateState,
  UPDATE_RELEASES_URL,
  TELEMETRY_CONSENT_VERSION,
  hasTelemetryConsent,
} from '@ba/contracts';
import { array, object, text, number, errorMessage, MAP_NAMES } from '@ba/shared';
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
import { projectConfig } from './config';
import type { Platform } from './ports';
import { TelemetryService, type VersionObservation, type ErrorSource } from './telemetry';
import { versionObservationSchema } from './telemetry-protocol';
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
  private archive: LogArchive;
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
  private telemetry: TelemetryService;
  private existingInstallation: boolean;
  private apmTasks = Promise.resolve();
  private lastApmStatus: ApmState['status'] | null = null;
  private apmCheckpointAt = -Infinity;
  private telemetryApmActive = false;
  private telemetryRecordingActive = false;
  constructor(
    private dir: string,
    private platform: Platform,
    private broadcast: (event: AppEvent) => void,
    private network = true,
  ) {
    this.existingInstallation = existsSync(join(dir, 'assistant.sqlite'));
    this.db = new Database(join(dir, 'assistant.sqlite'));
    try {
      // Retire pseudonymous identities and durable payloads before any telemetry can resume.
      this.db.sql
        .prepare(
          `DELETE FROM app_state WHERE key IN (
        'telemetryIdentity', 'telemetryInstallation', 'telemetry:outbox:v1',
        'telemetry:run:v1', 'telemetry:update:v1'
      )`,
        )
        .run();
    } catch {
      // Cleanup failure must not prevent startup; retired state is never read for collection.
    }
    this.telemetry = new TelemetryService({
      allowed: !!platform.telemetry?.enabled && network && !platform.http.offline,
      fetch: platform.http.fetch,
      version: platform.version,
      distribution: platform.telemetry?.distribution ?? 'installed',
      persistence: {
        read: (key) => this.db.state(`telemetry:${key}:v2`, null),
        write: (key, value) => {
          if (!this.disposed) this.db.setState(`telemetry:${key}:v2`, value);
        },
      },
      sampleRuntime: platform.telemetry?.sampleRuntime,
    });
    this.db.recoverApmCaptures();
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
        if (input.type === 'feature') this.telemetry.feature(input.feature);
        else if (input.type === 'error')
          this.telemetry.error(input.source, { name: input.errorType }, undefined, input.frames);
        else if (input.type === 'long_tasks') this.telemetry.longTasks(input);
        else this.telemetry.performance(input.metric, input.durationMs);
        return null;
      },
      'apm.history': () => this.db.apmHistory(),
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
      'cache.stats': () => this.db.cacheStats(),
      'cache.clear': ({ mode }) => this.db.clearCache(mode),
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
          next = this.db.updateConfig({
            ...patch,
            ...(typeof patch.telemetryEnabled === 'boolean'
              ? {
                  telemetryConsentConfirmed: true,
                  telemetryConsentVersion: TELEMETRY_CONSENT_VERSION,
                }
              : {}),
          });
        this.telemetry.configure(next.telemetryEnabled && hasTelemetryConsent(next), next.lang);
        if (platform.updates) this.telemetry.observeUpdate(platform.updates.status());
        this.event({ type: 'config', config: next });
        if (before.logDir !== next.logDir) {
          await this.queueApm(() => this.finishApm(true));
          this.archive.cancel();
          this.watcher.start(next.logDir);
          this.scanArchive(next.logDir);
        }
        if (before.inputHookEnabled && !next.inputHookEnabled) {
          await this.queueApm(async () => {
            await this.finishApm(true);
            await this.platform.apm.disable();
            this.publishApm();
          });
        }
        if (
          !before.inputHookEnabled &&
          next.inputHookEnabled &&
          this.watcher.status().live &&
          this.parser.snapshot().current
        ) {
          const match = this.parser.snapshot().current!;
          await this.queueApm(() => this.startApm(match, true));
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
          this.db.observe(players);
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
      'players.profile': ({ id, force }) => this.tracker.profile(id, force),
      'session.query': (input) => this.query(input),
      'matches.list': ({ accountId }) => this.tracker.list(accountId),
      'matches.scan': async () => {
        await this.archive.scan(this.db.config().logDir);
        return null;
      },
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
  event(event: EventInput, cause?: unknown): void {
    if (!this.disposed && !this.closing) {
      if (event.type === 'apm') {
        const active = event.apm.status === 'active';
        if (active !== this.telemetryApmActive)
          this.telemetry.feature('apm', active ? 'start' : 'stop');
        this.telemetryApmActive = active;
      }
      if (event.type === 'recording') {
        const active = event.recording.phase === 'recording';
        if (active !== this.telemetryRecordingActive)
          this.telemetry.feature('replays', active ? 'start' : 'stop');
        this.telemetryRecordingActive = active;
      }
      if (event.type === 'updates') this.telemetry.observeUpdate(event.updates);
      if (event.type === 'error') this.telemetry.error('background', cause ?? new Error());
      if (event.type === 'watcher' && event.watcher.error)
        this.telemetry.error('watcher', new Error());
      if (event.type === 'recording' && event.recording.error)
        this.telemetry.error('recording', new Error());
      if (event.type === 'apm' && event.apm.error) this.telemetry.error('apm', new Error());
    }
    if (!this.disposed && !this.closing)
      this.broadcast({ ...event, revision: ++this.revision } as AppEvent);
  }
  reportError(source: ErrorSource, error: unknown): void {
    try {
      if (source === 'startup' && !this.disposed && !this.closing) {
        const config = this.db.config();
        this.telemetry.configure(
          config.telemetryEnabled && hasTelemetryConsent(config),
          config.lang,
        );
      }
      this.telemetry.error(source, error);
    } catch {
      // Diagnostic reporting must never replace the original application failure.
    }
  }
  samplePresence(): void {
    this.telemetry.samplePresence();
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
    const completed = this.telemetry.beginOperation(method);
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
    if (this.platform.telemetry?.enabled && this.network && !this.platform.http.offline) {
      try {
        let stored: unknown;
        try {
          stored = this.db.state('telemetryVersion', null);
        } catch {}
        const saved = versionObservationSchema.safeParse(stored);
        const previous = saved.success ? saved.data : null;
        const observed: VersionObservation =
          previous?.version === this.platform.version
            ? previous
            : {
                version: this.platform.version,
                kind: previous
                  ? 'version_change'
                  : this.existingInstallation || Object.keys(this.migration.imported).length
                    ? 'existing_profile'
                    : 'first_run',
                ...(previous ? { previousVersion: previous.version } : {}),
                reported: false,
              };
        this.db.setState('telemetryVersion', observed);
        this.telemetry.observeVersion(observed, () => {
          if (!this.disposed) this.db.setState('telemetryVersion', { ...observed, reported: true });
        });
      } catch {
        // Optional telemetry state must not prevent the application from starting.
      }
    }
    const config = this.db.config();
    this.telemetry.configure(config.telemetryEnabled && hasTelemetryConsent(config), config.lang);
    if (this.platform.updates) this.telemetry.observeUpdate(this.platform.updates.status());
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
        const apm = this.platform.apm.status();
        if (apm.status === 'active' || apm.status !== this.lastApmStatus)
          this.publishApm(performance.now() - this.apmCheckpointAt >= 5000);
        const recording = this.platform.recordings.status();
        if (recording.phase === 'recording') this.event({ type: 'recording', recording });
      }, 1000),
    );
    if (this.network) {
      this.fire(this.probeHealth());
      this.fire(this.syncBackground());
    }
    this.telemetry.performance('service_startup', performance.now() - startedAt);
  }
  private scanArchive(dir: string): void {
    this.fire(
      this.archive
        .scan(dir)
        .catch((error) => this.event({ type: 'error', message: errorMessage(error) }, error)),
    );
  }
  private queueApm(work: () => Promise<void>): Promise<void> {
    const task = this.apmTasks.then(work);
    this.apmTasks = task.catch((error) => {
      this.event({ type: 'error', message: errorMessage(error) }, error);
    });
    return this.apmTasks;
  }
  private publishApm(checkpoint = true): void {
    const apm = this.platform.apm.status();
    if (checkpoint || apm.status !== 'active') {
      this.db.saveApm(apm);
      this.apmCheckpointAt = performance.now();
    }
    this.lastApmStatus = apm.status;
    this.event({ type: 'apm', apm });
  }
  private async startApm(match: Match, partial = false): Promise<void> {
    const current = this.platform.apm.status();
    if (current.status === 'active' && current.sessionId === match.sessionId) {
      this.platform.apm.updateMatch(match);
      return;
    }
    await this.finishApm(true);
    await this.platform.apm.start(match, partial);
    this.publishApm();
  }
  private async finishApm(interrupted = false, match?: Match): Promise<void> {
    if (match) this.platform.apm.updateMatch(match);
    await this.platform.apm.stop(interrupted);
    this.publishApm();
  }
  private onLog(event: LogEvent): void {
    if (this.disposed || this.closing) return;
    if (event.type === 'session') {
      const session = event.session;
      if (session.current) {
        const match = session.current;
        void this.queueApm(async () => {
          this.platform.apm.updateMatch(match);
          this.db.updateApmMatch(match);
        });
      }
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
      void this.queueApm(() => this.finishApm(true));
      if (this.platform.recordings.status().phase !== 'stopping')
        void this.platform.recordings
          .abort()
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e));
    }
    if (event.type === 'started' && !event.recovering) {
      this.telemetry.matchStarted(event.match.sessionId);
      const config = this.db.config();
      if (config.inputHookEnabled) void this.queueApm(() => this.startApm(event.match));
      this.fire(
        this.decks
          .onMatchStart(this.parser.snapshot())
          .then(() => this.event({ type: 'decks', alert: null }))
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e)),
      );
      if (config.replayEnabled)
        void this.platform.recordings
          .start(event.match, config)
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e));
    }
    if (event.type === 'ended' || event.type === 'metadata') {
      if (event.recovering) this.db.observe(event.match.players, 0);
      this.db.saveMatch(event.match, !event.recovering);
      this.event({ type: 'matches' });
      if (event.type === 'ended' && !event.recovering) {
        void this.queueApm(() => this.finishApm(false, event.match));
        void this.platform.recordings
          .stop(event.match)
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e));
      }
      void this.queueApm(async () => {
        this.platform.apm.updateMatch(event.match);
        this.db.updateApmMatch(event.match);
        if (this.platform.apm.status().sessionId === event.match.sessionId) this.publishApm();
      });
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
      if (this.db.config().inputHookEnabled)
        void this.queueApm(() => this.startApm(session.current!, true));
      if (this.db.config().replayEnabled && this.platform.recordings.status().phase === 'idle')
        void this.platform.recordings
          .start(session.current, this.db.config())
          .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e));
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
        .catch((e) => this.event({ type: 'error', message: errorMessage(e) }, e)),
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
        this.event({ type: 'error', message: errorMessage(e) }, e),
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
      .slice(0, projectConfig.queries.maxRoomPlayers);
    const me = players.find((p) => p.id === session.localPlayerId);
    unique.sort((a, b) => Number(b.teamId !== me?.teamId) - Number(a.teamId !== me?.teamId));
    this.queryIds.set(input.context, input.requestId);
    let queried = 0,
      cancelled = false;
    const active = () =>
      this.queryIds.get(input.context) === input.requestId &&
      (input.context !== 'current' || this.parser.snapshot().generation === session.generation);
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
        this.event({
          type: 'roster',
          requestId: input.requestId,
          context: input.context,
          generation: session.generation,
          player,
          info,
          error,
        });
      }),
    );
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
      this.event({ type: 'error', message: errorMessage(e) }, e);
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
    await this.telemetry.flush();
    this.telemetry.close();
    const match = this.parser.snapshot().current;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    this.queryIds.clear();
    this.watcher.stop();
    this.archive.cancel();
    await this.queueApm(async () => {
      await this.finishApm(true, match || undefined);
      await this.platform.apm.disable();
    });
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
