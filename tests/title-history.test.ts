import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { normalizeMatch, summarizeTitleHistory, type TitleHistoryFixture } from '@ba/shared';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { TrackerService } from '../apps/server/src/players/tracker';
import { Database } from '../apps/server/src/storage/database';

const directory = new URL('./fixtures/batrace/history/', import.meta.url);
const bytes = readFileSync(new URL('responses.json.gz', directory));
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
if (manifest.version !== 1 || hash(bytes) !== manifest.sha256)
  throw new Error('Title history fixture checksum or version is invalid');
const fixture = JSON.parse(
  gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'),
) as TitleHistoryFixture;
const expected = JSON.parse(readFileSync(new URL('expected.json', directory), 'utf8'));
const report = summarizeTitleHistory(fixture);

describe('captured historical BATrace title coverage', () => {
  it('accounts for every historical match and preserves request bodies without private headers', () => {
    expect(fixture.version).toBe(1);
    expect(fixture.capturedAt).toBe(manifest.capturedAt);
    expect(fixture.responses).toHaveLength(manifest.responses);
    expect(fixture.requests).toHaveLength(manifest.requests);
    expect(fixture.failures).toEqual(manifest.failures);
    expect(fixture.source.historyMatches).toBe(fixture.matches.length + fixture.source.withoutFid);
    expect(fixture.matches).toHaveLength(fixture.responses.length + fixture.failures.length);
    expect(fixture.responses.filter((r) => r.source === 'cache')).toHaveLength(manifest.cached);
    expect(fixture.responses.filter((r) => r.source === 'network')).toHaveLength(manifest.fetched);
    for (const request of fixture.requests) {
      expect(request.path).toMatch(/^\/(?:api\/match\?matchid=|match\/)\d+$/);
      expect(request).not.toHaveProperty('headers');
      if (request.status !== null) expect(typeof request.body).toBe('string');
    }
  });

  it('matches all 28 frequency baselines and every player candidate, award order, and evidence parameter', () => {
    const golden = {
      ...report,
      matches: report.matches.map(({ awards, ...match }) => ({
        ...match,
        ...(awards ? { awardsSha256: hash(JSON.stringify(awards)) } : {}),
      })),
    };
    expect(Object.keys(report.counts)).toHaveLength(28);
    expect(report.scope).toEqual(manifest.scope);
    expect(golden).toEqual(expected);
  });

  it('rejects duplicate FIDs instead of inflating occurrence counts', () => {
    expect(() =>
      summarizeTitleHistory({ ...fixture, matches: [...fixture.matches, fixture.matches[0]!] }),
    ).toThrow(/duplicate FIDs/);
    expect(() =>
      summarizeTitleHistory({
        ...fixture,
        responses: [...fixture.responses, fixture.responses[0]!],
      }),
    ).toThrow(/duplicate FIDs/);
  });

  it.each(fixture.responses)(
    'replays match $id through the offline tracker and historical list',
    async (response) => {
      const entry = fixture.matches.find((match) => match.id === response.id)!;
      const awards = report.matches.find((match) => match.id === response.id)!.awards!;
      const titles = Object.fromEntries(
        Object.entries(awards).map(([id, award]) => [id, award.titles]),
      );
      const db = new Database(':memory:');
      const fetchImpl = vi.fn<typeof fetch>();
      const client = new BatraceClient(db, { fetch: fetchImpl, offline: true }, '4.3.0');
      try {
        const match = normalizeMatch(response.value, {
          id: entry.id,
          localId: entry.localPlayerId,
          now: response.at,
        });
        match.winnerTeamId ??= entry.winnerTeamId;
        delete match.titles;
        db.saveMatch(match);
        db.saveCache('match:' + entry.id, response.value, 1, response.at);
        const tracker = new TrackerService(db, client, new Analyzer(client, db));
        expect(tracker.list()[0]!.titles).toEqual(titles);
        expect((await tracker.detail(entry.id, true)).titles).toEqual(titles);
        expect(db.match(entry.id)!.titles).toBeUndefined();
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        await client.close();
        db.close();
      }
    },
  );

  const requestedIds = [
    ...new Set(fixture.requests.map((request) => /\d+$/.exec(request.path)![0])),
  ];
  it.each(requestedIds)(
    'replays recorded HTTP responses and fallbacks for match %s',
    async (id) => {
      const requests = fixture.requests.filter(
        (request) => request.path.endsWith('=' + id) || request.path === '/match/' + id,
      );
      let index = 0;
      const fetchImpl = vi.fn<typeof fetch>(async (url) => {
        const record = requests[index++];
        if (!record) throw new Error('Unrecorded HTTP request');
        expect(new URL(String(url)).pathname + new URL(String(url)).search).toBe(record.path);
        if (record.status === null) throw new Error(record.error);
        return new Response(record.body, {
          status: record.status,
          headers: record.contentType ? { 'content-type': record.contentType } : {},
        });
      });
      const db = new Database(':memory:');
      const client = new BatraceClient(db, { fetch: fetchImpl }, '4.3.0', 0);
      try {
        const response = fixture.responses.find((response) => response.id === id);
        if (response) {
          expect(await client.match(id, true)).toMatchObject({
            source: 'network',
            value: response.value,
          });
          expect(db.cache('match:' + id, true)!.value).toEqual(response.value);
        } else {
          await expect(client.match(id, true)).rejects.toThrow(
            fixture.failures.find((failure) => failure.id === id)!.error,
          );
          expect(db.cache('match:' + id, true)).toBeNull();
        }
        expect(fetchImpl).toHaveBeenCalledTimes(requests.length);
      } finally {
        await client.close();
        db.close();
      }
    },
  );
});
