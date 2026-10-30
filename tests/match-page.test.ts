import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyMatch, normalizeMatch } from '@ba/shared';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient, type HttpPort } from '../apps/server/src/network/client';
import { parseMatchPage } from '../apps/server/src/network/match-page';
import { TrackerService } from '../apps/server/src/players/tracker';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { StatusService } from '../apps/server/src/network/status';

const id = '9227650';
const capturedHtml = readFileSync(
  new URL('./fixtures/batrace/match-9227650.html', import.meta.url),
  'utf8',
);
const capturedData = parseMatchPage(capturedHtml, id);
function page(data: unknown, matchId = id, split = false) {
  const payload = `21:${JSON.stringify(['$', '$L2c', null, { matchId, initialMatchData: data }])}\n`;
  const chunks = split ? [payload.slice(0, 80), payload.slice(80)] : [payload];
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
    '4.0.0',
    () => now,
    async (ms) => {
      now += ms;
    },
    () => 0,
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

describe('BATrace match page parsing', () => {
  it('preserves the captured roster, ratings and result without substituting values', () => {
    const match = normalizeMatch(capturedData, { id, localId: '75402' });
    expect(match).toMatchObject({
      map: 'Dam',
      mode: 'ranked',
      outcome: 'win',
      durationSec: 1976,
      eloBefore: 1985.254,
      eloAfter: 1993.9521,
    });
    expect(match.players).toHaveLength(10);
    expect(match.players.find((player) => player.id === '75402')).toMatchObject({
      name: 'JamesFlare',
      destructionScore: 6685,
      lossesScore: 4490,
      damageDealt: 1471,
    });
  });

  it('joins streamed fragments and ignores executable frames', () => {
    const html =
      '<script>self.__next_f.push(globalThis.run())</script>' + page(capturedData, id, true);
    expect(parseMatchPage(html, id)).toEqual(capturedData);
  });

  it.each([
    ['login page', '<html>Login</html>'],
    ['visible match ID only', `<html>Match #${id}</html>`],
    ['another match', page(capturedData, '1')],
    ['missing data', page(null)],
    ['empty roster', page({ matchInfo: { Data: {} } })],
    ['invalid roster string', page({ matchInfo: { Data: 'unavailable' } })],
  ])('rejects %s', (_name, html) => {
    expect(() => parseMatchPage(html, id)).toThrow(/no complete data/);
  });
});

describe('BATrace match detail fallback', () => {
  it('marks stale match data with a presentation-independent warning code', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { db, client, now } = setup({ fetch: fetchImpl, offline: true });
    db.saveCache(`match:${id}`, capturedData, 1, now - 60_000);
    const tracker = new TrackerService(db, client, new Analyzer(client, db));
    expect(await tracker.detail(id)).toMatchObject({
      warningCode: 'batrace-cache',
      warning: 'Cached match data; BATrace is unavailable',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([0, 60_000])(
    'clears imported cache-warning metadata after a fresh response with a %i ms old snapshot',
    async (age) => {
      const { db, client, now } = setup({ fetch: async () => Response.json(capturedData) });
      db.saveMatch({
        ...normalizeMatch(capturedData, { id, localId: '75402', now: now - age }),
        warningCode: 'batrace-cache',
        warning: 'Cached match data; BATrace is unavailable',
      });
      const tracker = new TrackerService(db, client, new Analyzer(client, db));
      const result = await tracker.detail(id, true);
      expect(result.warningCode).toBeUndefined();
      expect(result.warning).toBeUndefined();
      expect(result.updatedAt).toBe(now);
      expect(db.match(id)?.warningCode).toBeUndefined();
      expect(db.match(id)?.warning).toBeUndefined();
      expect(db.match(id)?.updatedAt).toBe(now);
    },
  );
  it('refreshes an existing unknown match after a Cloudflare block and saves the real result', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/api/')
        ? new Response(
            '<html><div id="cf-error-details">Sorry, you have been blocked</div></html>',
            {
              status: 403,
              headers: { server: 'cloudflare', 'cf-ray': 'test-match-ray' },
            },
          )
        : new Response(capturedHtml),
    );
    const { db, client, times, now } = setup({ fetch: fetchImpl });
    const previous = { ...emptyMatch(id, now - 60_000), localPlayerId: '75402' };
    db.saveMatch(previous);
    db.saveCache(`match:${id}`, { matchInfo: { Data: '75402=' } }, 86400000, now);
    const tracker = new TrackerService(db, client, new Analyzer(client, db));
    expect(await tracker.detail(id, true)).toMatchObject({ outcome: 'win', eloAfter: 1993.9521 });
    expect(db.match(id)).toMatchObject({ outcome: 'win', mode: 'ranked' });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `https://bot.batrace.top/api/match?matchid=${id}`,
      `https://dash.batrace.top/match/${id}`,
      `https://bot.batrace.top/api/analysis/match?matchid=${id}`,
    ]);
    expect(times[1]! - times[0]!).toBe(0);
    expect(db.cache(`match:${id}`, false)?.value).toEqual(capturedData);
    expect((await client.match(id)).source).toBe('cache');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('shares concurrent refreshes through the API and page', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/api/')
        ? new Response('Forbidden', { status: 403 })
        : new Response(capturedHtml),
    );
    const { client } = setup({ fetch: fetchImpl });
    const results = await Promise.all([client.match(id, true), client.match(id, true)]);
    expect(results[0]).toMatchObject({ value: capturedData, source: 'network', attempts: 2 });
    expect(results[1]).toEqual(results[0]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses a healthy JSON API without requesting the page', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(capturedData));
    const { client } = setup({ fetch: fetchImpl });
    expect(await client.match(id, true)).toMatchObject({ value: capturedData, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('tries the page when the API returns incomplete data', async () => {
    const { client } = setup({
      fetch: async (url) =>
        String(url).includes('/api/')
          ? Response.json({ matchInfo: null })
          : new Response(capturedHtml),
    });
    expect(await client.match(id, true)).toMatchObject({ value: capturedData, attempts: 2 });
  });

  it('preserves old data and timestamps when both sources fail, and never reports forced refresh as successful', async () => {
    const { db, client, now } = setup({
      fetch: async (url) =>
        String(url).includes('/api/')
          ? new Response('Forbidden', { status: 403 })
          : new Response(page(capturedData, '1')),
    });
    const at = now - 60_000;
    db.saveCache(`match:${id}`, capturedData, 1, at);
    db.saveMatch(normalizeMatch(capturedData, { id, localId: '75402', now: at }));
    const previous = db.match(id);
    expect(await client.match(id)).toMatchObject({ value: capturedData, source: 'stale', at });
    const tracker = new TrackerService(db, client, new Analyzer(client, db));
    await expect(tracker.detail(id, true)).rejects.toThrow(/incomplete match data/);
    expect(db.cache(`match:${id}`, true)?.at).toBe(at);
    expect(db.match(id)).toEqual(previous);
  });

  it('never caches data from the wrong match', async () => {
    const { db, client } = setup({
      fetch: async (url) =>
        String(url).includes('/api/')
          ? new Response('Forbidden', { status: 403 })
          : new Response(page(capturedData, '1')),
    });
    await expect(client.match(id, true)).rejects.toThrow(/incomplete match data/);
    expect(db.cache(`match:${id}`, true)).toBeNull();
  });

  it('does not request a page in offline real-data mode', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { db, client, now } = setup({ fetch: fetchImpl, offline: true });
    db.saveCache(`match:${id}`, capturedData, 1, now - 60_000);
    expect(await client.match(id, true)).toMatchObject({ value: capturedData, source: 'stale' });
    await expect(client.match('1')).rejects.toThrow(/no recorded response/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports an HTML access-denied response when both sources fail', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('<html>Access denied</html>', { status: 403 }),
    );
    const { client } = setup({ fetch: fetchImpl });
    await expect(client.match(id, true)).rejects.toThrow('BATrace HTTP 403');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('BATrace match detail health', () => {
  const apiPath = `/api/match?matchid=${id}`;
  const pagePath = `/match/${id}`;

  it('reports the blocked API and available page separately, bypasses caches and recovers on a later probe', async () => {
    let mode: 'fallback' | 'down' | 'api' = 'fallback';
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith(pagePath) && mode === 'fallback') return new Response(capturedHtml);
      if (mode === 'api') return Response.json(capturedData);
      return new Response('<html>Sorry, you have been blocked</html>', {
        status: 403,
        headers: { server: 'cloudflare', 'cf-ray': 'match-health-ray' },
      });
    });
    const { db, client, times, now } = setup({ fetch: fetchImpl });
    db.saveCache(`health:${apiPath}`, capturedData, 60_000, now);
    db.saveCache(`health:${pagePath}`, capturedData, 60_000, now);
    db.saveCache(`match:${id}`, capturedData, 60_000, now);
    const statuses = new StatusService(db, client);
    const first = await statuses.probe();
    expect(first.state).toBe('partial');
    expect(first.checks).toHaveLength(5);
    expect(first.checks.find((check) => check.path === apiPath)).toMatchObject({
      ok: false,
      status: 403,
      failure: 'blocked',
      rayId: 'match-health-ray',
      fallback: { path: pagePath, ok: true, status: 200 },
    });
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBe(0);
    mode = 'down';
    const down = await statuses.probe();
    expect(down.state).toBe('down');
    expect(down.checks.find((check) => check.path === apiPath)?.fallback).toMatchObject({
      ok: false,
      status: 403,
      failure: 'blocked',
    });
    mode = 'api';
    const recovered = await statuses.probe();
    expect(recovered.state).toBe('ok');
    expect(recovered.checks.find((check) => check.path === apiPath)).toMatchObject({
      ok: true,
      status: 200,
    });
    expect(recovered.checks.find((check) => check.path === apiPath)?.fallback).toBeUndefined();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith(pagePath))).toHaveLength(2);
    for (const key of [`health:${apiPath}`, `health:${pagePath}`, `match:${id}`])
      expect(db.cache(key, true)?.at).toBe(now);
  });

  it.each([
    ['incomplete page', '<html>Login</html>'],
    ['another match', page(capturedData, '1')],
  ])('rejects a %s as a healthy fallback even with HTTP 200', async (_name, html) => {
    const { db, client } = setup({
      fetch: async (url) =>
        String(url).includes('/api/')
          ? new Response('Forbidden', { status: 403 })
          : new Response(html),
    });
    const health = await new StatusService(db, client).probe();
    expect(health.state).toBe('down');
    expect(health.checks.find((check) => check.path === apiPath)?.fallback).toMatchObject({
      ok: false,
      status: 200,
      failure: 'invalid-response',
    });
  });

  it('rejects an incomplete API response before trying the validated page', async () => {
    const { db, client } = setup({
      fetch: async (url) =>
        String(url).endsWith(pagePath)
          ? new Response(capturedHtml)
          : Response.json({ matchInfo: null }),
    });
    const health = await new StatusService(db, client).probe();
    expect(health.state).toBe('partial');
    expect(health.checks.find((check) => check.path === apiPath)).toMatchObject({
      ok: false,
      status: 200,
      failure: 'invalid-response',
      fallback: { path: pagePath, ok: true, status: 200 },
    });
  });
});
