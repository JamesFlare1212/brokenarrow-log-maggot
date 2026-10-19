import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { MatchTitleId } from '@ba/contracts';
import { matchTitles, matchTitleAwards, normalizeMatch } from '@ba/shared';
import { awardTitles } from '../packages/shared/src/titles/engine';
import type { RawTitleMatch, RawTitlePlayer, UnitMap } from '../packages/shared/src/titles/types';
import { parseMatchPage } from '../apps/server/src/network/match-page';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { TrackerService } from '../apps/server/src/players/tracker';

function rawMatch(
  overrides: Record<string, Partial<RawTitlePlayer>> = {},
  duration = 1200,
): RawTitleMatch {
  return {
    StartTime: 1000,
    TotalPlayTimeInSec: duration,
    Data: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => {
        const id = String(i + 1);
        return [
          id,
          {
            Id: id,
            Name: `Player ${id}`,
            TeamId: i < 5 ? 0 : 1,
            DestructionScore: 1000,
            LossesScore: 1000,
            Destruction: 10,
            Losses: 10,
            DamageDealt: 5000,
            ObjectivesCaptured: 1,
            TotalSpawnedUnitScore: 10000,
            ...overrides[id],
          },
        ];
      }),
    ),
  };
}
const units = (n: number, extra = {}) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      String(i),
      {
        Id: 'test',
        SpawnTime: 1000,
        DeathTime: 1010,
        ...extra,
      },
    ]),
  );
const unitMap: UnitMap = { test: ['armor', 100], jet: ['jet', 3000], arty: ['arty', 100] };
const cases: Array<[MatchTitleId, Partial<RawTitlePlayer>]> = [
  ['reaper', { DestructionScore: 6000 }],
  ['untouched', { DestructionScore: 2000, LossesScore: 10 }],
  ['weightlifter', { DestructionScore: 2000, LossesScore: 2000, Destruction: 100, Losses: 100 }],
  ['atm', { DestructionScore: 100, LossesScore: 10000 }],
  ['scraper', { DestructionScore: 100, DamageDealt: 100000 }],
  ['killsteal', { DestructionScore: 2000, DamageDealt: 50 }],
  ['boxed', { UnitData: units(10) }],
  ['camper', { DestructionScore: 100, LossesScore: 10 }],
  ['landlord', { ObjectivesCaptured: 10 }],
  ['demolition', { UnitData: units(30, { BuildingDestroyedCount: 1 }) }],
  ['convoy', { SupplyCapturedByEnemy: 10000 }],
  ['bandit', { SupplyCaptured: 10000 }],
  ['canteen', { SupplyPointsConsumedByAllies: 12000 }],
  ['freeloader', { SupplyPointsConsumedFromAllies: 12000 }],
  ['glutton', { SupplyPointsConsumed: 20000 }],
  ['courier', { SupplyAirdropped: 11000 }],
  ['refund', { TotalRefundedUnitScore: 9000 }],
  ['spender', { DestructionScore: 100, TotalSpawnedUnitScore: 100000 }],
  ['traitor', { DestructionFriendlyFireCost: 10000 }],
  ['backstabbed', { LossesByFriendlyFireScore: 10000 }],
  ['crash', { UnitData: units(1, { Id: 'jet' }) }],
  ['artygod', { DestructionScore: 6000, UnitData: units(10, { Id: 'arty' }) }],
];
const recipients = (awards: ReturnType<typeof awardTitles>, id: MatchTitleId) =>
  Object.entries(awards)
    .filter(([, award]) => award.candidates.includes(id))
    .map(([playerId]) => playerId);

describe('single-match titles', () => {
  it('awards Big Eater for positive supply consumption rather than deployment value, with stable ties', () => {
    const raw = rawMatch({
      '1': { TotalSpawnedUnitScore: 1000000, SupplyPointsConsumed: 1 },
      '2': { SupplyPointsConsumed: 20000 },
      '6': { SupplyPointsConsumed: 20000 },
    });
    const awards = awardTitles(raw);
    expect(recipients(awards, 'glutton')).toEqual(['2']);
    expect(awards['2']!.titles.find((title) => title.id === 'glutton')?.params).toEqual({
      n: 20000,
    });
    expect(recipients(awardTitles(rawMatch()), 'glutton')).toEqual([]);
  });

  it('keeps Big Eater within the active eight-minute pool and the two-title display limit', () => {
    const raw = rawMatch(
      {
        '1': { SupplyPointsConsumed: 30000, Deserter: true },
        '2': { SupplyPointsConsumed: 20000 },
      },
      480,
    );
    expect(recipients(awardTitles(raw), 'glutton')).toEqual(['2']);
    expect(recipients(awardTitles({ ...raw, TotalPlayTimeInSec: 479 }), 'glutton')).toEqual([]);
    expect(recipients(awardTitles(raw, { excluded: new Set(['glutton']) }), 'glutton')).toEqual([]);
    const rare = awardTitles(
      rawMatch({
        '1': { SupplyPointsConsumed: 30000, SupplyAirdropped: 20000, DestructionScore: 10000 },
      }),
      { winnerTeam: 0 },
    );
    expect(rare['1']!.candidates).toContain('glutton');
    expect(rare['1']!.titles).toHaveLength(2);
    expect(rare['1']!.titles.some((title) => title.id === 'glutton')).toBe(false);
  });
  it.each(cases)('awards %s to the outstanding eligible player', (id, stats) => {
    const awards = awardTitles(rawMatch({ '1': stats }), { unitMap });
    expect(recipients(awards, id)).toEqual(['1']);
  });

  it('gives one award per category on ties and keeps the most extreme player', () => {
    const tied = awardTitles(
      rawMatch({ '1': { SupplyAirdropped: 20000 }, '2': { SupplyAirdropped: 20000 } }),
    );
    expect(recipients(tied, 'courier')).toEqual(['1']);
    const higher = awardTitles(
      rawMatch({ '1': { SupplyAirdropped: 20000 }, '2': { SupplyAirdropped: 20001 } }),
    );
    expect(recipients(higher, 'courier')).toEqual(['2']);
  });

  it('uses calibrated thresholds and the eight-minute eligibility boundary', () => {
    expect(
      recipients(awardTitles(rawMatch({ '1': { SupplyAirdropped: 9999 } })), 'courier'),
    ).toEqual([]);
    expect(
      recipients(awardTitles(rawMatch({ '1': { SupplyAirdropped: 10000 } }, 480)), 'courier'),
    ).toEqual(['1']);
    expect(
      recipients(awardTitles(rawMatch({ '1': { SupplyAirdropped: 10000 } }, 479)), 'courier'),
    ).toEqual([]);
  });

  it('keeps friendly fire and captured convoys eligible even in short matches and for absent players', () => {
    const awards = awardTitles(
      rawMatch(
        {
          '1': {
            Deserter: true,
            DestructionFriendlyFireCost: 500,
            SupplyCapturedByEnemy: 10000,
            LossesByFriendlyFireScore: 500,
            SupplyAirdropped: 20000,
          },
        },
        300,
      ),
    );
    for (const id of ['traitor', 'convoy', 'backstabbed'] as const)
      expect(recipients(awards, id)).toEqual(['1']);
    expect(recipients(awards, 'courier')).toEqual([]);
    expect(awards['1']!.titles[0]!.id).toBe('deserter');
    expect(awards['1']!.titles).toHaveLength(2);
  });

  it('sorts rare performances before carry and displays at most two per player', () => {
    const awards = awardTitles(
      rawMatch({ '1': { DestructionScore: 10000, SupplyAirdropped: 20000 } }),
      { winnerTeam: 0 },
    );
    expect(awards['1']!.candidates).toContain('carry');
    expect(awards['1']!.candidates).toContain('reaper');
    expect(awards['1']!.titles).toHaveLength(2);
    expect(awards['1']!.titles.every((title) => title.id !== 'carry')).toBe(true);
  });

  it('assigns responsibility using net exchange, independent of objectives and rating', () => {
    const raw = rawMatch(
      {
        '1': { DestructionScore: 6000, ObjectivesCaptured: 0, OldRating: 1000, NewRating: 1010 },
        '2': { ObjectivesCaptured: 100, OldRating: 3000, NewRating: 3010 },
        '6': { DestructionScore: 100, LossesScore: 2000 },
      },
      300,
    );
    const awards = awardTitles(raw, { winnerTeam: 0 });
    expect(recipients(awards, 'carry')).toEqual(['1']);
    expect(recipients(awards, 'blame')).toEqual(['6']);
    expect(awards['1']!.titles[0]!.params).toEqual({ d: 6000, l: 1000, net: 5000 });
  });

  it('moves blame to absent losers and recognizes their teammate who cannot carry', () => {
    const awards = awardTitles(
      rawMatch({ '6': { DestructionScore: 7000 }, '7': { DestructionScore: 0, LossesScore: 0 } }),
      { winnerTeam: 0 },
    );
    expect(recipients(awards, 'blame')).toEqual([]);
    expect(recipients(awards, 'deserter')).toEqual(['7']);
    expect(awards['7']!.blame).toBe(true);
    expect(recipients(awards, 'tryhard')).toEqual(['6']);
    expect(recipients(awards, 'lonewolf')).toEqual(['6']);
  });

  it('identifies a winning passenger only when their negative net is last among active players', () => {
    const awards = awardTitles(
      rawMatch({ '1': { LossesScore: 5000 }, '2': { DestructionScore: 2000 } }),
      { winnerTeam: 0 },
    );
    expect(recipients(awards, 'passenger')).toEqual(['1']);
    expect(
      recipients(
        awardTitles(rawMatch({ '1': { LossesScore: 5000 }, '6': { LossesScore: 6000 } }), {
          winnerTeam: 0,
        }),
        'passenger',
      ),
    ).toEqual([]);
  });

  it('uses the deserter cutoff and early inactivity evidence without penalizing a late departure', () => {
    const awards = awardTitles(
      rawMatch({
        '1': { Deserter: true, UnitData: units(1, { SpawnTime: 2019, DeathTime: undefined }) },
        '2': { Deserter: true, UnitData: units(1, { SpawnTime: 2020, DeathTime: undefined }) },
        '3': {
          DestructionScore: 10,
          UnitData: units(1, { SpawnTime: 1400, DeathTime: undefined }),
        },
      }),
    );
    expect(recipients(awards, 'deserter')).toEqual(['1', '3']);
  });

  it('does not guess the winner, include spectators, or accept duplicate player IDs', () => {
    const raw = rawMatch({
      '1': { DestructionScore: 6000 },
      '10': { TeamId: 100, DestructionScore: 1000000 },
    });
    const awards = awardTitles(raw);
    expect(recipients(awards, 'carry')).toEqual([]);
    expect(recipients(awards, 'blame')).toEqual([]);
    expect(awards['10']).toBeUndefined();
    raw.Data!['2']!.Id = '1';
    expect(awardTitles(raw)).toEqual({});
  });
});

describe('title data integration', () => {
  const captured = parseMatchPage(
    readFileSync(new URL('./fixtures/batrace/match-9227650.html', import.meta.url), 'utf8'),
    '9227650',
  );
  it('uses explicit summary supply consumption and withholds Big Eater when any value is unknown', () => {
    const match = normalizeMatch(captured, { id: '9227650', localId: '75402' });
    const awards = matchTitleAwards(match);
    expect(
      Object.values(awards).filter((award) => award.candidates.includes('glutton')),
    ).toHaveLength(1);
    match.players[0]!.supplyPoints = null;
    expect(
      Object.values(matchTitleAwards(match)).some((award) => award.candidates.includes('glutton')),
    ).toBe(false);
  });

  it('calculates real captured titles and never assigns them to live or ID-only rosters', () => {
    const match = normalizeMatch(captured, { id: '9227650', localId: '75402' });
    expect(Object.values(match.titles!).flat().length).toBeGreaterThan(0);
    expect(matchTitles({ ...match, endedAt: null }, captured)).toEqual({});
    expect(
      matchTitles(match, {
        matchInfo: { Data: { '1': { Id: '1' }, '2': { Id: '2', TeamId: 1 } } },
      }),
    ).toEqual({});
    expect(
      matchTitles({
        ...match,
        players: match.players.map((p) => ({ ...p, destructionScore: null })),
      }),
    ).toEqual({});
  });

  it('backfills historical titles from the existing full response without network requests or database mutation', async () => {
    const db = new Database(':memory:');
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new BatraceClient(db, { offline: true, fetch }, '4.2.1');
    try {
      const match = normalizeMatch(captured, { id: '9227650', localId: '75402' });
      delete match.titles;
      db.saveMatch(match);
      db.saveCache('match:9227650', captured, 1, 1);
      const tracker = new TrackerService(db, client, new Analyzer(client, db));
      const result = tracker.list()[0]!;
      expect(result.titles).toEqual(matchTitles(match, captured));
      expect(db.match(match.id)!.titles).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
      expect((await tracker.detail(match.id)).titles).toEqual(result.titles);
    } finally {
      await client.close();
      db.close();
    }
  });
});
