import { describe, expect, it } from 'vitest';
import { buildMatchTimeline, object } from '@ba/shared';
import type { TimelineData } from '@ba/contracts';
import { recordedTimelineMatch } from './timeline-fixture';

const recorded = recordedTimelineMatch();
const ready = (raw: unknown): TimelineData => {
  const result = buildMatchTimeline(raw);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(result.reason);
  return result.data;
};
const timeline = ready(recorded.value);
const rawPlayers = Object.values(object(object(object(recorded.value).matchInfo).Data));
function match(units: Record<string, unknown> = { first: { Id: 99999, SpawnTime: 1001 } }) {
  return {
    StartTime: 1000,
    TotalPlayTimeInSec: 120,
    Data: {
      '1': {
        Id: 1,
        Name: 'Recorded player',
        TotalSpawnedUnitScore: 600,
        LossesScore: 300,
        UnitData: units,
      },
    },
  };
}

function fieldAt(data: TimelineData, second: number, team: number) {
  return Math.max(
    0,
    Math.round(
      data.sorties.reduce(
        (sum, unit) =>
          sum +
          (unit.team === team && !unit.refunded && unit.spawn <= second ? unit.cost : 0) -
          (unit.team === team && unit.death !== null && unit.death <= second ? unit.lossCost : 0),
        0,
      ),
    ),
  );
}

describe('production timeline recorded match 9485138', () => {
  it('retains the roster and 400 bounded sorties from 401 recorded deployments', () => {
    expect(timeline.duration).toBe(1339);
    expect(timeline.players).toHaveLength(10);
    expect(
      rawPlayers.flatMap((player) => Object.values(object(object(player).UnitData))),
    ).toHaveLength(401);
    expect(timeline.sorties).toHaveLength(400);
    expect(timeline.players.find((player) => player.id === '75402')).toEqual({
      id: '75402',
      name: 'JamesFlare',
      team: 0,
    });
  });

  it('preserves the recorded high-kill sortie without inventing kill timestamps', () => {
    expect(timeline.moments.find((moment) => moment.kind === 'highlight')).toMatchObject({
      eventType: 'short-multikill',
      unit: 'Ka-50 Akula',
      player: '9神来啦',
      start: 3,
      end: 93,
      value: 6,
    });
    expect(timeline.moments).toHaveLength(6);
    expect(timeline.moments.every((moment) => !('title' in moment))).toBe(true);
  });

  it('matches an independent exact-second oracle at every second', () => {
    expect(timeline.frames).toHaveLength(1340);
    for (const frame of timeline.frames) {
      expect(frame.alpha).toBe(fieldAt(timeline, frame.second, 0));
      expect(frame.bravo).toBe(fieldAt(timeline, frame.second, 1));
      expect(frame.difference).toBe(frame.alpha - frame.bravo);
      if (frame.second >= 60) {
        expect(frame.alphaChange).toBe(frame.alpha - timeline.frames[frame.second - 60]!.alpha);
        expect(frame.bravoChange).toBe(frame.bravo - timeline.frames[frame.second - 60]!.bravo);
      }
      expect(frame.alphaLoss + frame.bravoLoss).toBe(0);
    }
    expect(timeline.frames[93]!.alpha).not.toBe(timeline.frames[120]!.alpha);
  });

  it('keeps bucket-end losses separate with the exact final partial minute', () => {
    expect(timeline.points).toHaveLength(24);
    expect(timeline.points.at(-1)!.second).toBe(1339);
    for (const [index, point] of timeline.points.entries()) {
      expect(point.alpha).toBe(timeline.frames[point.second]!.alpha);
      expect(point.bravo).toBe(timeline.frames[point.second]!.bravo);
      for (const side of [0, 1]) {
        const expected = timeline.sorties
          .filter(
            (unit) =>
              unit.team === side &&
              unit.death !== null &&
              unit.death > (timeline.points[index - 1]?.second ?? 0) &&
              unit.death <= point.second,
          )
          .reduce((sum, unit) => sum + unit.lossCost, 0);
        expect(point[side === 0 ? 'alphaLoss' : 'bravoLoss']).toBe(Math.round(expected));
      }
    }
  });

  it('calibrates losses to official per-player totals without redistributing refunded deployments', () => {
    for (const raw of rawPlayers) {
      const player = object(raw);
      const dead = timeline.sorties.filter(
        (unit) => unit.playerId === String(player.Id) && unit.death !== null,
      );
      expect(dead.reduce((sum, unit) => sum + unit.lossCost, 0)).toBeCloseTo(
        player.LossesScore as number,
        6,
      );
    }
    expect(timeline.sorties.some((unit) => unit.refunded)).toBe(true);
    expect(
      timeline.moments
        .filter((moment) => moment.kind === 'highlight')
        .every((moment) => moment.sorties.every((unit) => !unit.refunded)),
    ).toBe(true);
    const deployed = timeline.sorties
      .filter((unit) => unit.playerId === '554897')
      .reduce((sum, unit) => sum + unit.cost, 0);
    expect(deployed).toBeLessThan(6460);
  });

  it('retains factual loss peaks, rapid deaths, and deployment-only recon events', () => {
    expect(timeline.moments.find((moment) => moment.id === 'peak:1')).toMatchObject({
      eventType: 'loss-peak',
      start: 1140,
      end: 1200,
      value: 2291,
      unit: '',
    });
    expect(timeline.moments.find((moment) => moment.id === 'peak:1')!.sorties).toHaveLength(14);
    expect(timeline.moments.find((moment) => moment.eventType === 'rapid-death')!.unit).toContain(
      'Patriot',
    );
    expect(
      timeline.moments
        .filter((moment) => moment.kind === 'recon')
        .map((moment) => [moment.eventType, moment.unit, moment.start, moment.end]),
    ).toEqual([
      ['recon-deployment', 'Orion', 159, 159],
      ['recon-deployment', 'RQ-4 Global Hawk', 486, 486],
    ]);
  });
});

describe('defensive timeline input validation', () => {
  it.each([
    undefined,
    null,
    [],
    {},
    { matchInfo: null },
    { matchInfo: { Data: '1=' } },
    { Data: {} },
  ])('does not fabricate a chart from missing data (%j)', (raw) => {
    expect(buildMatchTimeline(raw)).toEqual({
      status: 'unavailable',
      reason: 'missing-unit-data',
      data: null,
    });
  });

  it.each([undefined, null, NaN, Infinity, -1, 0, 86401, 1e100, '120'])(
    'rejects invalid or zero durations (%s)',
    (duration) => {
      expect(buildMatchTimeline({ ...match(), TotalPlayTimeInSec: duration })).toMatchObject({
        status: 'unavailable',
        reason: 'invalid-time',
        data: null,
      });
    },
  );

  it.each([undefined, null, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER, '1000'])(
    'requires a finite start timestamp (%s)',
    (start) => {
      expect(buildMatchTimeline({ ...match(), StartTime: start })).toMatchObject({
        reason: 'invalid-time',
      });
    },
  );

  it.each([NaN, Infinity, 0, 1050, '1120'])(
    'rejects contradictory or malformed supplied end timestamps (%s)',
    (end) => {
      expect(buildMatchTimeline({ ...match(), EndTime: end })).toMatchObject({
        reason: 'invalid-time',
      });
    },
  );

  it('supports custom matches but explicitly rejects PvE', () => {
    expect(buildMatchTimeline({ ...match(), Type: 1 }).status).toBe('ready');
    for (const mode of [
      { mode: 'pve' },
      { scenario: 'Zombie Survival' },
      { scenario: 'PvE Mission' },
    ])
      expect(buildMatchTimeline({ ...match(), ...mode })).toMatchObject({
        reason: 'unsupported-mode',
      });
  });

  it.each([100, -1, 2, null, NaN, Infinity, [], {}, 'Spectators', 'invalid'])(
    'does not assign invalid or spectator teams to Alpha (%s)',
    (side) => {
      const raw = match();
      expect(
        buildMatchTimeline({ ...raw, Data: { 1: { ...raw.Data[1], TeamId: side } } }),
      ).toMatchObject({
        status: 'unavailable',
        reason: 'missing-unit-data',
      });
    },
  );

  it('keeps omitted protobuf Alpha and explicit Bravo while excluding spectators', () => {
    const raw = match();
    const data = ready({
      ...raw,
      Data: {
        1: raw.Data[1],
        2: { ...raw.Data[1], Id: 2, TeamId: 1 },
        3: { ...raw.Data[1], Id: 3, TeamId: 100 },
      },
    });
    expect(data.players.map((player) => player.team)).toEqual([0, 1]);
    expect(data.sorties.map((unit) => unit.team)).toEqual([0, 1]);
  });

  it.each([{}, [], null, undefined])('rejects missing unit records (%j)', (units) => {
    const raw = match();
    expect(
      buildMatchTimeline({ ...raw, Data: { 1: { ...raw.Data[1], UnitData: units } } }),
    ).toMatchObject({
      reason: 'missing-unit-data',
      data: null,
    });
  });

  it('rejects all-absent unit data even when official totals are omitted', () => {
    expect(
      buildMatchTimeline({ ...match(), Data: { 1: { Id: 1, Name: 'Player' } } }),
    ).toMatchObject({ reason: 'missing-unit-data', data: null });
  });

  it.each([
    {},
    { SpawnTime: NaN },
    { SpawnTime: Infinity },
    { SpawnTime: 999 },
    { SpawnTime: 1121 },
    { SpawnTime: 1001, DeathTime: 1000 },
    { SpawnTime: 1001, DeathTime: NaN },
    { SpawnTime: 1001, DeathTime: 1121 },
    { SpawnTime: 1001, DeathTime: null },
  ])('does not invent an interval for incomplete or invalid timestamps (%j)', (times) => {
    expect(buildMatchTimeline(match({ first: { Id: 99999, ...times } }))).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-time',
      data: null,
    });
  });

  it.each([
    { KilledCount: NaN },
    { KilledCount: Infinity },
    { KilledCount: -1 },
    { KilledCount: 1.5 },
    { TotalDamageDealt: null },
    { TotalDamageDealt: -1 },
    { TotalDamageDealt: Infinity },
    { WasRefunded: 'true' },
    { Id: {} },
  ])('rejects malformed unit values (%j)', (values) => {
    expect(
      buildMatchTimeline(match({ first: { Id: 99999, SpawnTime: 1001, ...values } })),
    ).toMatchObject({ status: 'unavailable', data: null });
  });

  it.each([NaN, Infinity, -1, '600', null, 1e100])(
    'does not coerce invalid official totals (%s)',
    (score) => {
      const raw = match();
      expect(
        buildMatchTimeline({
          ...raw,
          Data: { 1: { ...raw.Data[1], TotalSpawnedUnitScore: score } },
        }),
      ).toMatchObject({ reason: 'missing-unit-data', data: null });
    },
  );

  it('keeps valid sorties without clamping invalid spawns onto the match start', () => {
    const data = ready(
      match({ good: { Id: 99999, SpawnTime: 1001 }, bad: { Id: 99999, SpawnTime: 999 } }),
    );
    expect(data.sorties).toHaveLength(1);
    expect(data.sorties[0]).toMatchObject({ unit: 'Unit #99999', role: null, spawn: 1, cost: 300 });
    expect(data.frames[0]!.alpha).toBe(0);
    expect(data.frames[1]!.alpha).toBe(300);
  });

  it('excludes refunds from field values, loss buckets, and inferred kill intervals', () => {
    const data = ready(
      match({
        first: { Id: 99999, SpawnTime: 1001, DeathTime: 1010, WasRefunded: true, KilledCount: 10 },
      }),
    );
    expect(data.sorties[0]).toMatchObject({ refunded: true, death: null });
    expect(data.frames.every((point) => point.alpha === 0 && point.bravo === 0)).toBe(true);
    expect(data.points.every((point) => point.alphaLoss === 0)).toBe(true);
    expect(data.moments).toEqual([]);
  });

  it('uses inclusive bucket ends without duplicating losses at a boundary', () => {
    const data = ready(match({ first: { Id: 99999, SpawnTime: 1001, DeathTime: 1060 } }));
    expect(data.points.map((point) => point.alphaLoss)).toEqual([0, 300, 0]);
    expect(data.frames[59]!.alpha).toBe(600);
    expect(data.frames[60]!.alpha).toBe(300);
  });

  it('handles fractional times, rolling baselines, and the exact fractional final sample', () => {
    const data = ready({
      ...match({ first: { Id: 99999, SpawnTime: 1060.4, DeathTime: 1120.25 } }),
      TotalPlayTimeInSec: 120.5,
    });
    expect(data.frames).toHaveLength(122);
    expect(data.frames[60]!.alpha).toBe(0);
    expect(data.frames[61]!.alpha).toBe(600);
    expect(data.frames.at(-1)).toMatchObject({ second: 120.5, alpha: 300, alphaChange: -300 });
    expect(data.points.map((point) => point.second)).toEqual([0, 60, 120, 120.5]);
    expect(data.points.map((point) => point.alphaLoss)).toEqual([0, 0, 0, 300]);
  });

  it('handles subsecond matches without duplicate zero boundaries or nonfinite values', () => {
    const data = ready({
      ...match({ first: { Id: 99999, SpawnTime: 1000 } }),
      TotalPlayTimeInSec: 0.5,
    });
    expect(data.points.map((point) => point.second)).toEqual([0, 0.5]);
    expect(data.frames.every((point) => Object.values(point).every(Number.isFinite))).toBe(true);
  });

  it('finds the maximum inclusive 60-second burst with a sliding window', () => {
    const units = Object.fromEntries(
      [10, 20, 60, 70, 400].map((death, index) => [
        String(index),
        {
          Id: 99999,
          SpawnTime: 1001,
          DeathTime: 1000 + death,
          KilledCount: 1,
        },
      ]),
    );
    const raw = match(units);
    const data = ready({
      ...raw,
      TotalPlayTimeInSec: 600,
      Data: { 1: { ...raw.Data[1], LossesScore: 5000 } },
    });
    expect(data.moments.find((moment) => moment.eventType === 'loss-burst')).toMatchObject({
      start: 10,
      end: 70,
      value: 4000,
      unit: '',
    });
    expect(data.moments.some((moment) => moment.eventType === 'loss-peak')).toBe(false);
  });
});
