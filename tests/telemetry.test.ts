import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TelemetryService,
  TELEMETRY_ENDPOINT,
  TELEMETRY_PROJECT_TOKEN,
  type TelemetryIdentity,
} from '../apps/server/src/telemetry';
import type { TelemetryPersistence } from '../apps/server/src/telemetry-protocol';
const services: TelemetryService[] = [];
const identity = { installationId: '4f1351be-985f-4ec0-b1b5-6b48d507e346' };
function store() {
  const values = new Map<string, unknown>();
  const persistence: TelemetryPersistence = {
    read: (key) => values.get(key),
    write: (key, value) => values.set(key, structuredClone(value)),
  };
  return { values, persistence };
}
function setup(
  options: {
    allowed?: boolean;
    fetch?: typeof fetch;
    identity?: TelemetryIdentity;
    persistence?: TelemetryPersistence;
    version?: string;
  } = {},
) {
  const fetchImpl = vi.fn<typeof fetch>(
    options.fetch ?? (async () => Response.json({ status: 'Ok' })),
  );
  const telemetry = new TelemetryService({
    allowed: options.allowed ?? true,
    fetch: fetchImpl,
    version: options.version ?? '4.1.8',
    distribution: 'portable',
    identity: options.identity ?? identity,
    persistence: options.persistence,
  });
  services.push(telemetry);
  return {
    telemetry,
    fetchImpl,
    events: () => fetchImpl.mock.calls.flatMap(([, init]) => JSON.parse(String(init?.body)).batch),
  };
}
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('consented reliable PostHog delivery', () => {
  it('counts each live match start once without sending its local identifier', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    telemetry.matchStarted('before-consent');
    telemetry.configure(true, 'en');
    telemetry.matchStarted('before-consent');
    telemetry.matchStarted('private-match-session-1');
    telemetry.matchStarted('private-match-session-1');
    await vi.advanceTimersByTimeAsync(1000);
    telemetry.identifyAccount('918273645');
    telemetry.matchStarted('private-match-session-1');
    telemetry.matchStarted('private-match-session-2');
    await vi.advanceTimersByTimeAsync(1000);
    const matches = events().filter((event) => event.event === 'match_started');
    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((event) => event.uuid)).size).toBe(2);
    expect(matches[0].properties.$session_id).toBeTruthy();
    expect(JSON.stringify(matches)).not.toMatch(/private-match|before-consent|918273645/);
    telemetry.configure(false, 'en');
    telemetry.matchStarted('after-opt-out');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().filter((event) => event.event === 'match_started')).toHaveLength(2);
  });

  it('persists match starts and replays the original envelope after restart', async () => {
    vi.useFakeTimers();
    const persistence = store();
    const first = setup({ persistence: persistence.persistence });
    first.telemetry.configure(true, 'en');
    first.telemetry.matchStarted('private-match-session');
    first.telemetry.close();
    const saved = (persistence.values.get('outbox') as { payload: { event: string } }[]).find(
      (item) => item.payload.event === 'match_started',
    )!;
    expect(saved).toBeDefined();
    const second = setup({ persistence: persistence.persistence, version: '4.2.0' });
    second.telemetry.configure(true, 'zh');
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.events().filter((event) => event.event === 'match_started')).toEqual([
      saved.payload,
    ]);
    expect(persistence.values.get('outbox')).toEqual([]);
  });

  it('sends nothing before consent or when the runtime disallows collection', async () => {
    vi.useFakeTimers();
    const declined = setup(),
      disabled = setup({ allowed: false });
    declined.telemetry.configure(false, 'zh');
    disabled.telemetry.configure(true, 'en');
    declined.telemetry.operation('decks.backup', true, 10);
    declined.telemetry.matchStarted('declined-match');
    disabled.telemetry.matchStarted('disabled-match');
    disabled.telemetry.error('main', new Error());
    await vi.advanceTimersByTimeAsync(180000);
    expect(declined.fetchImpl).not.toHaveBeenCalled();
    expect(disabled.fetchImpl).not.toHaveBeenCalled();
  });
  it('batches allowlisted events with frozen capture metadata and numeric timings', async () => {
    vi.useFakeTimers();
    const { telemetry, fetchImpl, events } = setup();
    telemetry.configure(true, 'ja');
    telemetry.configure(true, 'ja');
    telemetry.operation('matches.list', true, 1);
    telemetry.operation('api.health', false, 1);
    telemetry.operation('decks.backup', true, 1200);
    telemetry.operation('players.report', false, 15000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(TELEMETRY_ENDPOINT);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(JSON.parse(String(init?.body)).api_key).toBe(TELEMETRY_PROJECT_TOKEN);
    expect(events().map((event) => event.event)).toEqual([
      'app_started',
      'operation_completed',
      'operation_completed',
    ]);
    expect(events()[1].properties).toMatchObject({
      version: '4.1.8',
      language: 'ja',
      distribution: 'portable',
      operation: 'deck_backup',
      duration_ms: 1200,
      result: 'success',
      $process_person_profile: false,
      identity_confidence: 'installation',
    });
    expect(events()[2].properties.duration_ms).toBe(15000);
    expect(new Set(events().map((event) => event.uuid)).size).toBe(3);
    expect(events()[0].properties.$session_id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
  });
  it('excludes operations spanning consent boundaries and permanently stops after close', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    const before = telemetry.beginOperation('players.report');
    telemetry.configure(true, 'en');
    before(true);
    const cancelled = telemetry.beginOperation('decks.deploy');
    telemetry.configure(false, 'en');
    telemetry.configure(true, 'en');
    cancelled(true);
    telemetry.beginOperation('decks.backup')(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      events()
        .filter((event) => event.event === 'operation_completed')
        .map((event) => event.properties.operation),
    ).toEqual(['deck_backup']);
    telemetry.close();
    const count = events().length;
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(180000);
    expect(events()).toHaveLength(count);
  });
  it('aborts in-flight requests and purges durable events on opt-out, even when an old request resolves later', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const persistence = store();
    const { telemetry, fetchImpl } = setup({
      persistence: persistence.persistence,
      fetch: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const delivered = vi.fn();
    telemetry.observeInstallation(
      { version: '4.1.8', kind: 'first_run', reported: false },
      delivered,
    );
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect((persistence.values.get('outbox') as unknown[]).length).toBe(1);
    const signal = fetchImpl.mock.calls[0]![1]!.signal!;
    telemetry.configure(false, 'en');
    expect(signal.aborted).toBe(true);
    expect(persistence.values.get('outbox')).toEqual([]);
    resolve(Response.json({ status: 'Ok' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(delivered).not.toHaveBeenCalled();
    expect(persistence.values.get('outbox')).toEqual([]);
  });
  it('retries an entire failed batch using the same event UUIDs and timestamps', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let attempts = 0;
    const { telemetry, fetchImpl } = setup({
      fetch: async () => {
        if (++attempts === 1) throw new Error('Offline');
        return Response.json({ status: 'Ok' });
      },
    });
    telemetry.configure(true, 'en');
    telemetry.operation('decks.backup', true, 20);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body)).batch).toEqual(
      JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).batch,
    );
  });
  it('honors Retry-After and does not retry permanent HTTP failures', async () => {
    vi.useFakeTimers();
    let count = 0;
    const limited = setup({
      fetch: async () =>
        ++count === 1
          ? new Response('{}', { status: 429, headers: { 'Retry-After': '4' } })
          : Response.json({ status: 'Ok' }),
    });
    limited.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(4999);
    expect(limited.fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(limited.fetchImpl).toHaveBeenCalledTimes(2);
    const rejected = setup({ fetch: async () => new Response('{}', { status: 400 }) });
    rejected.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(20000);
    expect(rejected.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('restores critical events across restarts without changing their version, account, session, or UUID', async () => {
    vi.useFakeTimers();
    const persistence = store(),
      state = {
        version: '4.1.8',
        kind: 'first_run' as const,
        reported: false,
        eventId: 'e2f6e7aa-a7aa-4eb4-9279-f29eb5e3f4b5',
      };
    const first = setup({ persistence: persistence.persistence });
    first.telemetry.identifyAccount('918273645');
    first.telemetry.observeInstallation(state, vi.fn());
    first.telemetry.configure(true, 'en');
    first.telemetry.close();
    const saved = structuredClone(persistence.values.get('outbox')) as { payload: unknown }[];
    expect(saved).toHaveLength(2);
    const second = setup({
      version: '4.1.9',
      identity: { ...identity, accountHash: 'a'.repeat(64) },
      persistence: persistence.persistence,
    });
    second.telemetry.configure(true, 'ru');
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.events().find((event) => event.uuid === state.eventId)).toEqual(
      saved[0]!.payload,
    );
    expect(persistence.values.get('outbox')).toEqual([]);
  });
  it('bounds queues and exposes dropped-event totals on later heartbeats', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    for (let i = 0; i < 1000; i++) telemetry.operation('decks.backup', true, 10);
    await vi.advanceTimersByTimeAsync(61000);
    expect(events().filter((event) => event.event === 'operation_completed')).toHaveLength(199);
    expect(
      events().find((event) => event.event === 'app_heartbeat').properties.delivery_dropped_total,
    ).toBe(801);
  });
  it('bounds shutdown flush time while preserving critical events for the next launch', async () => {
    vi.useFakeTimers();
    const persistence = store();
    const { telemetry, fetchImpl } = setup({
      persistence: persistence.persistence,
      fetch: () => new Promise(() => {}),
    });
    telemetry.configure(true, 'en');
    telemetry.error('main', new TypeError('private'));
    const flush = telemetry.flush(100);
    await vi.advanceTimersByTimeAsync(100);
    await flush;
    telemetry.close();
    expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(
      (persistence.values.get('outbox') as { payload: { event: string } }[]).filter(
        (item) => item.payload.event === '$exception',
      ),
    ).toHaveLength(1);
  });
  it('rotates native sessions after idle time, clock rollback, account switches, and the 24-hour limit', async () => {
    vi.useFakeTimers();
    const { telemetry, events } = setup();
    telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    const first = events()[0].properties.$session_id;
    const epoch = Date.now();
    const uuidTime = Number.parseInt(first.replaceAll('-', '').slice(0, 12), 16);
    expect(uuidTime).toBeLessThanOrEqual(Date.parse(events()[0].timestamp));
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    telemetry.feature('decks');
    await vi.advanceTimersByTimeAsync(1000);
    const second = events().at(-1).properties.$session_id;
    expect(second).not.toBe(first);
    vi.setSystemTime(epoch - 1000);
    telemetry.feature('archive');
    await vi.advanceTimersByTimeAsync(1000);
    const third = events().at(-1).properties.$session_id;
    expect(third).not.toBe(second);
    vi.setSystemTime(epoch + 25 * 60 * 60 * 1000);
    telemetry.feature('players');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events().at(-1).properties.$session_id).not.toBe(third);
  });
  it('keeps the same installation ID but uses a new run ID after restart', async () => {
    vi.useFakeTimers();
    const first = setup();
    first.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    first.telemetry.close();
    const second = setup();
    second.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.events()[0].distinct_id).toBe(first.events()[0].distinct_id);
    expect(second.events()[0].properties.app_session_id).not.toBe(
      first.events()[0].properties.app_session_id,
    );
  });
});
