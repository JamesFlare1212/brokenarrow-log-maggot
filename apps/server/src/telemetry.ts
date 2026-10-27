import {
  type Locale,
  type RpcMethod,
  type UpdateState,
  type TelemetryFeature,
  type TelemetryRuntimeSample,
  type DiagnosticFrame,
} from '@ba/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { release } from 'node:os';
import {
  MAX_OUTBOX_AGE_MS,
  MAX_OUTBOX_EVENTS,
  MAX_QUEUE_EVENTS,
  TELEMETRY_BATCH_SIZE,
  TELEMETRY_APP,
  restoreOutbox,
  retryDelay,
  runSchema,
  updateAttemptSchema,
  uuid7,
  safeError,
  type ErrorSource,
  type QueuedTelemetryEvent,
  type TelemetryEnvelope,
  type TelemetryEventName,
  type TelemetryPersistence,
  type UpdateAttempt,
} from './telemetry-protocol';
export { TELEMETRY_APP, type ErrorSource } from './telemetry-protocol';
export const TELEMETRY_ENDPOINT = 'https://aptabase.jamesflare.com/api/v0/events';
// Public collection key. Administrative credentials never enter the application.
export const TELEMETRY_APP_KEY = 'A-SH-7889591672';
const operatingSystems: Record<NodeJS.Platform, string> = {
  aix: 'AIX',
  android: 'Android',
  cygwin: 'Cygwin',
  darwin: 'macOS',
  freebsd: 'FreeBSD',
  linux: 'Linux',
  haiku: 'Haiku',
  netbsd: 'NetBSD',
  openbsd: 'OpenBSD',
  sunos: 'SunOS',
  win32: 'Windows',
};
const operations: Partial<Record<RpcMethod, string>> = {
  'players.report': 'player_report',
  'players.maggot': 'maggot_report',
  'players.profile': 'player_profile',
  'session.query': 'session_query',
  'matches.add': 'match_add',
  'matches.detail': 'match_detail',
  'decks.backup': 'deck_backup',
  'decks.deploy': 'deck_deploy',
  'replays.play': 'recording_play',
  'replays.move': 'recording_move',
  'replays.test': 'recording_test',
  'updates.download': 'update_download',
  'updates.check': 'update_check',
  'updates.install': 'update_install',
  'updates.openDownload': 'update_open_download',
  'players.search': 'player_search',
  'matches.scan': 'archive_scan',
  'matches.delete': 'match_delete',
  'bans.sync': 'ban_sync',
  'accounts.delete': 'account_delete',
  'decks.delete': 'deck_delete',
  'decks.open': 'deck_open',
  'decks.switch': 'deck_switch',
  'replays.delete': 'recording_delete',
  'replays.clean': 'recording_clean',
  'replays.open': 'recording_open',
};
export interface TelemetryIdentity {
  installationId: string;
  accountHash?: string | null;
}
export function telemetryHash(kind: 'account' | 'installation', value: string): string {
  return createHash('sha256').update(`${TELEMETRY_APP}:${kind}:${value}`).digest('hex');
}
export interface InstallationState {
  version: string;
  kind: 'first_run' | 'existing_profile' | 'version_change';
  previousVersion?: string;
  reported: boolean;
  eventId?: string;
  updateEventId?: string;
}
interface TelemetryOptions {
  allowed: boolean;
  fetch: typeof fetch;
  version: string;
  distribution: 'installed' | 'portable';
  identity?: TelemetryIdentity;
  saveAccountHash?: (hash: string | null) => void;
  persistence?: TelemetryPersistence;
  sampleRuntime?: () => TelemetryRuntimeSample;
}
interface ErrorAggregate {
  payload: TelemetryEnvelope;
  repeats: number;
  at: number;
}
const criticalEvents = new Set<TelemetryEventName>([
  'app_installed',
  'app_updated',
  'match_started',
  'app_error',
  'exception_summary',
  'update_state_changed',
  'update_not_applied',
  'update_attempt_result',
  'previous_run_exit',
  'delivery_summary',
]);

/** Consent-gated telemetry. Critical events are bounded, persisted, and retried with stable UUIDs. */
export class TelemetryService {
  private enabled = false;
  private closed = false;
  private started = false;
  private restored = false;
  private language: Locale = 'en';
  private queue: QueuedTelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private controller = new AbortController();
  private inFlight: Promise<void> | null = null;
  private generation = 0;
  private identityGeneration = 0;
  private accountHash: string | null;
  private accountConfirmed = false;
  private readonly installationId: string;
  private readonly runId = randomUUID();
  private sessionId = '';
  private sessionStartedAt = 0;
  private lastActivityAt = -Infinity;
  private lastHeartbeat = 0;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = performance.now();
  private errors = new Map<string, ErrorAggregate>();
  private diagnosticTimes = new Map<string, number>();
  private updateKey = '';
  private updateStartedAt = 0;
  private updateAttempt: UpdateAttempt | null = null;
  private notAppliedVersionReported: string | null = null;
  private lastViewedFeature: TelemetryFeature | null = null;
  private lastStartedMatch = '';
  private installation: { state: InstallationState; delivered: () => void } | null = null;
  private installationQueued = false;
  private acknowledgements = new Map<string, () => void>();
  private run: ReturnType<typeof runSchema.parse> | null = null;
  private dropped = 0;
  private retried = 0;
  private persistenceFailures = 0;

  constructor(private options: TelemetryOptions) {
    this.installationId = telemetryHash(
      'installation',
      options.identity?.installationId ?? randomUUID(),
    );
    this.accountHash = /^[a-f0-9]{64}$/.test(options.identity?.accountHash ?? '')
      ? options.identity!.accountHash!
      : null;
  }
  private read(key: 'outbox' | 'run' | 'update'): unknown {
    try {
      return this.options.persistence?.read(key);
    } catch {
      this.persistenceFailures++;
      return null;
    }
  }
  private write(key: 'outbox' | 'run' | 'update', value: unknown): void {
    try {
      this.options.persistence?.write(key, value);
    } catch {
      this.persistenceFailures++;
    }
  }
  private persist(): void {
    const now = Date.now();
    this.write(
      'outbox',
      this.queue
        .filter((event) => event.critical && event.expiresAt > now)
        .slice(0, MAX_OUTBOX_EVENTS),
    );
  }
  configure(consent: boolean, language: Locale): void {
    this.language = language;
    const before = this.enabled;
    this.enabled = !this.closed && this.options.allowed && consent;
    if (before !== this.enabled) this.generation++;
    if (!this.enabled) {
      this.cancelTimers();
      this.controller.abort();
      this.controller = new AbortController();
      this.queue = [];
      this.acknowledgements.clear();
      this.errors.clear();
      this.diagnosticTimes.clear();
      this.installationQueued = false;
      this.lastViewedFeature = null;
      this.updateKey = '';
      this.sessionId = '';
      this.lastActivityAt = -Infinity;
      if (!consent && !this.closed) {
        this.write('outbox', []);
        this.write('run', null);
        this.write('update', null);
        this.restored = false;
        this.run = null;
        this.updateAttempt = null;
      }
      return;
    }
    if (!this.restored) {
      this.restored = true;
      this.queue = restoreOutbox(this.read('outbox'), Date.now(), this.installationId);
      const previous = runSchema.safeParse(this.read('run'));
      if (previous.success && previous.data.endedAt === undefined)
        this.track(
          'previous_run_exit',
          {
            previous_version: previous.data.version,
            previous_run_id: previous.data.runId,
            reason: previous.data.fatal ? 'exception' : 'unclean_exit',
          },
          false,
          previous.data.exitId,
        );
      const attempt = updateAttemptSchema.safeParse(this.read('update'));
      if (attempt.success && !attempt.data.completed) {
        const value = attempt.data;
        const outcome =
          value.stage !== 'installing'
            ? 'interrupted'
            : this.options.version === value.targetVersion
              ? 'applied'
              : this.options.version === value.fromVersion
                ? 'not_applied'
                : 'other_version';
        this.track(
          'update_attempt_result',
          {
            update_attempt_id: value.id,
            from_version: value.fromVersion,
            target_version: value.targetVersion,
            last_stage: value.stage,
            outcome,
          },
          false,
          value.resultId,
        );
        this.write('update', { ...value, completed: true });
      }
      this.run = {
        runId: this.runId,
        exitId: randomUUID(),
        version: this.options.version,
        startedAt: Date.now(),
      };
      this.write('run', this.run);
    }
    if (!this.heartbeatTimer) {
      this.lastHeartbeat = performance.now();
      this.lastCpuAt = this.lastHeartbeat;
      this.lastCpu = process.cpuUsage();
      this.heartbeatTimer = setInterval(() => this.heartbeat(), 60000);
      this.heartbeatTimer.unref?.();
    }
    this.reportInstallation();
    if (!this.started) {
      this.started = true;
      this.track('app_started', {}, true);
    } else if (!before) this.heartbeat();
    this.schedule();
  }
  identifyAccount(accountId: string | null): void {
    const hash =
      accountId && /^\d{1,32}$/.test(accountId) ? telemetryHash('account', accountId) : null;
    const changed = hash !== this.accountHash;
    const confirmationChanged = !!hash && !this.accountConfirmed;
    this.accountConfirmed = !!hash;
    if (!changed && !confirmationChanged) return;
    this.flushErrors(true);
    this.accountHash = hash;
    try {
      this.options.saveAccountHash?.(hash);
    } catch {
      this.persistenceFailures++;
    }
    if (!this.enabled) return;
    if (changed) {
      this.identityGeneration++;
      this.sessionId = '';
      this.lastActivityAt = -Infinity;
    }
    this.track('user_identified', {}, false);
  }
  private runtime(): TelemetryRuntimeSample {
    try {
      return this.options.sampleRuntime?.() ?? { foreground: false, active: false };
    } catch {
      return { foreground: false, active: false };
    }
  }
  samplePresence(): void {
    if (this.enabled) this.heartbeat();
  }
  private heartbeat(): void {
    if (!this.enabled) return;
    this.flushErrors();
    const now = performance.now(),
      elapsed = Math.max(1, now - this.lastCpuAt);
    const cpu = process.cpuUsage(this.lastCpu),
      memory = process.memoryUsage();
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
    const runtime = this.runtime();
    const resources: Record<string, number> = {};
    for (const key of ['renderer_cpu_percent', 'renderer_rss_mb', 'renderer_processes'] as const) {
      const value = runtime[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        resources[key] = Math.round(value * 100) / 100;
    }
    this.track(
      'app_heartbeat',
      {
        uptime_seconds: Math.round(process.uptime()),
        rss_mb: Math.round(memory.rss / 1048576),
        heap_used_mb: Math.round(memory.heapUsed / 1048576),
        cpu_percent: Math.round(((cpu.user + cpu.system) / (elapsed * 10)) * 100) / 100,
        timer_lag_ms: Math.min(60000, Math.max(0, Math.round(now - this.lastHeartbeat - 60000))),
        foreground: runtime.foreground === true,
        active: runtime.foreground === true && runtime.active === true,
        delivery_dropped_total: this.dropped,
        delivery_retried_total: this.retried,
        persistence_failures_total: this.persistenceFailures,
        buffered_events: this.queue.length,
        ...resources,
      },
      runtime.foreground && runtime.active,
    );
    this.lastHeartbeat = now;
  }
  feature(feature: TelemetryFeature, action: 'view' | 'start' | 'stop' = 'view'): void {
    if (!this.enabled) return;
    if (action === 'view') {
      if (this.lastViewedFeature === feature) return;
      this.lastViewedFeature = feature;
    }
    this.track('feature_used', { feature, action }, true);
  }
  performance(
    metric: 'service_startup' | 'renderer_startup' | 'renderer_long_task',
    durationMs: number,
  ): void {
    if (!this.enabled || !Number.isFinite(durationMs) || durationMs < 0) return;
    if (performance.now() - (this.diagnosticTimes.get(metric) ?? -Infinity) < 60000) return;
    this.diagnosticTimes.set(metric, performance.now());
    this.track('performance_sample', {
      metric,
      duration_ms: Math.min(600000, Math.round(durationMs)),
    });
  }
  longTasks(sample: {
    count: number;
    totalMs: number;
    maxMs: number;
    blockingMs: number;
    windowMs: number;
  }): void {
    this.track('performance_sample', {
      metric: 'renderer_long_tasks',
      duration_ms: Math.round(sample.maxMs),
      task_count: sample.count,
      total_duration_ms: Math.round(sample.totalMs),
      blocking_duration_ms: Math.round(sample.blockingMs),
      window_ms: Math.round(sample.windowMs),
    });
  }
  error(
    source: ErrorSource,
    error: unknown,
    operation?: RpcMethod,
    suppliedFrames?: DiagnosticFrame[],
  ): void {
    if (!this.enabled) return;
    this.flushErrors();
    const value = safeError(error, suppliedFrames),
      context = operation ?? source;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          source,
          context,
          value.type,
          value.code,
          value.status,
          value.frames.map((frame) => [frame.filename, frame.lineno, frame.colno]),
        ]),
      )
      .digest('hex');
    const key = `${this.accountHash ?? this.installationId}:${fingerprint}`;
    const existing = this.errors.get(key);
    if (existing) {
      existing.repeats++;
      return;
    }
    if (this.errors.size >= 100) {
      this.dropped++;
      return;
    }
    const fatal = source === 'main' || source === 'renderer_crash' || source === 'startup';
    if ((source === 'main' || source === 'startup') && this.run) {
      this.run.fatal = true;
      this.write('run', this.run);
    }
    const frames = Object.fromEntries(
      value.frames.map((frame, index) => [
        `error_frame_${index + 1}`,
        `${frame.filename}:${frame.lineno}:${frame.colno}`,
      ]),
    );
    const payload = this.track('app_error', {
      source,
      operation,
      error_type: value.type,
      error_code: value.code,
      http_status: value.status,
      occurrences: 1,
      error_level: fatal ? 'fatal' : 'error',
      error_fingerprint: fingerprint,
      ...frames,
    });
    if (payload) this.errors.set(key, { payload, repeats: 0, at: performance.now() });
  }
  private flushErrors(force = false): void {
    if (!this.enabled) return;
    for (const [key, item] of this.errors) {
      if (!force && performance.now() - item.at < 60000) continue;
      if (item.repeats)
        this.enqueue({
          ...item.payload,
          eventName: 'exception_summary',
          timestamp: item.payload.timestamp,
          props: { ...item.payload.props, event_id: randomUUID(), occurrences: item.repeats },
        });
      this.errors.delete(key);
    }
  }
  observeUpdate(state: UpdateState): void {
    if (!this.enabled || state.mode === 'disabled') return;
    const key = `${state.status}:${state.availableVersion}:${state.errorContext}:${state.notAppliedVersion}`;
    if (key === this.updateKey) return;
    const now = performance.now(),
      duration = this.updateStartedAt
        ? Math.max(0, Math.round(now - this.updateStartedAt))
        : undefined;
    this.updateKey = key;
    this.updateStartedAt = now;
    if (
      state.availableVersion &&
      ['available', 'downloading', 'downloaded', 'installing'].includes(state.status)
    ) {
      if (
        !this.updateAttempt ||
        this.updateAttempt.completed ||
        this.updateAttempt.targetVersion !== state.availableVersion
      )
        this.updateAttempt = {
          id: randomUUID(),
          resultId: randomUUID(),
          fromVersion: this.options.version,
          targetVersion: state.availableVersion,
          stage: state.status as UpdateAttempt['stage'],
          at: Date.now(),
        };
      else this.updateAttempt.stage = state.status as UpdateAttempt['stage'];
      this.write('update', this.updateAttempt);
    }
    if (['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.status))
      this.track('update_state_changed', {
        status: state.status,
        target_version: state.availableVersion,
        error_context: state.errorContext,
        duration_ms: duration,
        update_attempt_id: this.updateAttempt?.id,
      });
    if (state.error) {
      if (this.updateAttempt && state.errorContext !== 'check') {
        this.track(
          'update_attempt_result',
          {
            update_attempt_id: this.updateAttempt.id,
            from_version: this.updateAttempt.fromVersion,
            target_version: this.updateAttempt.targetVersion,
            last_stage: state.errorContext,
            outcome: 'failed',
          },
          false,
          this.updateAttempt.resultId,
        );
        this.updateAttempt.completed = true;
        this.write('update', this.updateAttempt);
      }
      this.error(
        'update',
        new Error(),
        state.errorContext === 'download'
          ? 'updates.download'
          : state.errorContext === 'install'
            ? 'updates.install'
            : 'updates.check',
      );
    }
    if (state.notAppliedVersion && state.notAppliedVersion !== this.notAppliedVersionReported) {
      this.notAppliedVersionReported = state.notAppliedVersion;
      this.track('update_not_applied', { target_version: state.notAppliedVersion });
    }
  }
  observeInstallation(state: InstallationState, delivered: () => void): void {
    if (state.reported) return;
    this.installation = { state, delivered };
    this.reportInstallation();
  }
  private reportInstallation(): void {
    const installation = this.installation;
    if (!this.enabled || !installation || this.installationQueued) return;
    const state = installation.state;
    state.eventId ??= randomUUID();
    state.updateEventId ??= randomUUID();
    this.acknowledgements.set(state.eventId, () => {
      installation.delivered();
      if (this.installation === installation) this.installation = null;
    });
    this.installationQueued = !!this.track(
      'app_installed',
      {
        kind: state.kind,
        ...(state.previousVersion ? { previous_version: state.previousVersion } : {}),
      },
      false,
      state.eventId,
    );
    if (this.installationQueued && state.kind === 'version_change')
      this.track(
        'app_updated',
        { previous_version: state.previousVersion, version: state.version },
        false,
        state.updateEventId,
      );
  }
  matchStarted(sessionId: string): void {
    if (!sessionId || sessionId === this.lastStartedMatch) return;
    // Keep the local match key out of telemetry and suppress repeated start notifications.
    this.lastStartedMatch = sessionId;
    this.track('match_started', {}, true);
  }
  beginOperation(method: RpcMethod): (success: boolean, error?: unknown) => void {
    if (!this.enabled || method === 'diagnostics.report') return () => {};
    const generation = this.generation,
      identityGeneration = this.identityGeneration,
      startedAt = performance.now();
    return (success, error) => {
      if (generation !== this.generation || identityGeneration !== this.identityGeneration) return;
      this.operation(method, success, performance.now() - startedAt);
      if (!success && error !== undefined) this.error('rpc', error, method);
    };
  }
  operation(method: RpcMethod, success: boolean, durationMs: number): void {
    const operation = operations[method];
    if (!operation || !Number.isFinite(durationMs) || durationMs < 0) return;
    this.track(
      'operation_completed',
      {
        operation,
        result: success ? 'success' : 'failure',
        duration: durationMs < 1000 ? 'under_1s' : durationMs < 10000 ? '1_to_10s' : 'over_10s',
        duration_ms: Math.min(3600000, Math.max(0, Math.round(durationMs))),
      },
      true,
    );
  }
  private track(
    name: TelemetryEventName,
    data: Record<string, unknown>,
    activity = false,
    eventId: string = randomUUID(),
  ): TelemetryEnvelope | null {
    if (!this.enabled) return null;
    const duplicate = this.queue.find((item) => item.payload.props.event_id === eventId);
    if (duplicate) return duplicate.payload;
    const now = Date.now(),
      mono = performance.now();
    if (
      !this.sessionId ||
      (activity &&
        Number.isFinite(this.lastActivityAt) &&
        mono - this.lastActivityAt >= 30 * 60 * 1000) ||
      now - this.sessionStartedAt >= 24 * 60 * 60 * 1000 - 60000 ||
      now < this.sessionStartedAt
    ) {
      this.sessionId = uuid7(now);
      this.sessionStartedAt = now;
    }
    if (activity) this.lastActivityAt = mono;
    const hasSession =
      this.sessionId &&
      mono - this.lastActivityAt < 30 * 60 * 1000 &&
      now >= this.sessionStartedAt &&
      now - this.sessionStartedAt < 24 * 60 * 60 * 1000;
    const properties: Record<string, unknown> = {
      event_id: eventId,
      identity_hash: this.accountHash ?? this.installationId,
      app: TELEMETRY_APP,
      version: this.options.version,
      distribution: this.options.distribution,
      language: this.language,
      installation_id: this.installationId,
      app_session_id: this.runId,
      ...(hasSession ? { session_id: this.sessionId } : {}),
      identity_source: this.accountHash ? 'game_account' : 'installation',
      identity_confidence: this.accountHash
        ? this.accountConfirmed
          ? 'confirmed'
          : 'cached'
        : 'installation',
      platform: process.platform,
      arch: process.arch,
      telemetry_schema: 4,
      ...data,
    };
    // Aptabase supports flat strings/numbers. Omit absent values and encode booleans as 0/1.
    const props: TelemetryEnvelope['props'] = {};
    for (const [key, value] of Object.entries(properties)) {
      if (typeof value === 'boolean') props[key] = value ? 1 : 0;
      else if (typeof value === 'string') props[key] = value.slice(0, 180);
      else if (typeof value === 'number' && Number.isFinite(value)) props[key] = value;
    }
    const payload: TelemetryEnvelope = {
      eventName: name,
      sessionId: this.sessionId,
      timestamp: new Date(now).toISOString(),
      systemProps: {
        isDebug: false,
        osName: operatingSystems[process.platform],
        osVersion: release(),
        locale: this.language,
        appVersion: this.options.version,
        engineName: process.versions.electron ? 'Electron' : 'Node.js',
        engineVersion: process.versions.electron ?? process.versions.node,
        sdkVersion: 'baradar-aptabase@1',
      },
      props,
    };
    return this.enqueue(payload) ? payload : null;
  }
  private enqueue(payload: TelemetryEnvelope): boolean {
    const critical = criticalEvents.has(payload.eventName);
    if (critical && this.queue.filter((item) => item.critical).length >= MAX_OUTBOX_EVENTS) {
      const victim = this.queue.findIndex(
        (item) =>
          item.payload.eventName === 'app_error' || item.payload.eventName === 'exception_summary',
      );
      if (victim < 0) {
        this.dropped++;
        return false;
      }
      this.queue.splice(victim, 1);
      this.dropped++;
    }
    if (this.queue.length >= MAX_QUEUE_EVENTS) {
      const victim = this.queue.findIndex((item) => !item.critical);
      if (!critical || victim < 0) {
        this.dropped++;
        return false;
      }
      this.queue.splice(victim, 1);
      this.dropped++;
    }
    this.queue.push({
      payload,
      critical,
      attempts: 0,
      nextAttemptAt: Date.now(),
      expiresAt: Date.now() + MAX_OUTBOX_AGE_MS,
    });
    if (critical) this.persist();
    this.schedule();
    return true;
  }
  private schedule(): void {
    if (!this.enabled || this.inFlight || this.timer || !this.queue.length) return;
    const next = Math.min(
      ...this.queue.filter((item) => item.attempts < 5).map((item) => item.nextAttemptAt),
    );
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.send();
      },
      Math.max(1000, next - Date.now()),
    );
    this.timer.unref?.();
  }
  private send(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inFlight = this.sendBatch().finally(() => {
      this.inFlight = null;
      this.schedule();
    });
    return this.inFlight;
  }
  private async sendBatch(): Promise<void> {
    const now = Date.now(),
      generation = this.generation;
    const expired = this.queue.filter((item) => item.expiresAt <= now);
    this.dropped += expired.length;
    this.queue = this.queue.filter((item) => item.expiresAt > now);
    const batch = this.queue
      .filter((item) => item.attempts < 5 && item.nextAttemptAt <= now)
      .slice(0, TELEMETRY_BATCH_SIZE);
    if (!batch.length) {
      this.persist();
      return;
    }
    if (batch.some((item) => item.attempts > 0)) this.retried++;
    let accepted = false,
      retryable = true,
      retryAfter: string | null = null;
    try {
      const response = await this.options.fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'App-Key': TELEMETRY_APP_KEY },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(3000)]),
        body: JSON.stringify(batch.map((item) => item.payload)),
      });
      retryAfter = response.headers.get('Retry-After');
      retryable =
        response.ok || response.status === 408 || response.status === 429 || response.status >= 500;
      // Aptabase acknowledges successful ingestion with an empty JSON object.
      accepted = response.ok;
      await response.body?.cancel();
    } catch {
      /* Delivery failures never enter the application's error UI. */
    }
    if (!this.enabled || generation !== this.generation) return;
    for (const item of batch) {
      if (!this.queue.includes(item)) continue;
      if (accepted) {
        this.queue.splice(this.queue.indexOf(item), 1);
        try {
          this.acknowledgements.get(String(item.payload.props.event_id))?.();
        } catch {
          this.persistenceFailures++;
        }
        this.acknowledgements.delete(String(item.payload.props.event_id));
      } else {
        item.attempts++;
        if (!retryable || (!item.critical && item.attempts >= 5)) {
          this.queue.splice(this.queue.indexOf(item), 1);
          this.dropped++;
        } else {
          item.nextAttemptAt = Date.now() + retryDelay(item.attempts, retryAfter, Date.now());
        }
      }
    }
    this.persist();
  }
  async flush(timeoutMs = 1500): Promise<void> {
    if (!this.enabled) return;
    this.flushErrors(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drain = async () => {
      do {
        if (
          !this.queue.some((item) => item.attempts < 5 && item.nextAttemptAt <= Date.now()) &&
          !this.inFlight
        )
          break;
        await this.send();
      } while (this.enabled);
    };
    try {
      await Promise.race([
        drain(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private cancelTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
  }
  close(): void {
    if (this.closed) return;
    this.flushErrors(true);
    if (this.enabled) {
      this.dropped += this.queue.filter((item) => !item.critical).length;
      if (this.dropped || this.retried || this.persistenceFailures)
        this.track('delivery_summary', {
          delivery_dropped_total: this.dropped,
          delivery_retried_total: this.retried,
          persistence_failures_total: this.persistenceFailures,
        });
    }
    if (this.restored) this.persist();
    if (this.enabled && this.run) {
      this.run.endedAt = Date.now();
      this.write('run', this.run);
    }
    this.closed = true;
    this.enabled = false;
    this.generation++;
    this.cancelTimers();
    this.controller.abort();
    this.queue = [];
    this.errors.clear();
    this.acknowledgements.clear();
  }
}
