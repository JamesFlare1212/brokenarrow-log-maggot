import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient, type HttpPort } from '../apps/server/src/network/client';
import { StatusService } from '../apps/server/src/network/status';
import { parseMatchPage } from '../apps/server/src/network/match-page';
import { projectConfig, type NetworkConfig } from '../apps/server/src/config';

const capturedMatchHtml = readFileSync(
  new URL('./fixtures/batrace/match-9227650.html', import.meta.url),
  'utf8',
);
const capturedMatch = parseMatchPage(capturedMatchHtml, '9227650');

const databases = new Set<Database>();
const clients = new Set<BatraceClient>();
function setup(http: HttpPort, settings: NetworkConfig = projectConfig.network, random = () => 0) {
  const db = new Database(':memory:');
  databases.add(db);
  const clock = { now: Date.now() };
  const waits: number[] = [];
  const client = new BatraceClient(
    db,
    http,
    '4.0.0',
    () => clock.now,
    async (ms) => {
      waits.push(ms);
      clock.now += ms;
    },
    random,
    settings,
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
  it.each([
    { random: 0, offset: 0 },
    { random: 0.5, offset: 150 },
    { random: 0.999999, offset: 300 },
  ])(
    'uses an integer millisecond offset of $offset for random $random',
    async ({ random, offset }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
      const { client, waits } = setup(
        { fetch: fetchImpl },
        { ...projectConfig.network, requestOffsetMs: 300 },
        () => random,
      );
      await client.get('/api/offset', 'offset', 60000);
      expect(waits).toEqual(offset ? [offset] : []);
      await client.get('/api/offset', 'offset', 60000);
      expect(waits).toEqual(offset ? [offset] : []);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('draws new offsets for retries and uses configured attempts, timeout, and backoff', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('Unavailable', { status: 503 }));
    const random = vi.fn().mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { client, waits } = setup(
      { fetch: fetchImpl },
      {
        requestOffsetMs: 100,
        maxAttempts: 2,
        requestTimeoutMs: 321,
        retryDelayMs: 5,
      },
      random,
    );
    await expect(client.get('/api/retry-offset', 'retry-offset', 60000)).rejects.toThrow('503');
    expect(waits).toEqual([25, 5, 75]);
    expect(random).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(timeout.mock.calls).toEqual([[321], [321]]);
  });

  it('shares the offset delay before fetching duplicate requests', async () => {
    const db = new Database(':memory:');
    databases.add(db);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const random = vi.fn(() => 0.5);
    const wait = vi.fn(() => waiting);
    const client = new BatraceClient(db, { fetch: fetchImpl }, '4.0.0', undefined, wait, random, {
      ...projectConfig.network,
      requestOffsetMs: 300,
    });
    clients.add(client);
    const first = client.get('/api/shared-offset', 'shared-offset', 60000);
    const second = client.get('/api/shared-offset', 'shared-offset', 60000);
    try {
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(wait).toHaveBeenCalledTimes(1);
      expect(random).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    expect(await first).toEqual(await second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['request', 'close'])(
    'cancels the offset on %s without sending a request',
    async (mode) => {
      const db = new Database(':memory:');
      databases.add(db);
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
      const client = new BatraceClient(
        db,
        { fetch: fetchImpl },
        '4.0.0',
        undefined,
        undefined,
        () => 0.5,
        {
          ...projectConfig.network,
          requestOffsetMs: 60000,
        },
      );
      clients.add(client);
      const controller = new AbortController();
      const request = client.get('/api/cancel-offset', 'cancel-offset', 60000, {
        signal: controller.signal,
      });
      const rejected = expect(request).rejects.toThrow();
      if (mode === 'close') await client.close();
      else controller.abort();
      await rejected;
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(db.cache('cancel-offset', true)).toBeNull();
    },
  );

  it('finishes an independent request while another response body is still pending', async () => {
    let release!: (body: string) => void;
    const slowBody = new Promise<string>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/slow')) {
        const response = Response.json({ slow: true });
        vi.spyOn(response, 'text').mockImplementation(() => slowBody);
        return response;
      }
      return Response.json({ fast: true });
    });
    const { client } = setup({ fetch: fetchImpl });
    const slow = client.get('/api/slow', 'slow', 60000);
    let fastResult: unknown;
    const fast = client.get('/api/fast', 'fast', 60000).then((result) => {
      fastResult = result;
    });
    try {
      await vi.waitFor(() => expect(fastResult).toMatchObject({ value: { fast: true } }));
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      release('{"slow":true}');
      await Promise.all([slow, fast]);
    }
  });

  it('allows more than 400 requests without a fixed delay between successful requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const { client, waits } = setup({ fetch: fetchImpl });
    const results = await Promise.all(
      Array.from({ length: 405 }, (_, i) => client.get(`/api/fake/${i}`, `key:${i}`, 60_000)),
    );
    expect(results).toHaveLength(405);
    expect(fetchImpl).toHaveBeenCalledTimes(405);
    expect(waits).toEqual([]);
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

  it.each([
    { status: 503, retryAfter: '2', delay: 2000 },
    { status: 429, retryAfter: '2', delay: 2000 },
    { status: 503, retryAfter: null, delay: 1200 },
  ])(
    'counts retries and backs off for HTTP $status with Retry-After $retryAfter',
    async ({ status, retryAfter, delay }) => {
      const attemptTimes: number[] = [];
      let state!: ReturnType<typeof setup>;
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        attemptTimes.push(state.clock.now);
        return attemptTimes.length < 3
          ? new Response('temporarily unavailable', {
              status,
              headers: retryAfter ? { 'Retry-After': retryAfter } : {},
            })
          : Response.json({ ok: true });
      });
      state = setup({ fetch: fetchImpl });
      const changed = vi.fn();
      const statuses = new StatusService(state.db, state.client, true, changed);
      const result = await state.client.get('/api/retry', 'retry', 60_000);
      expect(result.source).toBe('network');
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(result.attempts).toBe(3);
      expect(statuses.health().state).toBe('ok');
      expect(changed).toHaveBeenCalledTimes(1);
      expect(attemptTimes[1]! - attemptTimes[0]!).toBe(delay);
      expect(attemptTimes[2]! - attemptTimes[1]!).toBe(delay);
      for (const [url, init] of fetchImpl.mock.calls) {
        expect(url).toBe('https://bot.batrace.top/api/retry');
        expect(new Headers(init?.headers).get('X-Client')).toBe('brokenarrow-log-maggot');
      }
    },
  );

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

describe('business request health updates', () => {
  it('publishes failures and recovery by endpoint without extra probes or duplicate query rows', async () => {
    let available = false;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      available ? Response.json({ players: [] }) : new Response('Forbidden', { status: 403 }),
    );
    const { db, client } = setup({ fetch: fetchImpl });
    const changed = vi.fn();
    const statuses = new StatusService(db, client, true, changed);
    await expect(client.get('/api/players/search?q=first', 'first', 60000)).rejects.toThrow('403');
    expect(statuses.health()).toMatchObject({
      state: 'down',
      checks: [{ path: '/api/players/search?q=first', ok: false, status: 403 }],
    });
    available = true;
    await client.get('/api/players/search?q=second', 'second', 60000);
    expect(statuses.health()).toMatchObject({
      state: 'ok',
      checks: [{ path: '/api/players/search?q=second', ok: true, status: 200 }],
    });
    expect(statuses.health().checks).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(db.state('health', null)).toEqual(statuses.health());
  });

  it('does not turn fresh, stale, or offline cached responses into connection recovery', async () => {
    let available = true;
    const http: HttpPort = {
      fetch: vi.fn<typeof fetch>(async () =>
        available ? Response.json({ players: [] }) : new Response('Forbidden', { status: 403 }),
      ),
    };
    const { db, client } = setup(http);
    const changed = vi.fn();
    const statuses = new StatusService(db, client, true, changed);
    const path = '/api/players/search?q=cached';
    await client.get(path, 'cached', 60000);
    available = false;
    expect(
      await client.get(path, 'cached', 60000, { force: true, allowStale: true }),
    ).toMatchObject({
      source: 'stale',
    });
    expect(statuses.health().state).toBe('down');
    expect((await client.get(path, 'cached', 60000)).source).toBe('cache');
    http.offline = true;
    expect((await client.get(path, 'cached', 60000)).source).toBe('stale');
    expect(statuses.health().state).toBe('down');
    expect(changed).toHaveBeenCalledTimes(2);
    expect(http.fetch).toHaveBeenCalledTimes(2);
  });

  it('retains API failure alongside a working page fallback and clears it on API recovery', async () => {
    let available = false;
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      !String(url).includes('/api/')
        ? new Response(capturedMatchHtml)
        : available
          ? Response.json(capturedMatch)
          : new Response('Forbidden', { status: 403 }),
    );
    const { db, client } = setup({ fetch: fetchImpl });
    const statuses = new StatusService(db, client);
    await client.match('9227650', true);
    expect(statuses.health()).toMatchObject({
      state: 'partial',
      checks: [
        {
          path: '/api/match?matchid=9227650',
          ok: false,
          status: 403,
          fallback: { path: '/match/9227650', ok: true, status: 200 },
        },
      ],
    });
    available = true;
    await client.match('9227650', true);
    expect(statuses.health()).toMatchObject({ state: 'ok' });
    expect(statuses.health().checks).toHaveLength(1);
    expect(statuses.health().checks[0]?.fallback).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps a newer business result when an overlapping full probe finishes', async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes('/search?q=test')) return new Response('Forbidden', { status: 403 });
      if (String(url).includes('/info?'))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return Response.json(capturedMatch);
    });
    const { db, client } = setup({ fetch: fetchImpl });
    const statuses = new StatusService(db, client);
    const probe = statuses.probe();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const business = client.get('/api/players/search?q=live', 'live', 60000);
    release(Response.json({ info: {} }));
    await business;
    await probe;
    expect(statuses.health().state).toBe('ok');
    expect(
      statuses.health().checks.find((check) => check.path.startsWith('/api/players/search')),
    ).toMatchObject({ path: '/api/players/search?q=live', ok: true });
    expect(statuses.health().checks).toHaveLength(5);
  });

  it('ignores cancelled requests and late responses after shutdown', async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { db, client } = setup({ fetch: fetchImpl });
    const changed = vi.fn();
    const statuses = new StatusService(db, client, true, changed);
    const controller = new AbortController();
    const pending = client.get('/api/players/search', 'cancelled-health', 60000, {
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort();
    release(Response.json({ players: [] }));
    await rejected;
    expect(statuses.health().state).toBe('unknown');
    const closingRequest = client.get('/api/players/search', 'closing-health', 60000);
    const closingRejected = expect(closingRequest).rejects.toThrow();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const closing = client.close();
    release(Response.json({ players: [] }));
    await Promise.all([closing, closingRejected]);
    expect(changed).not.toHaveBeenCalled();
    expect(db.state('health', null)).toBeNull();
  });

  it.each([
    ['http', () => new Response('Forbidden', { status: 403 })],
    [
      'blocked',
      () =>
        new Response('<html>Sorry, you have been blocked</html>', {
          status: 403,
          headers: { server: 'cloudflare', 'cf-ray': 'business-ray' },
        }),
    ],
    ['invalid-response', () => new Response('<html>Unexpected page</html>')],
    [
      'timeout',
      () => {
        throw new DOMException('Timed out', 'TimeoutError');
      },
    ],
    [
      'network',
      () => {
        throw new Error('Connection closed');
      },
    ],
  ] as const)('preserves %s errors from business requests', async (failure, respond) => {
    const { db, client } = setup({ fetch: vi.fn<typeof fetch>(async () => respond()) });
    const changed = vi.fn();
    const statuses = new StatusService(db, client, true, changed);
    await expect(client.analysisPlayer('8863', true)).rejects.toThrow();
    expect(statuses.health()).toMatchObject({ state: 'down', checks: [{ failure }] });
    expect(statuses.health().checks[0]?.status).toBe(
      failure === 'timeout' || failure === 'network'
        ? null
        : failure === 'invalid-response'
          ? 200
          : 403,
    );
    if (failure === 'blocked') expect(statuses.health().checks[0]?.rayId).toBe('business-ray');
    expect(changed).toHaveBeenCalledTimes(1);
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
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://bot.batrace.top');
      expect(new Headers(init?.headers).get('X-Client')).toBe('brokenarrow-log-maggot');
    }
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
    ['invalid-response', () => new Response('<html>Unexpected page</html>')],
    ['http', () => new Response('Forbidden', { status: 403 })],
    [
      'timeout',
      () => {
        throw new DOMException('Timed out', 'TimeoutError');
      },
    ],
  ] as const)('preserves %s failure details for health tooltips', async (failure, respond) => {
    const { db, client } = setup({ fetch: vi.fn<typeof fetch>(async () => respond()) });
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
  });
});

describe('invalid responses and shutdown', () => {
  it('accepts arbitrary player names inside valid JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ players: [{ id: 8863, name: 'Security Verification' }] }),
    );
    const { client } = setup({ fetch: fetchImpl });
    expect((await client.get('/api/players/search', 'verification-name', 60_000)).value).toEqual({
      players: [{ id: 8863, name: 'Security Verification' }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([200, 403])(
    'fails an unexpected HTML response with status %s without retrying',
    async (status) => {
      const fetchImpl = vi.fn<typeof fetch>(
        async () =>
          new Response('<html>Access denied</html>', {
            status,
            headers: { 'Content-Type': 'text/html' },
          }),
      );
      const { db, client } = setup({ fetch: fetchImpl });
      await expect(client.get('/api/protected', 'protected', 60_000)).rejects.toThrow(
        status === 403 ? 'BATrace HTTP 403' : 'BATrace returned invalid JSON',
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(db.cache('protected', true)).toBeNull();
    },
  );

  it('replaces legacy client identity headers case-insensitively and preserves private headers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const { db, client } = setup({ fetch: fetchImpl });
    db.setState('privateHeaders', {
      'User-Agent': 'legacy',
      'user-agent': 'also legacy',
      'x-client': 'legacy-app/1.0.0',
      'X-BA-Bypass': 'retained',
      ignored: 123,
    });
    await client.get('/api/headers', 'headers', 60_000);
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://bot.batrace.top/api/headers');
    expect(headers.get('User-Agent')).toBe(
      'brokenarrow-log-maggot/4.0.0 (+https://github.com/JamesFlare1212/brokenarrow-log-maggot)',
    );
    expect(headers.get('X-Client')).toBe('brokenarrow-log-maggot');
    expect(headers.get('X-BA-Bypass')).toBe('retained');
    expect(headers.has('ignored')).toBe(false);
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
