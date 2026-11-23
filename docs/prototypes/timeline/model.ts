export type RawUnit = {
  Id?: number;
  SpawnTime?: number;
  DeathTime?: number;
  WasRefunded?: boolean;
  KilledCount?: number;
  TotalDamageDealt?: number;
};
export type RawPlayer = {
  Id: number;
  Name: string;
  TeamId?: number;
  TotalSpawnedUnitScore: number;
  LossesScore: number;
  UnitData: Record<string, RawUnit>;
};
export type RawMatch = {
  StartTime: number;
  TotalPlayTimeInSec: number;
  MapId: number;
  WinnerTeam?: number;
  TeamMatchPoints: { Alpha: number; Bravo: number };
  Data: Record<string, RawPlayer>;
};
export type UnitCatalog = Record<string, { name: string; role: string | null; cost: number }>;
export type Sortie = {
  id: string;
  playerId: string;
  player: string;
  team: number;
  unit: string;
  role: string | null;
  spawn: number;
  death: number | null;
  refunded: boolean;
  kills: number;
  damage: number;
  cost: number;
  lossCost: number;
};
export type Moment = {
  id: string;
  kind: 'highlight' | 'loss' | 'recon';
  title: string;
  team: number;
  playerId: string | null;
  player: string;
  start: number;
  end: number;
  value: number;
  unit: string;
  sorties: Sortie[];
  weight: number;
};
export type Point = {
  second: number;
  alpha: number;
  bravo: number;
  difference: number;
  alphaChange: number;
  bravoChange: number;
  alphaLoss: number;
  bravoLoss: number;
};

export function clock(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export function buildTimeline(match: RawMatch, catalog: UnitCatalog) {
  const duration = match.TotalPlayTimeInSec;
  const sorties: Sortie[] = [];
  for (const player of Object.values(match.Data)) {
    const records = Object.entries(player.UnitData);
    const base = (unit: RawUnit) => catalog[String(unit.Id)]?.cost || 100;
    const totalBase = records.reduce((sum, [, unit]) => sum + base(unit), 0);
    const deadBase = records.reduce(
      (sum, [, unit]) => sum + (unit.DeathTime && !unit.WasRefunded ? base(unit) : 0),
      0,
    );
    for (const [id, unit] of records) {
      if (!Number.isFinite(unit.SpawnTime)) continue;
      const spawn = Math.max(0, unit.SpawnTime! - match.StartTime);
      if (spawn > duration) continue;
      const rawDeath = unit.DeathTime ? unit.DeathTime - match.StartTime : null;
      const death =
        rawDeath !== null && rawDeath >= spawn && rawDeath <= duration && !unit.WasRefunded
          ? rawDeath
          : null;
      sorties.push({
        id: `${player.Id}:${id}`,
        playerId: String(player.Id),
        player: player.Name,
        team: player.TeamId ?? 0,
        unit: catalog[String(unit.Id)]?.name || `Unit #${unit.Id}`,
        role: catalog[String(unit.Id)]?.role ?? null,
        spawn,
        death,
        refunded: unit.WasRefunded ?? false,
        kills: unit.KilledCount ?? 0,
        damage: unit.TotalDamageDealt ?? 0,
        cost: (base(unit) * player.TotalSpawnedUnitScore) / (totalBase || 1),
        lossCost: (base(unit) * player.LossesScore) / (deadBase || 1),
      });
    }
  }

  // Samples are bucket-end values. The final partial minute is retained.
  const boundaries = [0];
  for (let second = 60; second < duration; second += 60) boundaries.push(second);
  boundaries.push(duration);
  const points: Point[] = boundaries.map((second, index) => {
    const previous = boundaries[index - 1] ?? 0;
    const field = [0, 0];
    const loss = [0, 0];
    for (const unit of sorties) {
      // Refund timestamps are unavailable: exclude those sorties from the proxy.
      if (!unit.refunded && unit.spawn <= second) field[unit.team]! += unit.cost;
      if (unit.death !== null && unit.death <= second) {
        field[unit.team]! -= unit.lossCost;
        if (unit.death > previous) loss[unit.team]! += unit.lossCost;
      }
    }
    const alpha = Math.max(0, Math.round(field[0]!));
    const bravo = Math.max(0, Math.round(field[1]!));
    return {
      second,
      alpha,
      bravo,
      difference: alpha - bravo,
      alphaChange: 0,
      bravoChange: 0,
      alphaLoss: Math.round(loss[0]!),
      bravoLoss: Math.round(loss[1]!),
    };
  });
  points.forEach((point, index) => {
    point.alphaChange = point.alpha - (points[index - 1]?.alpha ?? 0);
    point.bravoChange = point.bravo - (points[index - 1]?.bravo ?? 0);
  });

  const moments: Moment[] = [];
  const lifeLimits: Record<string, number> = {
    armor: 112,
    inf: 138,
    recon: 68,
    arty: 147,
    aa: 108,
    heli: 52,
    jet: 19,
  };
  for (const unit of sorties) {
    const end = unit.death ?? duration;
    // A refunded sortie has no reliable interval end; do not infer its kill window.
    if (!unit.refunded && unit.kills >= 5 && end - unit.spawn <= 120) {
      moments.push({
        id: `highlight:${unit.id}`,
        kind: 'highlight',
        title: '短时多杀',
        team: unit.team,
        playerId: unit.playerId,
        player: unit.player,
        start: unit.spawn,
        end,
        value: unit.kills,
        unit: unit.unit,
        sorties: [unit],
        weight: unit.kills * (1 + 60 / Math.max(20, end - unit.spawn)),
      });
    }
    if (
      unit.death !== null &&
      unit.kills === 0 &&
      unit.damage === 0 &&
      unit.cost >= 220 &&
      end - unit.spawn <= (lifeLimits[unit.role ?? ''] ?? 41)
    ) {
      moments.push({
        id: `loss:${unit.id}`,
        kind: 'loss',
        title: '快速阵亡',
        team: unit.team,
        playerId: unit.playerId,
        player: unit.player,
        start: unit.spawn,
        end,
        value: Math.round(unit.lossCost),
        unit: unit.unit,
        sorties: [unit],
        weight: unit.cost / 50,
      });
    }
  }
  for (const team of [0, 1]) {
    const dead = sorties
      .filter((s) => s.team === team && s.death !== null)
      .sort((a, b) => a.death! - b.death!);
    let best: Sortie[] = [];
    let bestValue = 0;
    for (let index = 0; index < dead.length; index++) {
      const window = dead.slice(index).filter((s) => s.death! <= dead[index]!.death! + 60);
      const value = window.reduce((sum, s) => sum + s.lossCost, 0);
      if (value > bestValue) {
        bestValue = value;
        best = window;
      }
    }
    const mean = dead.reduce((sum, s) => sum + s.lossCost, 0) / (duration / 60);
    if (bestValue >= 1800 && bestValue >= mean * 3 && best.length) {
      moments.push({
        id: `burst:${team}`,
        kind: 'loss',
        title: '集中损失',
        team,
        playerId: null,
        player: team === 0 ? 'Alpha' : 'Bravo',
        start: best[0]!.death!,
        end: best.at(-1)!.death!,
        value: Math.round(bestValue),
        unit: `${best.length} 个单位`,
        sorties: best,
        weight: bestValue / 100,
      });
    }
  }
  // Peak minutes are factual rankings, not a claim of an exceptional collapse.
  for (const team of [0, 1]) {
    const key = team === 0 ? 'alphaLoss' : 'bravoLoss';
    const peak = points
      .slice(1)
      .reduce((best, point) => (point[key] > best[key] ? point : best), points[1]!);
    const index = points.indexOf(peak);
    const start = points[index - 1]!.second;
    const units = sorties.filter(
      (s) => s.team === team && s.death !== null && s.death > start && s.death <= peak.second,
    );
    if (units.length && !moments.some((m) => m.id === `burst:${team}`)) {
      moments.push({
        id: `peak:${team}`,
        kind: 'loss',
        title: '分钟损失峰值',
        team,
        playerId: null,
        player: team === 0 ? 'Alpha' : 'Bravo',
        start,
        end: peak.second,
        value: peak[key],
        unit: `${units.length} 个单位`,
        sorties: units,
        weight: 100,
      });
    }
    const drone = sorties
      .filter(
        (s) =>
          s.team === team &&
          s.role === 'recon' &&
          /Orion|RQ-|MQ-|Global Hawk|Forpost|Korsar|Shadow/i.test(s.unit),
      )
      .sort((a, b) => a.spawn - b.spawn)[0];
    if (drone)
      moments.push({
        id: `recon:${team}`,
        kind: 'recon',
        title: '无人机部署',
        team,
        playerId: drone.playerId,
        player: drone.player,
        start: drone.spawn,
        end: drone.spawn,
        value: 1,
        unit: drone.unit,
        sorties: [drone],
        weight: 1,
      });
  }
  const chosen: Moment[] = moments.filter((m) => m.kind === 'recon');
  for (const kind of ['highlight', 'loss'] as const) {
    const seen = new Set<string>();
    for (const moment of moments
      .filter((m) => m.kind === kind)
      .sort((a, b) => b.weight - a.weight)) {
      const key = moment.playerId ?? `team:${moment.team}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chosen.push(moment);
      if (seen.size === (kind === 'highlight' ? 3 : 4)) break;
    }
  }
  // Exact-second snapshots keep event selection, cursor, and readouts synchronized.
  // The minute buckets remain a separate series for the losses histogram.
  const frames: Point[] = [];
  const deltas = Array.from({ length: duration + 1 }, () => [0, 0]);
  for (const unit of sorties) {
    if (!unit.refunded) deltas[Math.ceil(unit.spawn)]![unit.team]! += unit.cost;
    if (unit.death !== null) deltas[Math.ceil(unit.death)]![unit.team]! -= unit.lossCost;
  }
  const totals = [0, 0];
  for (let second = 0; second <= duration; second++) {
    totals[0]! += deltas[second]![0]!;
    totals[1]! += deltas[second]![1]!;
    const alpha = Math.max(0, Math.round(totals[0]!));
    const bravo = Math.max(0, Math.round(totals[1]!));
    const previous = frames[Math.max(0, second - 60)];
    frames.push({
      second,
      alpha,
      bravo,
      difference: alpha - bravo,
      alphaChange: alpha - (previous?.alpha ?? 0),
      bravoChange: bravo - (previous?.bravo ?? 0),
      alphaLoss: 0,
      bravoLoss: 0,
    });
  }
  return {
    duration,
    points,
    frames,
    sorties,
    moments: chosen.sort((a, b) => a.start - b.start),
    players: Object.values(match.Data).map((p) => ({
      id: String(p.Id),
      name: p.Name,
      team: p.TeamId ?? 0,
    })),
  };
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
  const groups: { moments: Moment[]; positions: number[]; percent: number }[] = [];
  for (const item of positioned) {
    let group = {
      moments: [item.moment],
      positions: [item.position],
      percent: ((item.position - start) / (end - start)) * 100,
    };
    while (groups.length) {
      const previous = groups.at(-1)!;
      const minimum =
        gap + ((measureWidth?.(previous.moments) ?? 0) + (measureWidth?.(group.moments) ?? 0)) / 2;
      if (((group.percent - previous.percent) / 100) * width >= minimum) break;
      groups.pop();
      const positions = [...previous.positions, ...group.positions];
      group = {
        moments: [...previous.moments, ...group.moments],
        positions,
        percent:
          ((positions.reduce((sum, value) => sum + value, 0) / positions.length - start) /
            (end - start)) *
          100,
      };
    }
    groups.push(group);
  }
  return groups.map(({ moments, percent }) => ({ moments, percent }));
}

export function niceScale(values: number[]) {
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
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

export type Timeline = ReturnType<typeof buildTimeline>;
// At an exact boundary, interval inspection can select the minute following its start.
export function pointAt(points: Point[], second: number, afterBoundary = false): Point {
  return (
    points.find((point) => (afterBoundary ? point.second > second : point.second >= second)) ??
    points.at(-1)!
  );
}
