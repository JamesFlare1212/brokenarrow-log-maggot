import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient, type HttpPort } from '../apps/server/src/network/client';

const databases = new Set<Database>();
const clients = new Set<BatraceClient>();
function setup(http: HttpPort, interval = 1_200) {
  const db = new Database(':memory:');
  databases.add(db);
  const clock = { now: Date.now() };
  const waits: number[] = [];
  const changed = vi.fn();
  const client = new BatraceClient(
    db,
    http,
    changed,
    interval,
    () => clock.now,
    async (ms) => {
      waits.push(ms);
      clock.now += ms;
    },
  );
  clients.add(client);
  return { db, client, clock, waits, changed };
}
afterEach(async () => {
  await Promise.all([...clients].map((client) => client.close()));
  clients.clear();
  for (const db of databases) db.close();
  databases.clear();
});

describe('BATrace scheduling and cache boundaries', () => {
  it('allows only one of three concurrent requests when one daily call remains', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const { db, client, clock } = setup({ fetch: fetchImpl });
    const insert = db.sql.prepare('INSERT INTO api_calls(at,path) VALUES(?,?)');
    db.transaction(() => {
      for (let i = 0; i < 399; i++) insert.run(clock.now - 1, 'fixture');
    });
    const result = await Promise.allSettled(
      [1, 2, 3].map((i) => client.get(`/api/fake/${i}`, `key:${i}`, 60_000)),
    );
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.usage(clock.now).used24h).toBe(400);
  });

  it('shares an in-flight request for the same cache key', async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { db, client } = setup({ fetch: fetchImpl });
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
    expect(db.usage().attempts).toBe(1);
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
    expect(state.db.usage(state.clock.now)).toMatchObject({ used24h: 3, attempts: 3 });
    expect(attemptTimes[1]! - attemptTimes[0]!).toBeGreaterThanOrEqual(2_000);
    expect(attemptTimes[2]! - attemptTimes[1]!).toBeGreaterThanOrEqual(2_000);
    expect(state.changed).toHaveBeenCalledTimes(3);
  });

  it('uses a fresh cache without spending quota, and force replaces it from the network', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ version: 'new' }));
    const { db, client, clock } = setup({ fetch: fetchImpl });
    db.saveCache('force', { version: 'old' }, 60_000, clock.now);
    expect(await client.get('/api/force', 'force', 60_000)).toMatchObject({
      value: { version: 'old' },
      source: 'cache',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.usage(clock.now).used24h).toBe(0);
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

  it('does not charge health probes to the content quota', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const { db, client } = setup({ fetch: fetchImpl });
    await client.get('/api/health', 'health', 0, { health: true, force: true });
    expect(db.usage().used24h).toBe(0);
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
    expect(state.db.usage(state.clock.now).attempts).toBe(2);
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
