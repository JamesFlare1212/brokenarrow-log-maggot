import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialUpdateState, rpcSchemas } from '@ba/contracts';
import { AnalyticsService } from '../apps/server/src/analytics';
import { diagnosticErrorType, LongTaskAggregate } from '../apps/web/src/app/diagnostics';

const services: AnalyticsService[] = [];
function setup() {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({}));
  const analytics = new AnalyticsService({
    allowed: true,
    fetch: fetchImpl,
    version: '4.1.8',
    distribution: 'installed',
    sampleRuntime: () => ({ foreground: true, active: true }),
  });
  services.push(analytics);
  return {
    analytics,
    fetchImpl,
    events: () => fetchImpl.mock.calls.flatMap(([, init]) => JSON.parse(String(init?.body))),
  };
}
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.useRealTimers();
});

describe('anonymous diagnostics analytics', () => {
  it('separates errors at different app code positions and preserves occurrence totals when deduplicating', async () => {
    vi.useFakeTimers();
    const { analytics, events } = setup();
    analytics.configure(true, 'en');
    const error = new TypeError('secret name');
    error.stack = 'TypeError: secret name\n    at fn (C:\\private\\app.ts:10:2)';
    analytics.error('rpc', error, 'players.report');
    analytics.error('rpc', error, 'players.report');
    analytics.error('rpc', error, 'players.report');
    error.stack = 'TypeError: secret name\n    at fn (C:\\private\\app.ts:20:2)';
    analytics.error('rpc', error, 'players.report');
    await vi.advanceTimersByTimeAsync(61000);
    const errors = events().filter((event) => event.eventName === 'app_error');
    expect(errors).toHaveLength(2);
    expect(errors[0].props.error_fingerprint).not.toBe(errors[1].props.error_fingerprint);
    const summary = events().filter((event) => event.eventName === 'error_summary');
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
    const { analytics, events } = setup();
    analytics.configure(true, 'en');
    analytics.feature('archive');
    analytics.feature('archive');
    analytics.feature('decks');
    analytics.feature('replays', 'start');
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

  it('sends resource metrics only during a consented active session', async () => {
    vi.useFakeTimers();
    const { analytics, fetchImpl, events } = setup();
    await vi.advanceTimersByTimeAsync(61000);
    expect(fetchImpl).not.toHaveBeenCalled();
    analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(61000);
    const resource = events().find((event) => event.eventName === 'resource_sample');
    expect(resource.props).toMatchObject({
      rss_mb: expect.any(Number),
      heap_used_mb: expect.any(Number),
      cpu_percent: expect.any(Number),
    });
    analytics.configure(false, 'en');
    const count = events().length;
    await vi.advanceTimersByTimeAsync(180000);
    expect(events()).toHaveLength(count);
  });

  it('reports flat Aptabase error events without raw messages, paths, names, or external stack frames', async () => {
    vi.useFakeTimers();
    const { analytics, events } = setup();
    analytics.configure(true, 'en');
    const error = Object.assign(
      new TypeError('PrivatePlayer 918273645 https://secret.example/token'),
      { code: 'ENOENT', status: 503 },
    );
    error.stack =
      'TypeError: PrivatePlayer\n    at run (C:\\Users\\PrivatePlayer\\app.ts:25:4)\n    at PrivatePlayer (C:\\Users\\PrivatePlayer\\private.js:12:2)';
    analytics.error('rpc', error, 'players.report');
    analytics.error('rpc', error, 'players.report');
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
    analytics.configure(false, 'en');
    analytics.error('main', error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(events().filter((event) => event.eventName === 'app_error')).toHaveLength(1);
  });

  it('records numeric performance and updater transitions while suppressing progress duplicates', async () => {
    vi.useFakeTimers();
    const { analytics, events } = setup();
    analytics.configure(true, 'en');
    analytics.performance('renderer_startup', 351.6);
    analytics.performance('renderer_startup', 400);
    analytics.performance('renderer_startup', Infinity);
    const state = {
      ...initialUpdateState('4.1.8', 'installed'),
      availableVersion: '4.1.9',
      status: 'downloading' as const,
    };
    analytics.observeUpdate(state);
    analytics.observeUpdate({ ...state, downloadPercent: 60 });
    analytics.observeUpdate({ ...state, status: 'downloaded', downloadPercent: 100 });
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

  it('validates renderer diagnostics without accepting raw content', () => {
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
