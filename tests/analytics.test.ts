import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsService,
  APTABASE_EVENTS_URL,
  APTABASE_APP_KEY,
} from '../apps/server/src/analytics';
import type { AnalyticsRuntimeSample } from '@ba/contracts';
import type { AptabaseEvent } from '../apps/server/src/aptabase';
const services: AnalyticsService[] = [];
function setup(
  options: {
    allowed?: boolean;
    fetch?: typeof fetch;
    sampleRuntime?: () => AnalyticsRuntimeSample;
  } = {},
) {
  const fetchImpl = vi.fn<typeof fetch>(options.fetch ?? (async () => Response.json({})));
  const analytics = new AnalyticsService({
    allowed: options.allowed ?? true,
    fetch: fetchImpl,
    version: '4.4.3',
    distribution: 'portable',
    sampleRuntime: options.sampleRuntime,
  });
  services.push(analytics);
  return {
    analytics,
    fetchImpl,
    events: (): AptabaseEvent[] =>
      fetchImpl.mock.calls.flatMap(([, init]) => JSON.parse(String(init?.body))),
  };
}
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('anonymous Aptabase delivery', () => {
  it('sends nothing before consent or in unsupported runtimes', async () => {
    vi.useFakeTimers();
    for (const allowed of [true, false]) {
      const { analytics, fetchImpl } = setup({ allowed });
      if (!allowed) analytics.configure(true, 'en');
      analytics.operation('decks.backup', true, 12);
      analytics.error('main', new Error('private detail'));
      analytics.feature('decks');
      await vi.advanceTimersByTimeAsync(120000);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
  it('sends the Aptabase envelope with system metadata and flat event properties only', async () => {
    vi.useFakeTimers();
    const { analytics, fetchImpl, events } = setup();
    analytics.configure(true, 'en');
    analytics.operation('matches.list', true, 1);
    analytics.operation('players.report', false, 1234);
    analytics.configure(true, 'zh');
    analytics.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(APTABASE_EVENTS_URL);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
    expect(new Headers(init?.headers).get('App-Key')).toBe(APTABASE_APP_KEY);
    expect(Object.keys(events()[0]!).sort()).toEqual([
      'eventName',
      'props',
      'sessionId',
      'systemProps',
      'timestamp',
    ]);
    expect(events()[0]!.systemProps).toMatchObject({
      isDebug: false,
      appVersion: '4.4.3',
      locale: 'en',
      osName: expect.any(String),
      engineName: 'Node.js',
      engineVersion: process.versions.node,
      sdkVersion: 'baradar-aptabase@4.4.3',
    });
    expect(events()[1]!.props).toEqual({
      distribution: 'portable',
      operation: 'player_report',
      result: 'failure',
      duration: '1_to_10s',
      duration_ms: 1234,
    });
    expect(events()[2]!.systemProps.locale).toBe('zh');
    expect(events().every((event) => /^\d{18,19}$/.test(event.sessionId))).toBe(true);
    expect(new Set(events().map((event) => event.sessionId)).size).toBe(1);
    for (const event of events()) {
      expect(
        Object.values(event.props).every(
          (value) => typeof value === 'string' || typeof value === 'number',
        ),
      ).toBe(true);
    }
  });
  it('counts live starts once without sending the match identifier or replaying pre-consent starts', async () => {
    vi.useFakeTimers();
    const { analytics, events } = setup();
    analytics.matchStarted('before-consent');
    analytics.configure(true, 'en');
    analytics.matchStarted('before-consent');
    analytics.matchStarted('private-match-1');
    analytics.matchStarted('private-match-1');
    analytics.matchStarted('private-match-2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.eventName === 'match_started')).toHaveLength(2);
    expect(JSON.stringify(events())).not.toMatch(/before-consent|private-match/);
  });
  it('aborts an in-flight request on opt-out and ignores its late acknowledgement', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const { analytics, fetchImpl } = setup({
      fetch: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const delivered = vi.fn();
    analytics.observeAppVersion({ version: '4.4.3', reported: false }, delivered);
    analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const signal = fetchImpl.mock.calls[0]![1]!.signal!;
    analytics.configure(false, 'en');
    expect(signal.aborted).toBe(true);
    resolve(Response.json({}));
    await vi.advanceTimersByTimeAsync(10000);
    expect(delivered).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('retries transient delivery within the same anonymous session without changing capture time', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let calls = 0;
    const { analytics, fetchImpl } = setup({
      fetch: async () => {
        if (++calls === 1) throw new Error('Offline');
        return Response.json({});
      },
    });
    analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1]!.body).toBe(fetchImpl.mock.calls[0]![1]!.body);
  });
  it('limits transient retries to three attempts and never retries permanent failures', async () => {
    vi.useFakeTimers();
    const transient = setup({ fetch: async () => new Response(null, { status: 503 }) });
    transient.analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(20000);
    expect(transient.fetchImpl).toHaveBeenCalledTimes(3);
    const permanent = setup({ fetch: async () => new Response(null, { status: 400 }) });
    permanent.analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(20000);
    expect(permanent.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('honors Retry-After but drops events after five minutes in memory', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    const { analytics, fetchImpl } = setup({
      fetch: async () => new Response(null, { status: 429, headers: { 'Retry-After': '300' } }),
    });
    analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(302000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('rotates sessions after an hour without events and at UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    const { analytics, events } = setup();
    analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const first = events()[0]!.sessionId;
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    analytics.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    const second = events().at(-1)!.sessionId;
    expect(second).not.toBe(first);
    vi.setSystemTime(new Date('2026-10-28T00:00:01Z'));
    analytics.feature('players');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().at(-1)!.sessionId).not.toBe(second);
  });
  it('discards unsent events at UTC midnight instead of replaying a previous-day session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T23:59:59.500Z'));
    const { analytics, events } = setup();
    analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events()).toEqual([]);
    analytics.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().map((event) => event.eventName)).toEqual(['feature_used']);
  });
  it('does not preserve session IDs or queued events across restarts', async () => {
    vi.useFakeTimers();
    const first = setup();
    first.analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const session = first.events()[0]!.sessionId;
    first.analytics.matchStarted('unsent-match');
    first.analytics.close();
    const second = setup();
    second.analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.events().map((event) => event.eventName)).toEqual(['app_started']);
    expect(second.events()[0]!.sessionId).not.toBe(session);
  });
  it('keeps the queue and request sizes bounded', async () => {
    vi.useFakeTimers();
    const { analytics, fetchImpl, events } = setup();
    analytics.configure(true, 'en');
    for (let index = 0; index < 1000; index++) analytics.operation('decks.backup', true, 12);
    await vi.advanceTimersByTimeAsync(15000);
    expect(events()).toHaveLength(200);
    expect(
      fetchImpl.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).length <= 20),
    ).toBe(true);
  });
  it('samples resources once per minute only while foreground and active', async () => {
    vi.useFakeTimers();
    let foreground = false,
      active = false;
    const { analytics, events } = setup({ sampleRuntime: () => ({ foreground, active }) });
    analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(121000);
    expect(events().filter((event) => event.eventName === 'resource_sample')).toHaveLength(0);
    foreground = true;
    analytics.sampleResources();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.eventName === 'resource_sample')).toHaveLength(0);
    active = true;
    analytics.sampleResources();
    analytics.sampleResources();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.eventName === 'resource_sample')).toHaveLength(1);
    analytics.sampleResources();
    await vi.advanceTimersByTimeAsync(60000);
    expect(events().filter((event) => event.eventName === 'resource_sample')).toHaveLength(1);
    foreground = false;
    await vi.advanceTimersByTimeAsync(120000);
    expect(events().filter((event) => event.eventName === 'resource_sample')).toHaveLength(1);
  });
  it('uses a fresh session after clock rollback or a consent cycle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    const { analytics, events } = setup();
    analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const first = events()[0]!.sessionId;
    vi.setSystemTime(new Date('2026-10-27T11:59:00Z'));
    analytics.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    const second = events().at(-1)!.sessionId;
    expect(second).not.toBe(first);
    analytics.configure(false, 'en');
    analytics.configure(true, 'en');
    analytics.feature('players');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().at(-1)!.sessionId).not.toBe(second);
  });
  it('rejects long-task aggregates received while hidden or idle before they can extend a session', async () => {
    vi.useFakeTimers();
    let foreground = false,
      active = false;
    const { analytics, events } = setup({ sampleRuntime: () => ({ foreground, active }) });
    const sample = { count: 1, totalMs: 100, maxMs: 100, blockingMs: 50, windowMs: 60000 };
    analytics.longTasks(sample);
    analytics.configure(true, 'en');
    analytics.longTasks(sample);
    foreground = true;
    analytics.longTasks(sample);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().map((event) => event.eventName)).toEqual(['app_started']);
    active = true;
    analytics.longTasks(sample);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().at(-1)!.props).toMatchObject({ metric: 'renderer_long_tasks', task_count: 1 });
  });
  it('excludes operations spanning consent boundaries and stops permanently on close', async () => {
    vi.useFakeTimers();
    const { analytics, events, fetchImpl } = setup();
    const before = analytics.beginOperation('players.report');
    analytics.configure(true, 'en');
    before(true);
    const during = analytics.beginOperation('players.report');
    analytics.configure(false, 'en');
    analytics.configure(true, 'en');
    during(true);
    analytics.beginOperation('decks.backup')(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.eventName === 'operation_completed')).toHaveLength(1);
    analytics.close();
    const count = fetchImpl.mock.calls.length;
    analytics.configure(true, 'en');
    analytics.feature('players');
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchImpl).toHaveBeenCalledTimes(count);
  });
  it('bounds shutdown flush time and cancels the request when closing', async () => {
    vi.useFakeTimers();
    const { analytics, fetchImpl } = setup({ fetch: () => new Promise(() => {}) });
    analytics.configure(true, 'en');
    const flush = analytics.flush(100);
    await vi.advanceTimersByTimeAsync(100);
    await flush;
    analytics.close();
    expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
});
