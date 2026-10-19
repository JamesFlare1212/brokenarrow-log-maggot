import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  comparisonMedals,
  compareTitleMedals,
  MEDAL_IDS,
  MEDAL_SOURCE,
  normalizeMatch,
  matchScoreLabels,
  type MedalHistoryFixture,
  type TitleHistoryFixture,
} from '@ba/shared';
import { BatraceClient } from '../apps/server/src/network/client';
import { Database } from '../apps/server/src/storage/database';
import { TrackerService } from '../apps/server/src/players/tracker';
import { Analyzer } from '../apps/server/src/players/analyzer';

const directory = new URL('./fixtures/batrace/history/', import.meta.url);
const readJson = (name: string) => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const historyBytes = readFileSync(new URL('responses.json.gz', directory));
const analysisBytes = readFileSync(new URL('analyses.json.gz', directory));
const manifest = readJson('medal-manifest.json');
if (
  manifest.version !== 1 ||
  hash(analysisBytes) !== manifest.sha256 ||
  hash(historyBytes) !== manifest.titleHistorySha256
)
  throw new Error('Medal history checksum or source history is invalid');
const history = JSON.parse(gunzipSync(historyBytes).toString('utf8')) as TitleHistoryFixture;
const analyses = JSON.parse(gunzipSync(analysisBytes).toString('utf8')) as MedalHistoryFixture;
const expected = readJson('medal-expected.json');
const reference = readJson('upstream-reference.json') as {
  upstream: MedalHistoryFixture['upstream'];
  matches: Array<{ id: string; sha256: string }>;
};
const report = compareTitleMedals(history, analyses);

function sample() {
  return {
    mvpRanking: Array.from({ length: 10 }, (_, index) => ({
      playerId: index + 1,
      teamId: index < 5 ? 0 : 1,
      score: 50,
      breakdown: Object.fromEntries(MEDAL_IDS.map((id) => [id, 0])),
    })),
  };
}

describe('upstream six-dimension medal comparison', () => {
  it('uses team-relative 90% thresholds, includes ties, and excludes a zero-valued dimension', () => {
    const value = sample();
    for (const [index, score] of [
      [0, 100],
      [1, 90],
      [2, 89.999],
      [5, 50],
      [6, 45],
      [7, 44.999],
    ] as const)
      value.mvpRanking[index]!.breakdown.destruction = score;
    const result = comparisonMedals(value)!;
    expect(
      Object.entries(result)
        .filter(([, award]) => award.candidates.length)
        .map(([id]) => id),
    ).toEqual(['1', '2', '6', '7']);
    expect(result['2']!.candidates).toEqual([{ id: 'destruction', score: 90, threshold: 90 }]);
    expect(result['7']!.candidates).toEqual([{ id: 'destruction', score: 45, threshold: 45 }]);
    expect(
      Object.values(result)
        .flatMap((award) => award.candidates)
        .every((medal) => medal.id === 'destruction'),
    ).toBe(true);
  });

  it('keeps every qualifying medal but shows only three, using upstream definition order on score ties', () => {
    const value = sample();
    value.mvpRanking[0]!.breakdown = Object.fromEntries(MEDAL_IDS.map((id) => [id, 100]));
    const award = comparisonMedals(value)!['1']!;
    expect(award.candidates.map((medal) => medal.id)).toEqual(MEDAL_IDS);
    expect(award.medals.map((medal) => medal.id)).toEqual(['destruction', 'damage', 'dlRatio']);
    value.mvpRanking[0]!.breakdown.supply = 101;
    expect(comparisonMedals(value)!['1']!.medals[0]!.id).toBe('supply');
  });

  it('rejects incomplete and duplicate analysis rosters', () => {
    expect(comparisonMedals({})).toBeNull();
    const value = sample();
    value.mvpRanking[1]!.playerId = value.mvpRanking[0]!.playerId;
    expect(comparisonMedals(value)).toBeNull();
    expect(comparisonMedals({ mvpRanking: sample().mvpRanking.slice(0, 9) })).toBeNull();
  });

  it('checks provenance, every frequency and co-occurrence, and per-player award order against the frozen baseline', () => {
    expect(analyses.upstream).toMatchObject(MEDAL_SOURCE);
    expect(analyses.upstream).toEqual(reference.upstream);
    expect(analyses.titleHistorySha256).toBe(hash(historyBytes));
    expect(analyses.responses).toHaveLength(manifest.responses);
    expect(analyses.requests).toHaveLength(manifest.requests);
    expect(analyses.failures).toEqual(manifest.failures);
    expect(report.scope).toEqual(manifest.scope);
    expect(report.scoreLabels.rule).toBe('match-maximum-single');
    expect(
      Object.values(report.scoreLabels.counts).every(
        (count) => count.candidates <= report.scope.compared,
      ),
    ).toBe(true);
    expect({
      ...report,
      matches: report.matches.map(({ awards, scoreLabels, ...match }) => ({
        ...match,
        ...(awards ? { awardsSha256: hash(JSON.stringify(awards)) } : {}),
        ...(scoreLabels ? { scoreLabelsSha256: hash(JSON.stringify(scoreLabels)) } : {}),
      })),
    }).toEqual(expected);
  });

  it('compares only matching rosters and excludes missing analysis from both systems', () => {
    const missing = compareTitleMedals(history, {
      ...analyses,
      responses: analyses.responses.slice(1),
    });
    expect(missing.scope).toMatchObject({ compared: report.scope.compared - 1, unavailable: 1 });
    const wrong = structuredClone(analyses);
    wrong.responses[0]!.value = { ...(wrong.responses[0]!.value as object), matchId: '0' };
    expect(compareTitleMedals(history, wrong).scope).toMatchObject({
      compared: report.scope.compared - 1,
      incomplete: 1,
    });
    expect(() =>
      compareTitleMedals(history, {
        ...analyses,
        responses: [...analyses.responses, analyses.responses[0]!],
      }),
    ).toThrow(/duplicate FIDs/);
  });

  it.each(analyses.responses)(
    'replays analysis $id offline and matches the pinned upstream function output',
    async (response) => {
      const awards = comparisonMedals(response.value)!;
      const normalized = Object.fromEntries(
        Object.entries(awards)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([id, award]) => [
            id,
            {
              candidates: award.candidates.map(({ id, score }) => ({ id, score })),
              medals: award.medals.map(({ id, score }) => ({ id, score })),
            },
          ]),
      );
      expect(hash(JSON.stringify(normalized))).toBe(
        reference.matches.find((entry) => entry.id === response.id)!.sha256,
      );
      const requests = analyses.requests.filter(
        (request) => request.path === '/api/analysis/match?matchid=' + response.id,
      );
      let index = 0;
      const fetchImpl = vi.fn<typeof fetch>(async (url) => {
        const record = requests[index++]!;
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
        expect(await client.analysisMatch(response.id)).toMatchObject({
          source: 'network',
          value: response.value,
        });
        expect(await client.analysisMatch(response.id)).toMatchObject({
          source: 'cache',
          value: response.value,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(requests.length);
        const rawMatch = history.responses.find((match) => match.id === response.id)!;
        const entry = history.matches.find((match) => match.id === response.id)!;
        const match = normalizeMatch(rawMatch.value, {
          id: response.id,
          localId: entry.localPlayerId,
        });
        db.saveMatch(match);
        db.saveCache('match:' + response.id, rawMatch.value, 86400000);
        const tracker = new TrackerService(db, client, new Analyzer(client, db));
        const labels = matchScoreLabels(match, response.value, rawMatch.value);
        expect(labels).toEqual(
          report.matches.find((entry) => entry.id === response.id)!.scoreLabels,
        );
        expect(
          Object.values(labels)
            .flat()
            .every((label) => label.score === label.threshold && label.score > 0),
        ).toBe(true);
        expect((await tracker.detail(response.id)).scoreLabels).toEqual(labels);
        expect(tracker.list()[0]!.scoreLabels).toEqual(labels);
        expect(db.match(response.id)!.scoreLabels).toEqual(labels);
        expect(Object.values(labels).every((list) => list.length <= 2)).toBe(true);
        for (const dimension of MEDAL_IDS)
          expect(
            Object.values(labels).filter((list) => list.some((label) => label.id === dimension))
              .length,
          ).toBeLessThanOrEqual(1);
        expect(fetchImpl).toHaveBeenCalledTimes(requests.length);
      } finally {
        await client.close();
        db.close();
      }
    },
  );
});
