import { describe, expect, it } from 'vitest';
import { loadSource } from '../docs/prototypes/timeline/source.mjs';
import { markerLabels } from '../docs/prototypes/timeline/marker-labels';
import {
  buildTimeline,
  clock,
  pointAt,
  timeWindow,
  minuteBuckets,
  niceScale,
  clusterMoments,
  type RawMatch,
} from '../docs/prototypes/timeline/model';

const source = loadSource();
const timeline = buildTimeline(source.match, source.catalog);

describe('real-data timeline prototype', () => {
  it('uses the checksum-verified recorded match and its complete roster', () => {
    expect(source.provenance.matchId).toBe('9485138');
    expect(source.match.MapId).toBe(3);
    expect(timeline.duration).toBe(1339);
    expect(timeline.players).toHaveLength(10);
    expect(
      Object.values(source.match.Data).flatMap((player) => Object.values(player.UnitData)),
    ).toHaveLength(401);
    expect(timeline.sorties).toHaveLength(400); // One recorded spawn is beyond the official duration.
    expect(timeline.players.find((player) => player.id === '75402')?.name).toBe('JamesFlare');
  });

  it('preserves the recorded unit identity and high-kill interval', () => {
    const moment = timeline.moments.find((moment) => moment.kind === 'highlight')!;
    expect(moment.unit).toBe('Ka-50 Akula');
    expect([moment.start, moment.end, moment.value]).toEqual([3, 93, 6]);
    expect(moment.sorties[0]?.player).toBe('9神来啦');
  });

  it('keeps event seconds, cursor snapshots, and minute buckets distinct', () => {
    const frame = timeline.frames[93]!;
    expect(frame.second).toBe(93);
    expect(frame.alpha).not.toBe(timeline.frames[120]!.alpha);
    expect(pointAt(timeline.points, 93).second).toBe(120);
  });

  it('agrees at every minute boundary and retains the final partial minute', () => {
    expect(timeline.points.at(-1)?.second).toBe(1339);
    expect(timeline.frames).toHaveLength(1340);
    for (const point of timeline.points) {
      const frame = timeline.frames[point.second]!;
      expect([frame.alpha, frame.bravo, frame.difference]).toEqual([
        point.alpha,
        point.bravo,
        point.difference,
      ]);
    }
  });

  it('calculates rolling 60-second changes instead of whole-match advantages', () => {
    for (const second of [93, 600, 1200, 1339]) {
      const frame = timeline.frames[second]!;
      expect(frame.alphaChange).toBe(frame.alpha - timeline.frames[second - 60]!.alpha);
      expect(frame.bravoChange).toBe(frame.bravo - timeline.frames[second - 60]!.bravo);
    }
  });

  it('calibrates estimated death values to each official player loss total', () => {
    for (const player of Object.values(source.match.Data)) {
      const total = timeline.sorties
        .filter((unit) => unit.playerId === String(player.Id) && unit.death !== null)
        .reduce((sum, unit) => sum + unit.lossCost, 0);
      expect(total).toBeCloseTo(player.LossesScore, 6);
    }
  });

  it('excludes refunded sorties from the field-value proxy and inferred highlights', () => {
    expect(timeline.sorties.some((unit) => unit.refunded)).toBe(true);
    expect(
      timeline.moments
        .filter((moment) => moment.kind === 'highlight')
        .every((moment) => moment.sorties.every((unit) => !unit.refunded)),
    ).toBe(true);
    for (const team of [0, 1]) {
      const expected = timeline.sorties
        .filter((unit) => unit.team === team && !unit.refunded)
        .reduce((sum, unit) => sum + unit.cost - (unit.death === null ? 0 : unit.lossCost), 0);
      expect(timeline.frames.at(-1)![team === 0 ? 'alpha' : 'bravo']).toBe(
        Math.max(0, Math.round(expected)),
      );
    }
  });

  it('derives loss peaks and their record lists from actual death timestamps', () => {
    const moment = timeline.moments.find((moment) => moment.id === 'peak:1')!;
    expect([moment.start, moment.end, moment.value, moment.sorties.length]).toEqual([
      1140, 1200, 2291, 14,
    ]);
    expect(moment.sorties.every((unit) => unit.death! > 1140 && unit.death! <= 1200)).toBe(true);
    expect(Math.round(moment.sorties.reduce((sum, unit) => sum + unit.lossCost, 0))).toBe(
      moment.value,
    );
  });

  it('marks recon deployment without fabricating a causal damage window', () => {
    const recon = timeline.moments.filter((moment) => moment.kind === 'recon');
    expect(recon.map((moment) => [moment.unit, moment.start, moment.end])).toEqual([
      ['Orion', 159, 159],
      ['RQ-4 Global Hawk', 486, 486],
    ]);
  });

  it('has finite, nonnegative field values and chronological event intervals', () => {
    expect(
      timeline.frames.every(
        (frame) =>
          Object.values(frame).every(Number.isFinite) && frame.alpha >= 0 && frame.bravo >= 0,
      ),
    ).toBe(true);
    expect(
      timeline.moments.every(
        (moment, index, moments) =>
          moment.start <= moment.end &&
          moment.end <= timeline.duration &&
          (index === 0 || moment.start >= moments[index - 1]!.start),
      ),
    ).toBe(true);
  });

  it('ignores missing or out-of-match spawn times instead of inventing events', () => {
    const match: RawMatch = {
      StartTime: 1000,
      TotalPlayTimeInSec: 120,
      MapId: 3,
      TeamMatchPoints: { Alpha: 0, Bravo: 0 },
      Data: {
        '1': {
          Id: 1,
          Name: 'Recorded player',
          TotalSpawnedUnitScore: 100,
          LossesScore: 0,
          UnitData: { missing: { Id: 1 }, outside: { Id: 1, SpawnTime: 2000 } },
        },
      },
    };
    const result = buildTimeline(match, { '1': { name: 'Unit', role: 'inf', cost: 50 } });
    expect(result.sorties).toHaveLength(0);
    expect(result.moments).toHaveLength(0);
    expect(result.frames.at(-1)?.alpha).toBe(0);
  });

  it('keeps zoom windows on minute boundaries and includes the selected second', () => {
    for (let second = 0; second <= timeline.duration; second++) {
      const window = timeWindow(timeline.duration, second, true);
      expect(window.start % 60).toBe(0);
      expect(window.end - window.start).toBeLessThanOrEqual(300);
      expect(second).toBeGreaterThanOrEqual(window.start);
      expect(second).toBeLessThanOrEqual(window.end);
    }
  });

  it('centers loss columns inside their actual intervals, including the partial tail', () => {
    const buckets = minuteBuckets(timeline.points);
    expect(buckets).toHaveLength(23);
    expect([buckets[0]!.start, buckets[0]!.midpoint, buckets[0]!.second]).toEqual([0, 30, 60]);
    expect([buckets.at(-1)!.start, buckets.at(-1)!.midpoint, buckets.at(-1)!.second]).toEqual([
      1320, 1329.5, 1339,
    ]);
  });

  it('retains the partial final minute when zooming at the end', () => {
    expect(timeWindow(1339, 1339, true)).toEqual({ start: 1080, end: 1339 });
    expect(timeWindow(1339, 1200, true)).toEqual({ start: 1020, end: 1320 });
  });

  it('keeps full and short-match windows intact', () => {
    expect(timeWindow(1339, 93, false)).toEqual({ start: 0, end: 1339 });
    expect(timeWindow(120, 93, true)).toEqual({ start: 0, end: 120 });
  });

  it('uses rounded scales with an explicit zero for signed metrics', () => {
    const scale = niceScale([-1875, 6570]);
    expect(scale.ticks).toEqual([-2500, 0, 2500, 5000, 7500]);
    expect(scale.domain).toEqual([-2500, 7500]);
  });

  it('keeps all values inside readable nondegenerate scales', () => {
    for (const values of [[0, 0], [657], [-11], [10245, 11730], [-1843, 4103]]) {
      const scale = niceScale(values);
      expect(scale.domain[0]).toBeLessThan(scale.domain[1]);
      expect(scale.domain[0]).toBeLessThanOrEqual(Math.min(...values));
      expect(scale.domain[1]).toBeGreaterThanOrEqual(Math.max(...values));
      expect(scale.ticks).toContain(0);
      expect(scale.ticks.every(Number.isFinite)).toBe(true);
    }
  });

  it('handles empty loss windows without invalid chart ticks', () => {
    expect(niceScale([])).toEqual({ domain: [0, 1], ticks: [0, 1] });
  });

  it('places interval markers at their midpoint without implying exact kill times', () => {
    const highlight = timeline.moments.find((moment) => moment.kind === 'highlight')!;
    const markers = clusterMoments([highlight], 0, timeline.duration, 794);
    expect(markers[0]!.percent).toBeCloseTo((48 / 1339) * 100, 8);
    expect(markers[0]!.moments[0]).toMatchObject({ start: 3, end: 93, value: 6 });
  });

  it('clusters nearby desktop markers without losing event identities', () => {
    const markers = clusterMoments(timeline.moments, 0, timeline.duration, 794);
    expect(markers.map((marker) => marker.moments.length)).toEqual([1, 1, 1, 2, 1]);
    expect(markers.flatMap((marker) => marker.moments.map((moment) => moment.id))).toEqual(
      timeline.moments.map((moment) => moment.id),
    );
  });

  it('adapts marker density to narrow charts while retaining all six events', () => {
    const markers = clusterMoments(timeline.moments, 0, timeline.duration, 262);
    expect(markers.map((marker) => marker.moments.length)).toEqual([2, 1, 2, 1]);
    expect(markers.every((marker) => marker.percent >= 0 && marker.percent <= 100)).toBe(true);
  });

  it('limits markers to the inspected time window', () => {
    const markers = clusterMoments(timeline.moments, 1020, 1320, 794);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.percent).toBe(50);
    expect(markers[0]!.moments[0]!.id).toBe('peak:1');
  });

  it('keeps empty and zero-width marker rails safe', () => {
    expect(clusterMoments([], 0, 1339, 400)).toEqual([]);
    expect(clusterMoments(timeline.moments, 0, 1339, 0)).toEqual([]);
    expect(clusterMoments(timeline.moments, 10, 10, 400)).toEqual([]);
  });

  it('identifies individual markers by recorded unit names or loss counts', () => {
    expect(timeline.moments.map((moment) => markerLabels([moment]))).toEqual([
      ['Ka-50'],
      ['Orion'],
      ['RQ-4'],
      ['4阵亡'],
      ['Patriot'],
      ['14阵亡'],
    ]);
  });

  it('reveals every category and count in mixed and same-category clusters', () => {
    expect(markerLabels(timeline.moments.slice(0, 3))).toEqual(['高光×1', '侦察×2']);
    expect(markerLabels(timeline.moments.slice(3, 5))).toEqual(['损失×2']);
  });

  it('keeps unknown unit IDs intact and empty labels safe', () => {
    expect(markerLabels([])).toEqual([]);
    expect(markerLabels([{ ...timeline.moments[0]!, unit: 'Unit #999' }])).toEqual(['#999']);
  });

  it('avoids measured-label collisions without losing events across chart widths', () => {
    const measure = (items: typeof timeline.moments) =>
      Math.max(44, ...markerLabels(items).map((label) => label.length * 14 + 18));
    for (let width = 180; width <= 1200; width += 7) {
      const markers = clusterMoments(timeline.moments, 0, timeline.duration, width, 4, measure);
      expect(markers.flatMap((marker) => marker.moments.map((moment) => moment.id))).toEqual(
        timeline.moments.map((moment) => moment.id),
      );
      markers.slice(1).forEach((marker, index) => {
        const previous = markers[index]!;
        expect(((marker.percent - previous.percent) * width) / 100).toBeGreaterThanOrEqual(
          (measure(marker.moments) + measure(previous.moments)) / 2 + 4 - 0.001,
        );
      });
    }
  });

  it('rechecks earlier groups when an aggregated label grows wider', () => {
    const moments = timeline.moments.slice(0, 3).map((moment, index) => ({
      ...moment,
      start: [20, 50, 70][index]!,
      end: [20, 50, 70][index]!,
    }));
    const markers = clusterMoments(moments, 0, 100, 100, 4, (items) =>
      items.length === 1 ? 20 : 80,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]!.moments).toHaveLength(3);
  });

  it('uses the following minute for an interval selected at its starting boundary', () => {
    expect(pointAt(timeline.points, 1140).second).toBe(1140);
    expect(pointAt(timeline.points, 1140, true)).toMatchObject({ second: 1200, bravoLoss: 2291 });
    expect(pointAt(timeline.points, 780, true).second).toBe(840);
  });

  it('keeps non-boundary and final-time samples valid when selecting interval starts', () => {
    expect(pointAt(timeline.points, 3, true).second).toBe(60);
    expect(pointAt(timeline.points, 1339, true).second).toBe(1339);
  });

  it('formats precise event time and the partial final minute', () => {
    expect(clock(93)).toBe('01:33');
    expect(clock(1339)).toBe('22:19');
    expect(clock(-1)).toBe('00:00');
  });
});
