import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient, type HttpPort } from '../apps/server/src/network/client';
import { StatusService } from '../apps/server/src/network/status';
import { parseMatchPage } from '../apps/server/src/network/match-page';

const capturedMatch = parseMatchPage(
  readFileSync(new URL('./fixtures/batrace/match-9227650.html', import.meta.url), 'utf8'),
  '9227650',
);

const databases = new Set<Database>();
const clients = new Set<BatraceClient>();
function setup(http: HttpPort, interval = 1_200) {
  const db = new Database(':memory:');
  databases.add(db);
  const clock = { now: Date.now() };
  const waits: number[] = [];
  const client = new BatraceClient(
    db,
    http,
    interval,
    () => clock.now,
    async (ms) => {
      waits.push(ms);
      clock.now += ms;
    },
  );
  clients.add(client);
  return { db, client, clock, waits };
}
afterEach(async () => {
  await Promise.all([...clients].map((client) => client.close()));
  clients.clear();
  for (const db of databases) db.close();
  databases.clear();
});

describe('BATrace scheduling and cache boundaries', () => {
  it('allows more than 400 requests while preserving the global request interval', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const { client, waits } = setup({ fetch: fetchImpl });
    const results = await Promise.all(
      Array.from({ length: 405 }, (_, i) => client.get(`/api/fake/${i}`, `key:${i}`, 60_000)),
    );
    expect(results).toHaveLength(405);
    expect(fetchImpl).toHaveBeenCalledTimes(405);
    expect(waits).toHaveLength(404);
    expect(waits.every((ms) => ms >= 1_200)).toBe(true);
  });

  it('shares an in-flight request for the same cache key', async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { client } = setup({ fetch: fetchImpl });
    const one = client.get('/api/shared', 'shared', 60_000);
    const two = client.get('/api/shared', 'shared', 60_000);
    const three = client.get('/api/shared', 'shared', 60_000);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    release(Response.json({ value: 42 }));
    const results = await Promise.all([one, two, three]);
    expect(results.map((result) => result.value)).toEqual([
      { value: 42 },
      { value: 42 },
      { value: 42 },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('counts each retry and honors both the global interval and Retry-After', async () => {
    const attemptTimes: number[] = [];
    let state!: ReturnType<typeof setup>;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      attemptTimes.push(state.clock.now);
      return attemptTimes.length < 3
        ? new Response('temporarily unavailable', { status: 503, headers: { 'Retry-After': '2' } })
        : Response.json({ ok: true });
    });
    state = setup({ fetch: fetchImpl });
    const result = await state.client.get('/api/retry', 'retry', 60_000);
    expect(result.source).toBe('network');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.attempts).toBe(3);
    expect(attemptTimes[1]! - attemptTimes[0]!).toBeGreaterThanOrEqual(2_000);
    expect(attemptTimes[2]! - attemptTimes[1]!).toBeGreaterThanOrEqual(2_000);
  });

  it('uses a fresh cache without a request, and force replaces it from the network', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ version: 'new' }));
    const { db, client, clock } = setup({ fetch: fetchImpl });
    db.saveCache('force', { version: 'old' }, 60_000, clock.now);
    expect(await client.get('/api/force', 'force', 60_000)).toMatchObject({
      value: { version: 'old' },
      source: 'cache',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await client.get('/api/force', 'force', 60_000, { force: true })).toMatchObject({
      value: { version: 'new' },
      source: 'network',
    });
    expect(await client.get('/api/force', 'force', 60_000)).toMatchObject({
      value: { version: 'new' },
      source: 'cache',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns stale cache with its original timestamp rather than pretending it is fresh', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('unavailable', { status: 503 }));
    const { db, client, clock } = setup({ fetch: fetchImpl });
    const at = clock.now - 120_000;
    db.saveCache('stale', { old: true }, 60_000, at);
    expect(await client.get('/api/stale', 'stale', 60_000, { allowStale: true })).toMatchObject({
      value: { old: true },
      source: 'stale',
      at,
    });
  });

  it('does not retry a missing endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('missing', { status: 404 }));
    const { client } = setup({ fetch: fetchImpl });
    await expect(client.get('/api/missing', 'missing', 60_000)).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not cache health probes', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const { db, client } = setup({ fetch: fetchImpl });
    await client.get('/api/health', 'health', 0, { health: true, force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.cache('health', true)).toBeNull();
  });
});

describe('BATrace health checks', () => {
  it('ignores a previous run and forced probes bypass cached responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(capturedMatch));
    const { db, client, clock } = setup({ fetch: fetchImpl });
    db.setState('health', { state: 'down', at: clock.now, checks: [] });
    db.saveCache('health:/api/players/search?q=test&limit=1', {}, 60_000, clock.now);
    const statuses = new StatusService(db, client);
    expect(statuses.health()).toEqual({ state: 'unknown', at: 0, checks: [] });
    const one = statuses.probe();
    expect(statuses.probe()).toBe(one);
    expect(await one).toMatchObject({ state: 'ok', checks: expect.any(Array) });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(statuses.health().checks.every((check) => check.ok)).toBe(true);
  });

  it('reports partial failure, full failure, then recovery on subsequent probes', async () => {
    let mode: 'partial' | 'down' | 'ok' = 'partial';
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (mode === 'down' || (mode === 'partial' && String(input).includes('/info?')))
        return new Response('unavailable', { status: 403 });
      return Response.json(capturedMatch);
    });
    const { db, client } = setup({ fetch: fetchImpl });
    const statuses = new StatusService(db, client);
    expect((await statuses.probe()).state).toBe('partial');
    expect(statuses.health().checks.filter((check) => !check.ok)).toMatchObject([{ status: 403 }]);
    mode = 'down';
    expect((await statuses.probe()).state).toBe('down');
    mode = 'ok';
    expect((await statuses.probe()).state).toBe('ok');
  });

  it('keeps offline fixtures unknown without attempting a connection', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { db, client } = setup({ fetch: fetchImpl, offline: true });
    const statuses = new StatusService(db, client, false);
    expect(await statuses.probe()).toEqual({ state: 'unknown', at: 0, checks: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records transport failures without inventing an HTTP status', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('Disconnected');
    });
    const { db, client } = setup({ fetch: fetchImpl });
    const health = await new StatusService(db, client).probe();
    expect(health.state).toBe('down');
    expect(health.checks.every((check) => check.status === null)).toBe(true);
    expect(health.checks.every((check) => check.failure === 'network')).toBe(true);
  });

  it.each([
    [
      'blocked',
      () =>
        new Response('<html><div id="cf-error-details">Sorry, you have been blocked</div></html>', {
          status: 403,
          headers: { server: 'cloudflare', 'cf-ray': 'test-ray-EWR' },
        }),
    ],
    ['verification', () => new Response('<html>TencentEOCaptchaWidget</html>', { status: 403 })],
    ['invalid-response', () => new Response('<html>Unexpected page</html>')],
    ['http', () => new Response('Forbidden', { status: 403 })],
    [
      'timeout',
      () => {
        throw new DOMException('Timed out', 'TimeoutError');
      },
    ],
  ] as const)('preserves %s failure details for health tooltips', async (failure, respond) => {
    const challenge = vi.fn(async () => {});
    const { db, client } = setup({ fetch: vi.fn<typeof fetch>(async () => respond()), challenge });
    const health = await new StatusService(db, client).probe();
    expect(health.state).toBe('down');
    expect(health.checks.every((check) => check.failure === failure)).toBe(true);
    if (failure === 'blocked')
      expect(health.checks.every((check) => check.rayId === 'test-ray-EWR')).toBe(true);
    expect(
      health.checks.every(
        (check) =>
          check.status ===
          (failure === 'timeout' ? null : failure === 'invalid-response' ? 200 : 403),
      ),
    ).toBe(true);
    expect(challenge).not.toHaveBeenCalled();
  });
});

describe('verification and shutdown', () => {
  it('does not treat a verification phrase inside valid JSON as a CAPTCHA page', async () => {
    const challenge = vi.fn(async () => {});
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ players: [{ id: 8863, name: 'Security Verification' }] }),
    );
    const { client } = setup({ fetch: fetchImpl, challenge });
    expect((await client.get('/api/players/search', 'verification-name', 60_000)).value).toEqual({
      players: [{ id: 8863, name: 'Security Verification' }],
    });
    expect(challenge).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('unlocks a real HTML challenge once and retries through the scheduler', async () => {
    const challenge = vi.fn(async () => {});
    let state!: ReturnType<typeof setup>;
    const times: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      times.push(state.clock.now);
      return times.length === 1
        ? new Response('<html>TencentEOCaptchaWidget</html>', {
            headers: { 'Content-Type': 'text/html' },
          })
        : Response.json({ unlocked: true });
    });
    state = setup({ fetch: fetchImpl, challenge });
    expect((await state.client.get('/api/protected', 'protected', 60_000)).value).toEqual({
      unlocked: true,
    });
    expect(challenge).toHaveBeenCalledTimes(1);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1_200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a user-cancelled verification flow', async () => {
    const cancelled = Object.assign(new Error('Verification cancelled'), {
      code: 'BATRACE_VERIFY_CANCELLED',
    });
    const challenge = vi.fn(async () => {
      throw cancelled;
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response('<html>TencentEOCaptchaWidget</html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    const { client } = setup({ fetch: fetchImpl, challenge });
    await expect(client.get('/api/protected', 'cancelled', 60_000)).rejects.toBe(cancelled);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(challenge).toHaveBeenCalledTimes(1);
  });

  it('removes legacy User-Agent headers case-insensitively', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const { db, client } = setup({ fetch: fetchImpl });
    db.setState('privateHeaders', {
      'User-Agent': 'legacy',
      'user-agent': 'also legacy',
      'X-BA-Bypass': 'retained',
    });
    await client.get('/api/headers', 'headers', 60_000);
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.has('user-agent')).toBe(false);
    expect(headers.get('X-BA-Bypass')).toBe('retained');
  });

  it('aborts late responses and drains them before the database can be closed', async () => {
    let release!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const { db, client } = setup({ fetch: fetchImpl });
    const save = vi.spyOn(db, 'saveCache');
    const request = client.get('/api/late', 'late', 60_000);
    const rejected = expect(request).rejects.toThrow();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const closing = client.close();
    expect(signal?.aborted).toBe(true);
    release(Response.json({ arrivedTooLate: true }));
    await Promise.all([closing, rejected]);
    expect(save).not.toHaveBeenCalled();
    await expect(client.get('/api/late', 'late', 60_000)).rejects.toThrow();
  });
});
