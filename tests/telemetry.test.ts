import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TelemetryService,
  TELEMETRY_ENDPOINT,
  TELEMETRY_APP_KEY,
} from '../apps/server/src/telemetry';
import type { TelemetryRuntimeSample } from '@ba/contracts';
import type { TelemetryEnvelope } from '../apps/server/src/telemetry-protocol';
const services: TelemetryService[] = [];
function setup(
  options: {
    allowed?: boolean;
    fetch?: typeof fetch;
    sampleRuntime?: () => TelemetryRuntimeSample;
  } = {},
) {
  const fetchImpl = vi.fn<typeof fetch>(options.fetch ?? (async () => Response.json({})));
  const telemetry = new TelemetryService({
    allowed: options.allowed ?? true,
    fetch: fetchImpl,
    version: '4.4.3',
    distribution: 'portable',
    sampleRuntime: options.sampleRuntime,
  });
  services.push(telemetry);
  return {
    telemetry,
    fetchImpl,
    events: (): TelemetryEnvelope[] =>
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
      const { telemetry, fetchImpl } = setup({ allowed });
      if (!allowed) telemetry.configure(true, 'en');
      telemetry.operation('decks.backup', true, 12);
      telemetry.error('main', new Error('private detail'));
      telemetry.feature('decks');
      await vi.advanceTimersByTimeAsync(120000);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
  it('sends the Aptabase envelope with system metadata and flat event properties only', async () => {
    vi.useFakeTimers();
    const { telemetry, fetchImpl, events } = setup();
    telemetry.configure(true, 'en');
    telemetry.operation('matches.list', true, 1);
    telemetry.operation('players.report', false, 1234);
    telemetry.configure(true, 'zh');
    telemetry.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(TELEMETRY_ENDPOINT);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
    expect(new Headers(init?.headers).get('App-Key')).toBe(TELEMETRY_APP_KEY);
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
      sdkVersion: 'baradar-aptabase@2',
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
        Object.keys(event.props).some((key) =>
          /(?:identity|account|installation|session|event_id|run_id|attempt_id)/.test(key),
        ),
      ).toBe(false);
      expect(
        Object.values(event.props).every(
          (value) => typeof value === 'string' || typeof value === 'number',
        ),
      ).toBe(true);
    }
  });
  it('counts live starts once without sending the match identifier or replaying pre-consent starts', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    telemetry.matchStarted('before-consent');
    telemetry.configure(true, 'en');
    telemetry.matchStarted('before-consent');
    telemetry.matchStarted('private-match-1');
    telemetry.matchStarted('private-match-1');
    telemetry.matchStarted('private-match-2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.eventName === 'match_started')).toHaveLength(2);
    expect(JSON.stringify(events())).not.toMatch(/before-consent|private-match/);
  });
  it('aborts an in-flight request on opt-out and ignores its late acknowledgement', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const { telemetry, fetchImpl } = setup({
      fetch: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const delivered = vi.fn();
    telemetry.observeVersion({ version: '4.4.3', kind: 'first_run', reported: false }, delivered);
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const signal = fetchImpl.mock.calls[0]![1]!.signal!;
    telemetry.configure(false, 'en');
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
    const { telemetry, fetchImpl } = setup({
      fetch: async () => {
        if (++calls === 1) throw new Error('Offline');
        return Response.json({});
      },
    });
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1]!.body).toBe(fetchImpl.mock.calls[0]![1]!.body);
  });
  it('limits transient retries to three attempts and never retries permanent failures', async () => {
    vi.useFakeTimers();
    const transient = setup({ fetch: async () => new Response(null, { status: 503 }) });
    transient.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(20000);
    expect(transient.fetchImpl).toHaveBeenCalledTimes(3);
    const permanent = setup({ fetch: async () => new Response(null, { status: 400 }) });
    permanent.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(20000);
    expect(permanent.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('honors Retry-After but drops events after five minutes in memory', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    const { telemetry, fetchImpl } = setup({
      fetch: async () => new Response(null, { status: 429, headers: { 'Retry-After': '300' } }),
    });
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(302000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('rotates sessions after an hour without events and at UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const first = events()[0]!.sessionId;
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    telemetry.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    const second = events().at(-1)!.sessionId;
    expect(second).not.toBe(first);
    vi.setSystemTime(new Date('2026-10-28T00:00:01Z'));
    telemetry.feature('players');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().at(-1)!.sessionId).not.toBe(second);
  });
  it('discards unsent events at UTC midnight instead of replaying a previous-day session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T23:59:59.500Z'));
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events()).toEqual([]);
    telemetry.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().map((event) => event.eventName)).toEqual(['feature_used']);
  });
  it('does not preserve session IDs or queued events across restarts', async () => {
    vi.useFakeTimers();
    const first = setup();
    first.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const session = first.events()[0]!.sessionId;
    first.telemetry.matchStarted('unsent-match');
    first.telemetry.close();
    const second = setup();
    second.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.events().map((event) => event.eventName)).toEqual(['app_started']);
    expect(second.events()[0]!.sessionId).not.toBe(session);
  });
  it('keeps the queue and request sizes bounded', async () => {
    vi.useFakeTimers();
    const { telemetry, fetchImpl, events } = setup();
    telemetry.configure(true, 'en');
    for (let index = 0; index < 1000; index++) telemetry.operation('decks.backup', true, 12);
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
    const { telemetry, events } = setup({ sampleRuntime: () => ({ foreground, active }) });
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(121000);
    expect(events().filter((event) => event.eventName === 'app_heartbeat')).toHaveLength(0);
    foreground = true;
    telemetry.samplePresence();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.eventName === 'app_heartbeat')).toHaveLength(0);
    active = true;
    telemetry.samplePresence();
    telemetry.samplePresence();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.eventName === 'app_heartbeat')).toHaveLength(1);
    telemetry.samplePresence();
    await vi.advanceTimersByTimeAsync(60000);
    expect(events().filter((event) => event.eventName === 'app_heartbeat')).toHaveLength(1);
    foreground = false;
    await vi.advanceTimersByTimeAsync(120000);
    expect(events().filter((event) => event.eventName === 'app_heartbeat')).toHaveLength(1);
  });
  it('uses a fresh session after clock rollback or a consent cycle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const first = events()[0]!.sessionId;
    vi.setSystemTime(new Date('2026-10-27T11:59:00Z'));
    telemetry.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    const second = events().at(-1)!.sessionId;
    expect(second).not.toBe(first);
    telemetry.configure(false, 'en');
    telemetry.configure(true, 'en');
    telemetry.feature('players');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().at(-1)!.sessionId).not.toBe(second);
  });
  it('excludes operations spanning consent boundaries and stops permanently on close', async () => {
    vi.useFakeTimers();
    const { telemetry, events, fetchImpl } = setup();
    const before = telemetry.beginOperation('players.report');
    telemetry.configure(true, 'en');
    before(true);
    const during = telemetry.beginOperation('players.report');
    telemetry.configure(false, 'en');
    telemetry.configure(true, 'en');
    during(true);
    telemetry.beginOperation('decks.backup')(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.eventName === 'operation_completed')).toHaveLength(1);
    telemetry.close();
    const count = fetchImpl.mock.calls.length;
    telemetry.configure(true, 'en');
    telemetry.feature('players');
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchImpl).toHaveBeenCalledTimes(count);
  });
  it('bounds shutdown flush time and cancels the request when closing', async () => {
    vi.useFakeTimers();
    const { telemetry, fetchImpl } = setup({ fetch: () => new Promise(() => {}) });
    telemetry.configure(true, 'en');
    const flush = telemetry.flush(100);
    await vi.advanceTimersByTimeAsync(100);
    await flush;
    telemetry.close();
    expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
});
