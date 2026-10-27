import {
  type Locale,
  type RpcMethod,
  type UpdateState,
  type TelemetryFeature,
  type TelemetryRuntimeSample,
  type DiagnosticFrame,
} from '@ba/contracts';
import { createHash } from 'node:crypto';
import { release } from 'node:os';
import {
  MAX_QUEUE_EVENTS,
  MAX_EVENT_AGE_MS,
  SESSION_TIMEOUT_MS,
  TELEMETRY_BATCH_SIZE,
  retryDelay,
  updateAttemptSchema,
  newSessionId,
  safeError,
  type ErrorSource,
  type QueuedTelemetryEvent,
  type TelemetryEnvelope,
  type TelemetryEventName,
  type TelemetryPersistence,
  type UpdateAttempt,
  type VersionObservation,
} from './telemetry-protocol';
export { type ErrorSource, type VersionObservation } from './telemetry-protocol';
export const TELEMETRY_ENDPOINT = 'https://aptabase.jamesflare.com/api/v0/events';
// Public ingestion key, never an administrative credential.
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
interface TelemetryOptions {
  allowed: boolean;
  fetch: typeof fetch;
  version: string;
  distribution: 'installed' | 'portable';
  persistence?: TelemetryPersistence;
  sampleRuntime?: () => TelemetryRuntimeSample;
}
interface ErrorAggregate {
  payload: TelemetryEnvelope;
  repeats: number;
  at: number;
}

/** Anonymous Aptabase events with consent gating and a short-lived memory queue. */
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
  private sessionId = '';
  private sessionStartedAt = 0;
  private lastEventAt = 0;
  private lastEventMono = -Infinity;
  private lastHeartbeat = -Infinity;
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
  private versionObservation: { state: VersionObservation; delivered: () => void } | null = null;
  private versionQueued = false;

  constructor(private options: TelemetryOptions) {}
  private writeUpdate(value: UpdateAttempt | null): void {
    try {
      this.options.persistence?.write('update', value);
    } catch {
      // Optional analytics storage must not affect application behavior.
    }
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
      this.errors.clear();
      this.diagnosticTimes.clear();
      this.versionQueued = false;
      this.lastViewedFeature = null;
      this.updateKey = '';
      this.sessionId = '';
      this.lastEventMono = -Infinity;
      if (!consent && !this.closed) {
        this.writeUpdate(null);
        this.restored = false;
        this.updateAttempt = null;
      }
      return;
    }
    // Start the native anonymous session before version observations and recovery results.
    if (!this.started) {
      this.started = true;
      this.track('app_started', {});
    }
    if (!this.restored) {
      this.restored = true;
      let saved: unknown;
      try {
        saved = this.options.persistence?.read('update');
      } catch {}
      const attempt = updateAttemptSchema.safeParse(saved);
      if (attempt.success) {
        const value = attempt.data;
        const outcome =
          value.stage !== 'installing'
            ? 'interrupted'
            : this.options.version === value.targetVersion
              ? 'applied'
              : this.options.version === value.fromVersion
                ? 'not_applied'
                : 'other_version';
        this.track('update_attempt_result', {
          from_version: value.fromVersion,
          target_version: value.targetVersion,
          last_stage: value.stage,
          outcome,
        });
        this.writeUpdate(null);
      } else if (saved != null) this.writeUpdate(null);
    }
    this.reportVersion();
    if (!this.heartbeatTimer) {
      this.lastCpuAt = performance.now();
      this.lastCpu = process.cpuUsage();
      this.heartbeatTimer = setInterval(() => this.samplePresence(), 60000);
      this.heartbeatTimer.unref?.();
    }
    this.schedule();
  }
  private runtime(): TelemetryRuntimeSample {
    try {
      return this.options.sampleRuntime?.() ?? { foreground: false, active: false };
    } catch {
      return { foreground: false, active: false };
    }
  }
  samplePresence(): void {
    if (!this.enabled) return;
    this.flushErrors();
    const now = performance.now(),
      runtime = this.runtime();
    if (!runtime.foreground || !runtime.active || now - this.lastHeartbeat < 60000) return;
    const elapsed = Math.max(1, now - this.lastCpuAt),
      cpu = process.cpuUsage(this.lastCpu),
      memory = process.memoryUsage();
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
    const resources: Record<string, number> = {};
    for (const key of ['renderer_cpu_percent', 'renderer_rss_mb', 'renderer_processes'] as const) {
      const value = runtime[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        resources[key] = Math.round(value * 100) / 100;
    }
    this.track('app_heartbeat', {
      rss_mb: Math.round(memory.rss / 1048576),
      heap_used_mb: Math.round(memory.heapUsed / 1048576),
      cpu_percent: Math.round(((cpu.user + cpu.system) / (elapsed * 10)) * 100) / 100,
      ...resources,
    });
    this.lastHeartbeat = now;
  }
  feature(feature: TelemetryFeature, action: 'view' | 'start' | 'stop' = 'view'): void {
    if (!this.enabled) return;
    if (action === 'view') {
      if (this.lastViewedFeature === feature) return;
      this.lastViewedFeature = feature;
    }
    this.track('feature_used', { feature, action });
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
    const existing = this.errors.get(fingerprint);
    if (existing) {
      existing.repeats++;
      return;
    }
    if (this.errors.size >= 100) {
      return;
    }
    const fatal = source === 'main' || source === 'renderer_crash' || source === 'startup';
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
    if (payload) this.errors.set(fingerprint, { payload, repeats: 0, at: performance.now() });
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
          props: { ...item.payload.props, occurrences: item.repeats },
        });
      this.errors.delete(key);
    }
  }
  observeUpdate(state: UpdateState): void {
    if (!this.enabled || state.mode === 'disabled') return;
    const key = `${state.status}:${state.availableVersion}:${state.errorContext}:${state.notAppliedVersion}`;
    if (key === this.updateKey) return;
    const now = performance.now();
    const duration = this.updateStartedAt
      ? Math.max(0, Math.round(now - this.updateStartedAt))
      : undefined;
    this.updateKey = key;
    this.updateStartedAt = now;
    if (
      state.availableVersion &&
      ['available', 'downloading', 'downloaded', 'installing'].includes(state.status)
    ) {
      this.updateAttempt = {
        fromVersion: this.options.version,
        targetVersion: state.availableVersion,
        stage: state.status as UpdateAttempt['stage'],
      };
      this.writeUpdate(this.updateAttempt);
    }
    if (['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.status))
      this.track('update_state_changed', {
        status: state.status,
        target_version: state.availableVersion,
        error_context: state.errorContext,
        duration_ms: duration,
      });
    if (state.error) {
      if (this.updateAttempt && state.errorContext !== 'check') {
        this.track('update_attempt_result', {
          from_version: this.updateAttempt.fromVersion,
          target_version: this.updateAttempt.targetVersion,
          last_stage: state.errorContext,
          outcome: 'failed',
        });
        this.updateAttempt = null;
        this.writeUpdate(null);
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
  observeVersion(state: VersionObservation, delivered: () => void): void {
    if (state.reported) return;
    this.versionObservation = { state, delivered };
    this.reportVersion();
  }
  private reportVersion(): void {
    const observation = this.versionObservation;
    if (!this.enabled || !observation || this.versionQueued) return;
    const state = observation.state;
    this.versionQueued = !!this.track(
      state.kind === 'version_change' ? 'app_updated' : 'app_first_open',
      state.kind === 'version_change'
        ? { previous_version: state.previousVersion }
        : { kind: state.kind },
      () => {
        observation.delivered();
        if (this.versionObservation === observation) this.versionObservation = null;
      },
    );
  }
  matchStarted(sessionId: string): void {
    if (!sessionId || sessionId === this.lastStartedMatch) return;
    // Keep the local match key out of telemetry and suppress repeated start notifications.
    this.lastStartedMatch = sessionId;
    this.track('match_started', {});
  }
  beginOperation(method: RpcMethod): (success: boolean, error?: unknown) => void {
    if (!this.enabled || method === 'diagnostics.report') return () => {};
    const generation = this.generation,
      startedAt = performance.now();
    return (success, error) => {
      if (generation !== this.generation) return;
      this.operation(method, success, performance.now() - startedAt);
      if (!success && error !== undefined) this.error('rpc', error, method);
    };
  }
  operation(method: RpcMethod, success: boolean, durationMs: number): void {
    const operation = operations[method];
    if (!operation || !Number.isFinite(durationMs) || durationMs < 0) return;
    this.track('operation_completed', {
      operation,
      result: success ? 'success' : 'failure',
      duration: durationMs < 1000 ? 'under_1s' : durationMs < 10000 ? '1_to_10s' : 'over_10s',
      duration_ms: Math.min(3600000, Math.max(0, Math.round(durationMs))),
    });
  }
  private track(
    name: TelemetryEventName,
    data: Record<string, unknown>,
    delivered?: () => void,
  ): TelemetryEnvelope | null {
    if (!this.enabled || this.queue.length >= MAX_QUEUE_EVENTS) return null;
    const now = Date.now(),
      mono = performance.now();
    if (
      !this.sessionId ||
      now < this.lastEventAt ||
      now - this.lastEventAt >= SESSION_TIMEOUT_MS ||
      mono - this.lastEventMono >= SESSION_TIMEOUT_MS ||
      Math.floor(now / 86400000) !== Math.floor(this.sessionStartedAt / 86400000)
    ) {
      this.sessionId = newSessionId(now);
      this.sessionStartedAt = now;
    }
    this.lastEventAt = now;
    this.lastEventMono = mono;
    const props: TelemetryEnvelope['props'] = { distribution: this.options.distribution };
    for (const [key, value] of Object.entries(data)) {
      if (key.length > 40) continue;
      if (typeof value === 'string') props[key] = value.slice(0, 180);
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
        sdkVersion: 'baradar-aptabase@2',
      },
      props,
    };
    this.enqueue(payload, delivered);
    return payload;
  }
  private enqueue(payload: TelemetryEnvelope, delivered?: () => void): void {
    if (this.queue.length >= MAX_QUEUE_EVENTS) return;
    this.queue.push({
      payload,
      attempts: 0,
      nextAttemptAt: Date.now(),
      expiresAt: Date.now() + MAX_EVENT_AGE_MS,
      delivered,
    });
    this.schedule();
  }
  private schedule(): void {
    if (!this.enabled || this.inFlight || this.timer || !this.queue.length) return;
    const next = Math.min(...this.queue.map((item) => item.nextAttemptAt));
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
    this.queue = this.queue.filter(
      (item) =>
        item.expiresAt > now &&
        Math.floor(Date.parse(item.payload.timestamp) / 86400000) === Math.floor(now / 86400000),
    );
    const batch = this.queue
      .filter((item) => item.nextAttemptAt <= now)
      .slice(0, TELEMETRY_BATCH_SIZE);
    if (!batch.length) return;
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
      retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      accepted = response.ok;
      await response.body?.cancel();
    } catch {
      // Optional analytics failures never enter the application error UI.
    }
    if (!this.enabled || generation !== this.generation) return;
    for (const item of batch) {
      if (!this.queue.includes(item)) continue;
      if (accepted) {
        this.queue.splice(this.queue.indexOf(item), 1);
        try {
          item.delivered?.();
        } catch {}
      } else if (!retryable || ++item.attempts >= 3) {
        this.queue.splice(this.queue.indexOf(item), 1);
      } else {
        item.nextAttemptAt = Date.now() + retryDelay(item.attempts, retryAfter, Date.now());
      }
    }
  }
  async flush(timeoutMs = 1500): Promise<void> {
    if (!this.enabled) return;
    this.flushErrors(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drain = async () => {
      while (
        this.enabled &&
        (this.inFlight || this.queue.some((item) => item.nextAttemptAt <= Date.now()))
      )
        await this.send();
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
    this.closed = true;
    this.enabled = false;
    this.generation++;
    this.cancelTimers();
    this.controller.abort();
    this.queue = [];
    this.errors.clear();
  }
}
