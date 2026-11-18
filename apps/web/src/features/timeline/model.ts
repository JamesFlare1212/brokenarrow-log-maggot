import type { TimelineMoment, TimelinePoint, TimelineSortie } from '@ba/contracts';
import type { useI18n } from '@/hooks/useI18n';

export type Moment = TimelineMoment & { title: string };
export type Point = TimelinePoint;
export type Translate = ReturnType<typeof useI18n>['t'];

export function clock(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export function presentMoment(moment: TimelineMoment, t: Translate): Moment {
  return {
    ...moment,
    title: t(`timeline.event.${moment.eventType}`),
    unit:
      moment.playerId === null
        ? t('timeline.units', { count: moment.sorties.length })
        : moment.unit,
    player:
      moment.playerId === null
        ? t(moment.team === 0 ? 'timeline.alpha' : 'timeline.bravo')
        : moment.player,
  };
}

export function markerLabels(moments: Moment[], t: Translate): string[] {
  const first = moments[0];
  if (!first) return [];
  if (moments.length === 1) {
    if (first.playerId === null) return [t('timeline.casualties', { count: first.sorties.length })];
    if (first.unit.startsWith('Unit #')) return [first.unit.replace('Unit ', '')];
    return [first.unit.split(/\s+/)[0]!];
  }
  const counts = new Map<Moment['kind'], number>();
  for (const moment of moments) counts.set(moment.kind, (counts.get(moment.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) =>
    t('timeline.clusterKind', { kind: t(`timeline.kind.${kind}`), count }),
  );
}

export function clusterMoments(
  moments: Moment[],
  start: number,
  end: number,
  width: number,
  gap = 52,
  measureWidth?: (moments: Moment[]) => number,
) {
  if (end <= start || width <= 0) return [];
  const positioned = moments
    .filter((moment) => moment.end >= start && moment.start <= end)
    .map((moment) => ({
      moment,
      position: Math.max(start, Math.min(end, (moment.start + moment.end) / 2)),
    }))
    .sort((a, b) => a.position - b.position);
  // Keep measured labels inside the rail, then recheck collisions after each merge.
  const center = (positions: number[], items: Moment[]) => {
    const percent =
      ((positions.reduce((sum, value) => sum + value, 0) / positions.length - start) /
        (end - start)) *
      100;
    const inset = Math.min(50, ((measureWidth?.(items) ?? 0) / width) * 50);
    return Math.max(inset, Math.min(100 - inset, percent));
  };
  const groups: { moments: Moment[]; positions: number[]; percent: number }[] = [];
  for (const item of positioned) {
    let group = {
      moments: [item.moment],
      positions: [item.position],
      percent: center([item.position], [item.moment]),
    };
    while (groups.length) {
      const previous = groups.at(-1)!;
      const minimum =
        gap + ((measureWidth?.(previous.moments) ?? 0) + (measureWidth?.(group.moments) ?? 0)) / 2;
      if (((group.percent - previous.percent) / 100) * width >= minimum) break;
      groups.pop();
      const positions = [...previous.positions, ...group.positions];
      const items = [...previous.moments, ...group.moments];
      group = { moments: items, positions, percent: center(positions, items) };
    }
    groups.push(group);
  }
  return groups.map(({ moments, percent }) => ({ moments, percent }));
}

export function niceScale(values: number[]) {
  let minimum = 0;
  let maximum = 0;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const rough = Math.max(1, (maximum - minimum) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const factor = [1, 2, 2.5, 5, 10].find((value) => value >= rough / magnitude) ?? 10;
  const step = Math.max(1, factor * magnitude);
  const lower = Math.floor(minimum / step) * step;
  const upper = Math.max(lower + step, Math.ceil(maximum / step) * step);
  const ticks: number[] = [];
  for (let value = lower; value <= upper; value += step) ticks.push(value);
  return { domain: [lower, upper] as [number, number], ticks };
}

export function minuteBuckets(points: Point[]) {
  return points.slice(1).map((point, index) => ({
    ...point,
    start: points[index]!.second,
    midpoint: (points[index]!.second + point.second) / 2,
  }));
}

export function timeWindow(duration: number, second: number, detail: boolean) {
  if (!detail || duration <= 300) return { start: 0, end: duration };
  const lastStart = Math.ceil((duration - 300) / 60) * 60;
  const start = Math.max(0, Math.min(Math.floor((second - 150) / 60) * 60, lastStart));
  return { start, end: Math.min(start + 300, duration) };
}

/** At an exact boundary, a selected interval belongs to the following loss bucket. */
export function pointAt(points: Point[], second: number, afterBoundary = false): Point {
  return (
    points.find((point) => (afterBoundary ? point.second > second : point.second >= second)) ??
    points.at(-1)!
  );
}

/** Reuse sampled frames; derive fractional event positions from the recorded sorties. */
export function frameAt(frames: Point[], second: number, sorties?: TimelineSortie[]): Point {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle]!.second <= second) low = middle;
    else high = middle - 1;
  }
  const frame = frames[low]!;
  if (!sorties || frame.second === second) return frame;
  const totals = (time: number) => {
    const teams = [0, 0];
    for (const unit of sorties) {
      if (!unit.refunded && unit.spawn <= time) teams[unit.team]! += unit.cost;
      if (unit.death !== null && unit.death <= time) teams[unit.team]! -= unit.lossCost;
    }
    return teams.map((value) => Math.max(0, Math.round(value)));
  };
  const [alpha = 0, bravo = 0] = totals(second);
  const [previousAlpha = 0, previousBravo = 0] = totals(Math.max(0, second - 60));
  return {
    second,
    alpha,
    bravo,
    difference: alpha - bravo,
    alphaChange: alpha - previousAlpha,
    bravoChange: bravo - previousBravo,
    alphaLoss: 0,
    bravoLoss: 0,
  };
}

export function timeTicks(duration: number, count = 6) {
  if (duration <= 0) return [0];
  const target = duration / (count - 1);
  const steps = [1, 2, 3, 5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1800, 3600];
  const step =
    target > 3600
      ? Math.round(target / 3600) * 3600
      : steps.reduce((best, value) =>
          Math.abs(value - target) < Math.abs(best - target) ? value : best,
        );
  const ticks = [0];
  for (let second = step; second < duration && ticks.length < count - 1; second += step) {
    if (duration - second >= step / 3) ticks.push(second);
  }
  ticks.push(duration);
  return ticks;
}
