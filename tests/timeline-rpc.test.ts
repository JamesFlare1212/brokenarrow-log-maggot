import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rpcSchemas } from '@ba/contracts';
import { emptyMatch } from '@ba/shared';
import { Application } from '../apps/server/src/app';
import { createBrowserFixtures } from '../apps/server/src/dev/browser';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient, type HttpPort } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { TrackerService } from '../apps/server/src/players/tracker';
import type { Platform } from '../apps/server/src/ports';
import { recordedTimelineMatch } from './timeline-fixture';

const recorded = recordedTimelineMatch();
const fid = '9485138';
const now = recorded.at + 60_000;
const resources: Array<{ db: Database; client: BatraceClient }> = [];
const cleanups: Array<() => Promise<void>> = [];
function setup(http: HttpPort) {
  const db = new Database(':memory:');
  const client = new BatraceClient(
    db,
    http,
    '4.5.9',
    () => now,
    async () => {},
    () => 0,
  );
  const tracker = new TrackerService(db, client, new Analyzer(client, db));
  resources.push({ db, client });
  return { db, client, tracker };
}
afterEach(async () => {
  for (const { db, client } of resources.splice(0)) {
    await client.close();
    db.close();
  }
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('lazy timeline match RPC and cache behavior', () => {
  it('validates the match ID and defaults force to false', () => {
    expect(rpcSchemas['matches.timeline'].parse({ fid })).toEqual({ fid, force: false });
    expect(rpcSchemas['matches.timeline'].parse({ fid, force: true })).toEqual({
      fid,
      force: true,
    });
    for (const input of [{ fid: 'local:1' }, { fid: '' }, { fid, force: 'true' }, {}])
      expect(rpcSchemas['matches.timeline'].safeParse(input).success).toBe(false);
  });

  it('uses one raw match request, then cache; no analysis, player requests or persisted timeline payload', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(recorded.value));
    const { db, tracker } = setup({ fetch: fetchImpl });
    const list = tracker.list();
    expect(fetchImpl).not.toHaveBeenCalled();
    const first = await tracker.timeline(fid);
    expect(first).toMatchObject({
      status: 'ready',
      reason: null,
      source: 'network',
      updatedAt: now,
    });
    expect(first.data?.duration).toBe(1339);
    const cached = await tracker.timeline(fid);
    expect(cached).toEqual({ ...first, source: 'cache' });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'https://bot.batrace.top/api/match?matchid=9485138',
    ]);
    expect(tracker.list()).toEqual(list);
    expect(db.cache(`match:${fid}`, true, now)?.value).toEqual(recorded.value);
    expect(db.cacheStats(now).api.entries).toBe(1);
    expect(db.cache(`timeline:${fid}`, true, now)).toBeNull();
  });

  it('forces refresh through the existing match client rather than returning a fresh cache hit', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(recorded.value));
    const { db, tracker } = setup({ fetch: fetchImpl });
    db.saveCache(`match:${fid}`, recorded.value, 120_000, recorded.at);
    expect(await tracker.timeline(fid, true)).toMatchObject({ source: 'network', updatedAt: now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves stale timestamps and payloads after network failures', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('Unavailable', { status: 403 }));
    const { db, tracker } = setup({ fetch: fetchImpl });
    db.saveCache(`match:${fid}`, recorded.value, 1, recorded.at);
    const before = db.cache(`match:${fid}`, true, now);
    expect(await tracker.timeline(fid)).toMatchObject({
      status: 'ready',
      source: 'stale',
      updatedAt: recorded.at,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // Existing API and HTML fallback.
    expect(db.cache(`match:${fid}`, true, now)).toEqual(before);
    await expect(tracker.timeline(fid, true)).rejects.toThrow('BATrace HTTP 403');
    expect(db.cache(`match:${fid}`, true, now)).toEqual(before);
  });

  it('serves forced offline requests from the recorded raw cache with no network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { db, tracker } = setup({ offline: true, fetch: fetchImpl });
    db.saveCache(`match:${fid}`, recorded.value, 1, recorded.at);
    for (const force of [false, true]) {
      expect(await tracker.timeline(fid, force)).toMatchObject({
        status: 'ready',
        source: 'stale',
        updatedAt: recorded.at,
      });
      expect(await tracker.timeline('123', force)).toEqual({
        status: 'unavailable',
        reason: 'missing-unit-data',
        data: null,
        source: 'local',
        updatedAt: null,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports summary-only and malformed cached matches as unavailable rather than zero charts', async () => {
    const { db, tracker } = setup({ offline: true, fetch: vi.fn<typeof fetch>() });
    for (const [value, reason] of [
      [{ matchInfo: { Data: '1=' } }, 'missing-unit-data'],
      [
        { matchInfo: { Data: { 1: { Id: 1 } }, StartTime: 100, TotalPlayTimeInSec: 0 } },
        'invalid-time',
      ],
      [
        { matchInfo: { Data: { 1: { Id: 1 } }, StartTime: 100, TotalPlayTimeInSec: 120 } },
        'missing-unit-data',
      ],
    ] as const) {
      db.saveCache(`match:${fid}`, value, 1, recorded.at);
      expect(await tracker.timeline(fid)).toEqual({
        status: 'unavailable',
        reason,
        data: null,
        source: 'stale',
        updatedAt: recorded.at,
      });
    }
  });

  it('never fetches known PvE matches and preserves online failures without raw cache', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('Not found', { status: 404 }));
    const { db, tracker } = setup({ fetch: fetchImpl });
    db.saveMatch({ ...emptyMatch(fid, recorded.at), mode: 'pve' });
    expect(await tracker.timeline(fid, true)).toEqual({
      status: 'unavailable',
      reason: 'unsupported-mode',
      data: null,
      source: 'local',
      updatedAt: recorded.at,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    db.saveMatch(emptyMatch('123', recorded.at));
    await expect(tracker.timeline('123')).rejects.toThrow('BATrace HTTP 404');
  });

  it('wires the application RPC without emitting a match mutation event', async () => {
    const root = resolve('.test-data/timeline-rpc');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(resolve(root, 'app-'));
    const events = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(recorded.value));
    const platform: Platform = {
      version: '4.5.9',
      http: { fetch: fetchImpl },
      selectDirectory: async () => null,
      detectLogDirectory: async () => '',
      openPath: async () => {},
      openExternal: async () => {},
      notify: () => {},
      recordings: {
        status: () => ({
          phase: 'idle',
          sessionId: null,
          fid: null,
          map: '',
          sourceId: '',
          startedAt: null,
          seconds: 0,
          hasAudio: false,
          error: null,
        }),
        start: async () => {},
        stop: async () => {},
        abort: async () => {},
        displays: async () => [],
        thumbnail: async () => null,
        playback: async () => '',
      },
    };
    const app = new Application(dir, platform, events, false);
    cleanups.push(async () => {
      await app.stop();
      await rm(dir, { recursive: true, force: true });
    });
    expect(await app.invoke('matches.timeline', { fid })).toMatchObject({
      status: 'ready',
      source: 'network',
    });
    expect(events.mock.calls.some(([event]) => event.type === 'matches')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await app.invoke('matches.list', {})).toEqual([]);
  });

  it('allows the timeline endpoint in browser fixture mode', async () => {
    const service = await createBrowserFixtures(
      resolve('tests/fixtures/real'),
      resolve('.test-data/timeline-browser'),
      '4.5.9',
      () => {},
    );
    cleanups.push(async () => {
      await service.stop();
      await rm(service.directory, { recursive: true, force: true });
    });
    expect(await service.invoke('matches.timeline', { fid, force: true })).toMatchObject({
      status: 'ready',
      source: 'stale',
      updatedAt: recorded.at,
      data: { duration: 1339 },
    });
  }, 30000);
});
