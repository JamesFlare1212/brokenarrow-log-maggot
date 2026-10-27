import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasTelemetryConsent,
  initialUpdateState,
  rpcSchemas,
  TELEMETRY_CONSENT_VERSION,
} from '@ba/contracts';
import { TelemetryService } from '../apps/server/src/telemetry';
import { diagnosticErrorType, LongTaskAggregate } from '../apps/web/src/app/diagnostics';

const services: TelemetryService[] = [];
function setup() {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({}));
  const saveAccountHash = vi.fn();
  const telemetry = new TelemetryService({
    allowed: true,
    fetch: fetchImpl,
    version: '4.1.8',
    distribution: 'installed',
    saveAccountHash,
  });
  services.push(telemetry);
  return {
    telemetry,
    fetchImpl,
    saveAccountHash,
    events: () => fetchImpl.mock.calls.flatMap(([, init]) => JSON.parse(String(init?.body))),
  };
}
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.useRealTimers();
});

describe('account identity and diagnostics telemetry', () => {
  it('separates errors at different app code positions and preserves occurrence totals when deduplicating', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    const error = new TypeError('secret name');
    error.stack = 'TypeError: secret name\n    at fn (C:\\private\\app.ts:10:2)';
    telemetry.error('rpc', error, 'players.report');
    telemetry.error('rpc', error, 'players.report');
    telemetry.error('rpc', error, 'players.report');
    error.stack = 'TypeError: secret name\n    at fn (C:\\private\\app.ts:20:2)';
    telemetry.error('rpc', error, 'players.report');
    await vi.advanceTimersByTimeAsync(61000);
    const errors = events().filter((event) => event.eventName === 'app_error');
    expect(errors).toHaveLength(2);
    expect(errors[0].props.error_fingerprint).not.toBe(errors[1].props.error_fingerprint);
    const summary = events().filter((event) => event.eventName === 'exception_summary');
    expect(summary).toHaveLength(1);
    expect(summary[0].props.occurrences).toBe(2);
    expect(JSON.stringify(events())).not.toMatch(/secret name|private/);
  });

  it('aggregates every long task in a window and resets counts after reporting', () => {
    const aggregate = new LongTaskAggregate();
    aggregate.add([10, 50, 80, 120, NaN, Infinity]);
    expect(aggregate.flush()).toMatchObject({
      count: 3,
      totalMs: 250,
      maxMs: 120,
      blockingMs: 100,
    });
    expect(aggregate.flush()).toBeNull();
  });

  it('tracks explicit feature views and capture transitions without duplicate page renders', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    telemetry.feature('archive');
    telemetry.feature('archive');
    telemetry.feature('decks');
    telemetry.feature('replays', 'start');
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      events()
        .filter((event) => event.eventName === 'feature_used')
        .map((event) => [event.props.feature, event.props.action]),
    ).toEqual([
      ['archive', 'view'],
      ['decks', 'view'],
      ['replays', 'start'],
    ]);
  });

  it('hashes only numeric local account IDs and freezes identity on queued events across account switches', async () => {
    vi.useFakeTimers();
    const { telemetry, saveAccountHash, events } = setup();
    telemetry.configure(true, 'en');
    telemetry.identifyAccount('918273645');
    const expected = createHash('sha256')
      .update('brokenarrow.desktop:account:918273645')
      .digest('hex');
    const cancelled = telemetry.beginOperation('players.report');
    telemetry.operation('players.search', true, 42.4);
    telemetry.identifyAccount('55443322');
    cancelled(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(events().map((event) => event.eventName)).toEqual([
      'app_started',
      'user_identified',
      'operation_completed',
      'user_identified',
    ]);
    expect(events()[1].props.identity_hash).toBe(expected);
    expect(events()[2].props.identity_hash).toBe(expected);
    expect(events()[3].props.identity_hash).not.toBe(expected);
    expect(events()[2].props).toMatchObject({
      identity_source: 'game_account',
      operation: 'player_search',
      duration_ms: 42,
    });
    expect(new Set(events().map((event) => event.props.installation_id)).size).toBe(1);
    expect(JSON.stringify(events())).not.toMatch(/918273645|55443322/);
    expect(saveAccountHash).toHaveBeenCalledWith(expected);
    telemetry.identifyAccount('A private nickname');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().at(-1).props.identity_source).toBe('installation');
  });

  it('sends periodic presence and resource metrics only during a consented session', async () => {
    vi.useFakeTimers();
    const { telemetry, fetchImpl, events } = setup();
    await vi.advanceTimersByTimeAsync(61000);
    expect(fetchImpl).not.toHaveBeenCalled();
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(61000);
    const heartbeat = events().find((event) => event.eventName === 'app_heartbeat');
    expect(heartbeat.props).toMatchObject({
      version: '4.1.8',
      uptime_seconds: expect.any(Number),
      rss_mb: expect.any(Number),
      heap_used_mb: expect.any(Number),
      cpu_percent: expect.any(Number),
      timer_lag_ms: expect.any(Number),
    });
    telemetry.configure(false, 'en');
    const count = events().length;
    await vi.advanceTimersByTimeAsync(180000);
    expect(events()).toHaveLength(count);
  });

  it('reports flat Aptabase error events without raw messages, paths, names, or external stack frames', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    const error = Object.assign(
      new TypeError('PrivatePlayer 918273645 https://secret.example/token'),
      { code: 'ENOENT', status: 503 },
    );
    error.stack =
      'TypeError: PrivatePlayer\n    at run (C:\\Users\\PrivatePlayer\\app.ts:25:4)\n    at PrivatePlayer (C:\\Users\\PrivatePlayer\\private.js:12:2)';
    telemetry.error('rpc', error, 'players.report');
    telemetry.error('rpc', error, 'players.report');
    await vi.advanceTimersByTimeAsync(3000);
    const exceptions = events().filter((event) => event.eventName === 'app_error');
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].props).toMatchObject({
      error_type: 'TypeError',
      error_code: 'ENOENT',
      http_status: 503,
      error_fingerprint: expect.any(String),
      error_level: 'error',
      error_frame_1: 'app.ts:25:4',
    });
    for (const value of Object.values(exceptions[0].props)) {
      expect(['string', 'number']).toContain(typeof value);
    }
    expect(JSON.stringify(events())).not.toMatch(
      /PrivatePlayer|918273645|secret\.example|private\.js|Users/,
    );
    telemetry.configure(false, 'en');
    telemetry.error('main', error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(events().filter((event) => event.eventName === 'app_error')).toHaveLength(1);
  });

  it('records numeric performance and updater transitions while suppressing progress duplicates', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    telemetry.performance('renderer_startup', 351.6);
    telemetry.performance('renderer_startup', 400);
    telemetry.performance('renderer_long_task', Infinity);
    const state = {
      ...initialUpdateState('4.1.8', 'installed'),
      availableVersion: '4.1.9',
      status: 'downloading' as const,
    };
    telemetry.observeUpdate(state);
    telemetry.observeUpdate({ ...state, downloadPercent: 60 });
    telemetry.observeUpdate({ ...state, status: 'downloaded', downloadPercent: 100 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      events()
        .filter((event) => event.eventName === 'performance_sample')
        .map((event) => event.props.duration_ms),
    ).toEqual([352]);
    expect(
      events()
        .filter((event) => event.eventName === 'update_state_changed')
        .map((event) => event.props.status),
    ).toEqual(['downloading', 'downloaded']);
  });

  it('requires revised consent for old opt-ins and validates renderer diagnostics without accepting raw content', () => {
    expect(
      hasTelemetryConsent({
        telemetryEnabled: true,
        telemetryConsentConfirmed: true,
        telemetryConsentVersion: 0,
      }),
    ).toBe(false);
    expect(
      hasTelemetryConsent({
        telemetryEnabled: false,
        telemetryConsentConfirmed: true,
        telemetryConsentVersion: 0,
      }),
    ).toBe(true);
    expect(
      hasTelemetryConsent({
        telemetryEnabled: true,
        telemetryConsentConfirmed: true,
        telemetryConsentVersion: TELEMETRY_CONSENT_VERSION,
      }),
    ).toBe(true);
    expect(
      rpcSchemas['diagnostics.report'].safeParse({
        type: 'error',
        source: 'renderer',
        errorType: 'TypeError',
        message: 'private path',
      }).success,
    ).toBe(false);
    expect(
      rpcSchemas['diagnostics.report'].safeParse({
        type: 'performance',
        metric: 'renderer_startup',
        durationMs: NaN,
      }).success,
    ).toBe(false);
    expect(diagnosticErrorType({ name: 'PrivateAccount' })).toBe('Error');
    expect(diagnosticErrorType(new RangeError('private'))).toBe('RangeError');
  });
});
