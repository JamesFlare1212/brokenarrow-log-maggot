import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { MATCH_SCORE_LABEL_IDS, type MatchScoreLabel } from '@ba/contracts';
import {
  matchScoreLabels,
  normalizeMatch,
  comparisonMedals,
  withScoreLabelEvidence,
  emptyMatch,
  emptyPlayer,
  type TitleHistoryFixture,
  type MedalHistoryFixture,
} from '@ba/shared';
import { BatraceClient } from '../apps/server/src/network/client';
import { Database } from '../apps/server/src/storage/database';
import { TrackerService } from '../apps/server/src/players/tracker';
import { Analyzer } from '../apps/server/src/players/analyzer';

const directory = new URL('./fixtures/batrace/history/', import.meta.url);
const history = JSON.parse(
  gunzipSync(readFileSync(new URL('responses.json.gz', directory))).toString('utf8'),
) as TitleHistoryFixture;
const analyses = JSON.parse(
  gunzipSync(readFileSync(new URL('analyses.json.gz', directory))).toString('utf8'),
) as MedalHistoryFixture;
const id = '9227650';
const raw = history.responses.find((entry) => entry.id === id)!.value;
const analysis = analyses.responses.find((entry) => entry.id === id)!.value;
const completed = () => normalizeMatch(raw, { id, localId: '75402' });

describe('completed-match score labels', () => {
  it('attaches actual recorded combat, economy, objective, and allied-supply quantities', () => {
    const labels = withScoreLabelEvidence(
      completed(),
      {
        '75402': MATCH_SCORE_LABEL_IDS.map((id) => ({
          id,
          score: 100,
          threshold: 100,
        })),
      },
      analysis,
      raw,
    )['75402']!;
    const evidence = (id: string) => labels.find((label) => label.id === id)!.evidence;
    expect(evidence('destruction')).toEqual({ destructionValue: 6685, killed: 50 });
    expect(evidence('damage')).toEqual({ damageDealt: 1471, damageReceived: 767 });
    expect(evidence('dlRatio')).toEqual({
      destructionValue: 6685,
      lossValue: 4490,
      dlRatio: 6685 / 4490,
    });
    expect(evidence('efficiency')).toEqual({
      investment: 11575,
      refunded: 5315,
      destructionValue: 6685,
      roi: 0.19,
    });
    expect(evidence('objectives')).toEqual({ objectivesCaptured: 0 });
    expect(evidence('supply')).toEqual({ supplyProvided: 1170 });
  });

  it('does not infer missing supply support from an ID-only roster or personal supply consumption', () => {
    const labels: Record<string, MatchScoreLabel[]> = {
      '75402': [{ id: 'supply', score: 100, threshold: 100 }],
    };
    expect(
      withScoreLabelEvidence(completed(), labels, undefined, {
        matchInfo: { Data: { '75402': { Id: 75402 } } },
      })['75402']![0]!.evidence,
    ).toEqual({ supplyProvided: null });
    labels['75402']![0] = {
      ...labels['75402']![0]!,
      evidence: { supplyProvided: 1170 },
    };
    expect(withScoreLabelEvidence(completed(), labels)['75402']![0]!.evidence).toEqual({
      supplyProvided: 1170,
    });
  });
  it('shows only the two highest qualifying dimensions while preserving the upstream three-label comparison', () => {
    const match = completed();
    const value = structuredClone(analysis) as {
      mvpRanking: Array<{ playerId: number; breakdown: Record<string, number> }>;
    };
    const target = value.mvpRanking[0]!;
    for (const row of value.mvpRanking)
      for (const key of ['destruction', 'damage', 'dlRatio', 'efficiency', 'objectives', 'supply'])
        row.breakdown[key] = row === target ? 100 : 0;
    expect(
      matchScoreLabels(match, value)[String(target.playerId)]!.map((label) => label.id),
    ).toEqual(['destruction', 'damage']);
    expect(comparisonMedals(value)![String(target.playerId)]!.medals).toHaveLength(3);
  });

  it('limits saved global single-winner awards to two when analysis is no longer cached', async () => {
    const db = new Database(':memory:');
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new BatraceClient(db, { fetch, offline: true }, '4.3.0');
    try {
      const match = completed();
      match.scoreLabelRule = 'match-maximum-single';
      match.scoreLabels = {
        '75402': [
          { id: 'destruction', score: 100, threshold: 100 },
          { id: 'damage', score: 100, threshold: 100 },
          { id: 'efficiency', score: 100, threshold: 100 },
        ],
      };
      db.saveMatch(match);
      const result = new TrackerService(db, client, new Analyzer(client, db)).list()[0]!;
      expect(result.scoreLabels!['75402']!.map((label) => label.id)).toEqual([
        'destruction',
        'damage',
      ]);
      expect(db.match(match.id)!.scoreLabels!['75402']).toHaveLength(3);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      db.close();
    }
  });
  it('selects only one positive global maximum per dimension and resolves cross-team ties in analysis order', () => {
    const match = emptyMatch('1');
    match.endedAt = 1;
    match.durationSec = 600;
    match.players = Array.from({ length: 10 }, (_, index) => ({
      ...emptyPlayer(String(index + 1)),
      teamId: index < 5 ? (0 as const) : (1 as const),
    }));
    for (const dimension of [
      'destruction',
      'damage',
      'dlRatio',
      'efficiency',
      'objectives',
      'supply',
    ]) {
      const value = {
        matchId: 1,
        mvpRanking: match.players.map((player, index) => ({
          playerId: player.id,
          teamId: player.teamId,
          score: 10 - index,
          breakdown: { [dimension]: [100, 100, 99.9, 90, 0, 100, 100, 99.9, 90, 0][index] },
        })),
      };
      const actual = matchScoreLabels(match, value);
      expect(Object.keys(actual).filter((id) => actual[id]!.length)).toEqual(['1']);
      expect(
        Object.values(actual)
          .flat()
          .every((label) => label.score === label.threshold),
      ).toBe(true);
      expect(comparisonMedals(value)!['4']!.medals).toHaveLength(1);
      expect(actual['4']).toEqual([]);
      value.mvpRanking = [...value.mvpRanking.slice(5), ...value.mvpRanking.slice(0, 5)];
      const reordered = matchScoreLabels(match, value);
      expect(Object.keys(reordered).filter((id) => reordered[id]!.length)).toEqual(['6']);
      for (const player of value.mvpRanking)
        if (player.teamId === 1) player.breakdown[dimension] = 90;
      const higherOpponent = matchScoreLabels(match, value);
      expect(Object.keys(higherOpponent).filter((id) => higherOpponent[id]!.length)).toEqual(['1']);
      for (const player of value.mvpRanking) player.breakdown[dimension] = 0;
      expect(Object.values(matchScoreLabels(match, value)).flat()).toEqual([]);
    }
  });

  it('withholds older 90-percent and per-team awards until analysis can recompute the global winner', async () => {
    const db = new Database(':memory:');
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new BatraceClient(db, { fetch, offline: true }, '4.3.0');
    try {
      const match = completed();
      match.scoreLabels = { '75402': [{ id: 'damage', score: 95, threshold: 90 }] };
      const tracker = new TrackerService(db, client, new Analyzer(client, db));
      db.saveMatch(match);
      expect(tracker.list()[0]!.scoreLabels).toEqual({});
      match.scoreLabelRule = 'team-maximum';
      db.saveMatch(match);
      expect(tracker.list()[0]!.scoreLabels).toEqual({});
      db.saveCache('amatch:' + id, analysis, 1, 1);
      expect(tracker.list()[0]!.scoreLabels).toEqual(matchScoreLabels(match, analysis));
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      db.close();
    }
  });
  it('rejects live matches, missing duration, and mismatched analysis identities or teams', () => {
    expect(Object.keys(matchScoreLabels(completed(), analysis))).toHaveLength(10);
    expect(matchScoreLabels({ ...completed(), endedAt: null }, analysis)).toEqual({});
    expect(matchScoreLabels({ ...completed(), durationSec: null }, analysis)).toEqual({});
    expect(matchScoreLabels(completed(), { ...(analysis as object), matchId: '0' })).toEqual({});
    const mismatched = completed();
    mismatched.players[0]!.teamId = mismatched.players[0]!.teamId === 0 ? 1 : 0;
    expect(matchScoreLabels(mismatched, analysis)).toEqual({});
    expect(matchScoreLabels(completed(), {})).toEqual({});
  });

  it('backfills cached history and stale detail offline without changing saved records', async () => {
    const db = new Database(':memory:');
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new BatraceClient(db, { fetch, offline: true }, '4.3.0');
    try {
      const match = completed();
      db.saveMatch(match);
      db.saveCache('match:' + id, raw, 1, 1);
      db.saveCache('amatch:' + id, analysis, 1, 1);
      const tracker = new TrackerService(db, client, new Analyzer(client, db));
      const expected = matchScoreLabels(match, analysis, raw);
      expect(tracker.list()[0]!.scoreLabels).toEqual(expected);
      expect((await tracker.detail(id)).scoreLabels).toEqual(expected);
      expect(db.match(id)!.scoreLabels).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      db.close();
    }
  });

  it('keeps match facts and titles when the optional analysis service fails', async () => {
    const db = new Database(':memory:');
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response('Forbidden', { status: 403 }),
    );
    const client = new BatraceClient(db, { fetch }, '4.3.0');
    try {
      db.saveMatch(completed());
      db.saveCache('match:' + id, raw, 86400000);
      const match = await new TrackerService(db, client, new Analyzer(client, db)).detail(id);
      expect(match.players).toEqual(completed().players);
      expect(match.titles).toEqual(completed().titles);
      expect(match.scoreLabels).toEqual({});
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]![0])).toContain('/api/analysis/match?matchid=' + id);
    } finally {
      await client.close();
      db.close();
    }
  });

  it('forces both match and analysis refresh when the user explicitly refreshes detail', async () => {
    const db = new Database(':memory:');
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      Response.json(String(url).includes('/api/analysis/') ? analysis : raw),
    );
    const client = new BatraceClient(db, { fetch }, '4.3.0');
    try {
      db.saveMatch(completed());
      db.saveCache('match:' + id, raw, 86400000);
      db.saveCache('amatch:' + id, analysis, 86400000);
      const tracker = new TrackerService(db, client, new Analyzer(client, db));
      expect((await tracker.detail(id, true)).scoreLabels).toEqual(
        matchScoreLabels(completed(), analysis, raw),
      );
      expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        '/api/match',
        '/api/analysis/match',
      ]);
    } finally {
      await client.close();
      db.close();
    }
  });

  it('does not request analysis or return saved score labels for a live match', async () => {
    const db = new Database(':memory:');
    const liveRaw = structuredClone(raw) as { matchInfo: Record<string, unknown> };
    delete liveRaw.matchInfo.EndTime;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(liveRaw));
    const client = new BatraceClient(db, { fetch }, '4.3.0');
    try {
      const result = await new TrackerService(db, client, new Analyzer(client, db)).detail(id);
      expect(result.endedAt).toBeNull();
      expect(result.scoreLabels).toEqual({});
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      db.close();
    }
  });
});
