import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient, type HttpPort } from '../apps/server/src/network/client';
import { parsePlayerPage } from '../apps/server/src/network/player-page';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { StatusService } from '../apps/server/src/network/status';

const capturedHtml = readFileSync(
  new URL('./fixtures/batrace/player-8863.html', import.meta.url),
  'utf8',
);
const capturedData = parsePlayerPage(capturedHtml, '8863') as {
  info: { id: number; name: string; rating: number };
  statInfo: Record<string, unknown>;
};
function page(data: unknown, split = false) {
  const payload = `2:["$","$L3",null,${JSON.stringify({ playerData: data })}]\n`;
  const chunks = split ? [payload.slice(0, 75), payload.slice(75)] : [payload];
  return `<html>${chunks.map((chunk) => `<script>self.__next_f.push(${JSON.stringify([1, chunk]).replaceAll('<', '\\u003c')})</script>`).join('')}</html>`;
}
const resources: Array<{ db: Database; client: BatraceClient }> = [];
function setup(http: HttpPort) {
  const db = new Database(':memory:');
  let now = Date.now();
  const times: number[] = [];
  const client = new BatraceClient(
    db,
    {
      ...http,
      fetch: (url, init) => {
        times.push(now);
        return http.fetch(url, init);
      },
    },
    1200,
    () => now,
    async (ms) => {
      now += ms;
    },
  );
  resources.push({ db, client });
  return { db, client, times, now };
}
afterEach(async () => {
  for (const { db, client } of resources.splice(0)) {
    await client.close();
    db.close();
  }
});

describe('BATrace player page parsing', () => {
  it('reads the captured server payload and preserves exact statistics', () => {
    expect(parsePlayerPage(capturedHtml, '8863')).toMatchObject({
      info: { id: 8863, name: 'Zola', level: 87, rating: 2496.975 },
      statInfo: { playerId: 8863, fightsCountRt: 949, winCountRt: 650, lossCountRt: 282 },
    });
  });

  it('joins streamed model fragments and decodes escaped names without executing scripts', () => {
    const name = '玩家 "quoted" \\ path\n<script>throw new Error("Do not execute")</script>';
    const html = page({ ...capturedData, info: { ...capturedData.info, name } }, true);
    expect(parsePlayerPage(html, '8863')).toMatchObject({ info: { name } });
  });

  it.each([
    ['login page', '<html><form>Login</form></html>'],
    ['visible numbers only', '<html><h1>Zola</h1><p>Rating 2496.975</p></html>'],
    ['another player', page({ ...capturedData, info: { ...capturedData.info, id: 1 } })],
    [
      'another statistics owner',
      page({ ...capturedData, statInfo: { ...capturedData.statInfo, playerId: 1 } }),
    ],
    ['missing name', page({ ...capturedData, info: { ...capturedData.info, name: '' } })],
    ['missing statistics', page({ info: capturedData.info })],
    [
      'missing outcomes',
      page({ ...capturedData, statInfo: { playerId: 8863, fightsCountRt: 949 } }),
    ],
    ['executable frame', '<script>self.__next_f.push(globalThis.run())</script>'],
  ])('rejects %s instead of generating substitute data', (_name, html) => {
    expect(() => parsePlayerPage(html, '8863')).toThrow(/no complete data/);
  });
});

describe('BATrace player health fallback', () => {
  it('probes the page without cache, preserves the API failure and tracks fallback recovery', async () => {
    let available = true;
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/api/') || !available
        ? new Response('<html>Sorry, you have been blocked</html>', {
            status: 403,
            headers: { server: 'cloudflare', 'cf-ray': 'health-ray-EWR' },
          })
        : new Response(capturedHtml),
    );
    const { db, client, now } = setup({ fetch: fetchImpl });
    db.saveCache('info:8863', capturedData, 60_000, now);
    db.saveCache('health:/player/8863', capturedData, 60_000, now);
    const health = new StatusService(db, client);
    const first = health.probe();
    expect(health.probe()).toBe(first);
    expect(await first).toMatchObject({
      state: 'partial',
      checks: expect.arrayContaining([
        {
          path: '/api/players/info?stbid=8863',
          ok: false,
          ms: expect.any(Number),
          status: 403,
          failure: 'blocked',
          rayId: 'health-ray-EWR',
          fallback: { path: '/player/8863', ok: true, ms: expect.any(Number), status: 200 },
        },
      ]),
    });
    expect(health.health().checks).toHaveLength(4);
    expect(db.cache('health:/player/8863', true)?.at).toBe(now);
    available = false;
    expect(await health.probe()).toMatchObject({ state: 'down' });
    expect(health.health().checks[1]?.fallback).toMatchObject({
      ok: false,
      status: 403,
      failure: 'blocked',
      rayId: 'health-ray-EWR',
    });
    available = true;
    expect(await health.probe()).toMatchObject({ state: 'partial' });
    expect(
      fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/player/8863')),
    ).toHaveLength(3);
    expect(db.cache('info:8863', true)?.at).toBe(now);
  });

  it.each([
    ['incomplete page', '<html>Login</html>'],
    ['wrong player', page({ ...capturedData, info: { ...capturedData.info, id: 1 } })],
  ])('keeps a %s unavailable even with HTTP 200', async (_name, html) => {
    const { db, client } = setup({
      fetch: async (url) =>
        String(url).includes('/api/')
          ? new Response('Forbidden', { status: 403 })
          : new Response(html),
    });
    const health = await new StatusService(db, client).probe();
    expect(health.state).toBe('down');
    expect(health.checks[1]?.fallback).toMatchObject({
      ok: false,
      status: 200,
      failure: 'invalid-response',
    });
  });
});

describe('BATrace player info fallback', () => {
  it('shares requests, schedules the page after a blocked API, caches it and refreshes on force', async () => {
    let html = capturedHtml;
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/api/')
        ? new Response('Forbidden', { status: 403 })
        : new Response(html, { headers: { 'Content-Type': 'text/html' } }),
    );
    const { db, client, times } = setup({ fetch: fetchImpl });
    const results = await Promise.all([client.playerInfo('8863'), client.playerInfo('8863')]);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'https://dash.batrace.top/api/players/info?stbid=8863',
      'https://dash.batrace.top/player/8863',
    ]);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1200);
    expect(results[0]).toMatchObject({ value: capturedData, source: 'network', attempts: 2 });
    expect(results[1]).toEqual(results[0]);
    expect((await client.playerInfo('8863')).source).toBe('cache');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    html = page({ ...capturedData, info: { ...capturedData.info, name: 'Updated name' } });
    expect(await client.playerInfo('8863', true)).toMatchObject({
      value: { info: { name: 'Updated name' } },
      attempts: 2,
    });
    expect(db.cache('info:8863', false)?.value).toMatchObject({ info: { name: 'Updated name' } });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('uses a healthy JSON API without requesting the page', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(capturedData));
    const { client } = setup({ fetch: fetchImpl });
    expect(await client.playerInfo('8863')).toMatchObject({ value: capturedData, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['HTTP failure', () => new Response('Missing', { status: 404 })],
    ['invalid JSON', () => new Response('<html>Unexpected page</html>')],
    ['incomplete JSON', () => Response.json({ error: 'No player' })],
    [
      'wrong player JSON',
      () => Response.json({ ...capturedData, info: { ...capturedData.info, id: 1 } }),
    ],
  ])('tries the page after %s', async (_name, respond) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/api/') ? respond() : new Response(capturedHtml),
    );
    const { client } = setup({ fetch: fetchImpl });
    expect(await client.playerInfo('8863')).toMatchObject({ value: capturedData, attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('tries the page before old cache, and preserves the timestamp when both requests fail', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/api/')
        ? new Response('Forbidden', { status: 403 })
        : new Response('<html>Login</html>'),
    );
    const { db, client, now } = setup({ fetch: fetchImpl });
    const at = now - 10000;
    db.saveCache('info:8863', capturedData, 1, at);
    expect(await client.playerInfo('8863')).toMatchObject({
      value: capturedData,
      source: 'stale',
      at,
      attempts: 2,
    });
    await expect(client.playerInfo('8863', true)).rejects.toThrow(/incomplete player data/);
    expect(db.cache('info:8863', true)?.at).toBe(at);
  });

  it('does not cache a wrong-player page', async () => {
    const { db, client } = setup({
      fetch: async (url) =>
        String(url).includes('/api/')
          ? new Response('Forbidden', { status: 403 })
          : new Response(page({ ...capturedData, info: { ...capturedData.info, id: 1 } })),
    });
    await expect(client.playerInfo('8863')).rejects.toThrow(/incomplete player data/);
    expect(db.cache('info:8863', true)).toBeNull();
  });

  it('never requests a page in offline real-data mode', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { db, client, now } = setup({ fetch: fetchImpl, offline: true });
    db.saveCache('info:8863', capturedData, 1, now - 10000);
    expect(await client.playerInfo('8863', true)).toMatchObject({
      value: capturedData,
      source: 'stale',
    });
    await expect(client.playerInfo('1')).rejects.toThrow(/no recorded response/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fall back after cancelled verification', async () => {
    const cancelled = new Error('Verification cancelled');
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('<html>TencentEOCaptchaWidget</html>'),
    );
    const { client } = setup({
      fetch: fetchImpl,
      challenge: async () => {
        throw cancelled;
      },
    });
    await expect(client.playerInfo('8863')).rejects.toBe(cancelled);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts and drains the fallback page before closing the database', async () => {
    let release!: (value: Response) => void;
    let signal: AbortSignal | null | undefined;
    const { db, client } = setup({
      fetch: async (url, init) => {
        if (String(url).includes('/api/')) return new Response('Forbidden', { status: 403 });
        signal = init?.signal;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
    });
    const save = vi.spyOn(db, 'saveCache');
    const request = client.playerInfo('8863');
    const rejected = expect(request).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const closing = client.close();
    expect(signal?.aborted).toBe(true);
    release(new Response(capturedHtml));
    await Promise.all([closing, rejected]);
    expect(save).not.toHaveBeenCalled();
  });

  it('produces a real report and snapshot when both JSON endpoints are blocked', async () => {
    const { db, client } = setup({
      fetch: async (url) =>
        String(url).includes('/api/')
          ? new Response('Forbidden', { status: 403 })
          : new Response(capturedHtml),
    });
    const analyzer = new Analyzer(client, db);
    const report = await analyzer.report('8863', true);
    expect(report).toMatchObject({
      name: 'Zola',
      level: 87,
      elo: 2496.975,
      fallback: true,
      matchCount: 949,
      sampleCount: 932,
      wins: 650,
      losses: 282,
      winRate: 70,
      kd: null,
    });
    expect(db.snapshot('8863')).toEqual(analyzer.mini(report));
  });
});
