import type {
  MatchTimelineResult,
  TimelineData,
  TimelineMoment,
  TimelinePlayer,
  TimelinePoint,
  TimelineSortie,
} from '@ba/contracts';
import model from '../titles/model.json';
import { modeFromScenario } from '../matches';
import { object } from '../values';
import { TIMELINE_UNIT_NAMES } from './unit-names';

export type TimelineBuildResult =
  | Pick<Extract<MatchTimelineResult, { status: 'ready' }>, 'status' | 'reason' | 'data'>
  | Pick<Extract<MatchTimelineResult, { status: 'unavailable' }>, 'status' | 'reason' | 'data'>;

// Bound allocation from untrusted durations; never silently truncate a match.
const MAX_DURATION = 24 * 60 * 60;
const MAX_PLAYERS = 100;
const MAX_SORTIES = 100_000;
const MAX_METRIC = 1_000_000_000_000;
const catalog: Record<string, (string | number | null)[]> = model.units;
const lifeLimits: Record<string, number> = {
  armor: 112,
  inf: 138,
  recon: 68,
  arty: 147,
  aa: 108,
  heli: 52,
  jet: 19,
};

function unavailable(reason: Extract<TimelineBuildResult, { status: 'unavailable' }>['reason']) {
  return { status: 'unavailable', reason, data: null } as const;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function timestamp(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - MAX_DURATION;
}
function metric(value: unknown): number | null {
  // BATrace protobuf JSON omits zero scalar fields; explicit malformed values are not zero.
  if (value === undefined) return 0;
  return finite(value) && value >= 0 && value <= MAX_METRIC ? value : null;
}
function identifier(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{1,32}$/.test(value)) return value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : null;
}

/**
 * Derive a timeline lazily from a raw BATrace match response (or its matchInfo).
 * Base catalog prices are calibrated to each player's official deployment/loss totals.
 * All identifiable deployments, including refunds and late records, remain in the cost
 * denominator: removing them would redistribute their cost onto other units. Only
 * bounded, timestamped sorties enter curves. No missing timestamps are synthesized.
 * Refunds have no return timestamp, so they enter neither the field proxy nor highlights.
 * The curve is an estimate, not live combat power. Kill counts describe a sortie's full
 * interval, and recon markers establish deployment only, never causal damage windows.
 */
export function buildMatchTimeline(raw: unknown): TimelineBuildResult {
  const wrapper = object(raw);
  const match = object('matchInfo' in wrapper ? wrapper.matchInfo : raw);
  if (
    match.mode === 'pve' ||
    modeFromScenario(typeof match.scenario === 'string' ? match.scenario : '') === 'pve'
  )
    return unavailable('unsupported-mode');
  const roster = Object.entries(object(match.Data));
  if (!roster.length || roster.length > MAX_PLAYERS) return unavailable('missing-unit-data');
  const start = match.StartTime;
  const duration = match.TotalPlayTimeInSec;
  if (
    !timestamp(start) ||
    !finite(duration) ||
    duration <= 0 ||
    duration > MAX_DURATION ||
    (match.EndTime !== undefined && (!timestamp(match.EndTime) || match.EndTime < start + duration))
  )
    return unavailable('invalid-time');

  const sorties: TimelineSortie[] = [];
  const players: TimelinePlayer[] = [];
  const seen = new Set<string>();
  let recordCount = 0;
  let invalidTime = false;
  for (const [key, value] of roster) {
    const player = object(value);
    // Omitted TeamId is Alpha in protobuf JSON, not an unknown/spectator team.
    const side =
      player.TeamId === undefined || [0, '0', 'Alpha'].includes(player.TeamId as string | number)
        ? 0
        : [1, '1', 'Bravo'].includes(player.TeamId as string | number)
          ? 1
          : null;
    const id = identifier(player.Id === undefined ? key : player.Id);
    if ((side !== 0 && side !== 1) || id === null || seen.has(id)) continue;
    seen.add(id);
    const name = typeof player.Name === 'string' && player.Name ? player.Name : id;
    const spawned = metric(player.TotalSpawnedUnitScore);
    const losses = metric(player.LossesScore);
    if (spawned === null || losses === null) return unavailable('missing-unit-data');
    const records = Object.entries(object(player.UnitData));
    // A positive official total with no unit records cannot be reconstructed from summaries.
    if (!records.length && (spawned > 0 || losses > 0)) return unavailable('missing-unit-data');
    recordCount += records.length;
    if (recordCount > MAX_SORTIES) return unavailable('missing-unit-data');
    players.push({ id, name, team: side });
    const candidates: Array<{ sortie: TimelineSortie; base: number }> = [];
    let totalBase = 0;
    let deadBase = 0;
    for (const [unitKey, value] of records) {
      const unit = object(value);
      const unitId = identifier(unit.Id);
      if (unitId === null) continue;
      const entry = catalog[unitId];
      const base = typeof entry?.[1] === 'number' && entry[1] > 0 ? entry[1] : 100;
      const role = typeof entry?.[0] === 'string' ? entry[0] : null;
      totalBase += base;
      if (unit.WasRefunded !== undefined && typeof unit.WasRefunded !== 'boolean') continue;
      const refunded = unit.WasRefunded === true;
      const rawDeath = unit.DeathTime === undefined || unit.DeathTime === 0 ? null : unit.DeathTime;
      if (!refunded && timestamp(rawDeath) && rawDeath >= start && rawDeath <= start + duration)
        deadBase += base;
      if (
        !timestamp(unit.SpawnTime) ||
        unit.SpawnTime < start ||
        unit.SpawnTime > start + duration ||
        unit.DeathTime === null ||
        (rawDeath !== null &&
          (!timestamp(rawDeath) || rawDeath < unit.SpawnTime || rawDeath > start + duration))
      ) {
        invalidTime = true;
        continue;
      }
      const kills = metric(unit.KilledCount);
      const damage = metric(unit.TotalDamageDealt);
      if (kills === null || !Number.isInteger(kills) || damage === null) continue;
      candidates.push({
        base,
        sortie: {
          id: `${id}:${unitKey}`,
          playerId: id,
          player: name,
          team: side,
          unit: TIMELINE_UNIT_NAMES[unitId] ?? `Unit #${unitId}`,
          role,
          spawn: unit.SpawnTime - start,
          death: !refunded && typeof rawDeath === 'number' ? rawDeath - start : null,
          refunded,
          kills,
          damage,
          cost: 0,
          lossCost: 0,
        },
      });
    }
    for (const { sortie, base } of candidates) {
      sortie.cost = (base * spawned) / (totalBase || 1);
      sortie.lossCost = (base * losses) / (deadBase || 1);
      sorties.push(sortie);
    }
  }
  if (!sorties.length) return unavailable(invalidTime ? 'invalid-time' : 'missing-unit-data');

  const { frames, points } = buildSeries(sorties, duration);
  const data: TimelineData = {
    duration,
    frames,
    points,
    sorties,
    players,
    moments: buildMoments(sorties, points, duration),
  };
  return { status: 'ready', reason: null, data };
}

/** O(sorties + duration): separate exact-second snapshots and bucket-end loss totals. */
function buildSeries(sorties: TimelineSortie[], duration: number) {
  const last = Math.ceil(duration);
  const deltas = [new Float64Array(last + 1), new Float64Array(last + 1)];
  const lossBuckets = [
    new Float64Array(Math.ceil(duration / 60) + 1),
    new Float64Array(Math.ceil(duration / 60) + 1),
  ];
  for (const unit of sorties) {
    if (!unit.refunded) deltas[unit.team]![Math.ceil(unit.spawn)]! += unit.cost;
    if (unit.death !== null) {
      deltas[unit.team]![Math.ceil(unit.death)]! -= unit.lossCost;
      // A death at time zero is reflected in field value, not a later minute's losses.
      if (unit.death > 0) lossBuckets[unit.team]![Math.ceil(unit.death / 60)]! += unit.lossCost;
    }
  }
  const frames: TimelinePoint[] = [];
  const totals = [0, 0];
  for (let index = 0; index <= last; index++) {
    const second = Math.min(index, duration);
    totals[0]! += deltas[0]![index]!;
    totals[1]! += deltas[1]![index]!;
    const alpha = Math.max(0, Math.round(totals[0]!));
    const bravo = Math.max(0, Math.round(totals[1]!));
    const previous = frames[Math.max(0, Math.floor(second - 60))];
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
  // Only a fractional final frame lacks an integer-second rolling baseline.
  if (!Number.isInteger(duration) && duration > 60) {
    const previous = [0, 0];
    for (const unit of sorties) {
      if (!unit.refunded && unit.spawn <= duration - 60) previous[unit.team]! += unit.cost;
      if (unit.death !== null && unit.death <= duration - 60) previous[unit.team]! -= unit.lossCost;
    }
    frames[last]!.alphaChange = frames[last]!.alpha - Math.max(0, Math.round(previous[0]!));
    frames[last]!.bravoChange = frames[last]!.bravo - Math.max(0, Math.round(previous[1]!));
  }
  const boundaries = [0];
  for (let second = 60; second < duration; second += 60) boundaries.push(second);
  boundaries.push(duration);
  const points: TimelinePoint[] = [];
  for (const [index, second] of boundaries.entries()) {
    const frame = frames[Math.ceil(second)]!;
    points.push({
      ...frame,
      alphaChange: frame.alpha - (points[index - 1]?.alpha ?? 0),
      bravoChange: frame.bravo - (points[index - 1]?.bravo ?? 0),
      alphaLoss: Math.round(lossBuckets[0]![index]!),
      bravoLoss: Math.round(lossBuckets[1]![index]!),
    });
  }
  return { frames, points };
}

function buildMoments(sorties: TimelineSortie[], points: TimelinePoint[], duration: number) {
  const moments: TimelineMoment[] = [];
  for (const unit of sorties) {
    const end = unit.death ?? duration;
    const interval = {
      team: unit.team,
      playerId: unit.playerId,
      player: unit.player,
      start: unit.spawn,
      end,
      unit: unit.unit,
      sorties: [unit],
    };
    if (!unit.refunded && unit.kills >= 5 && end - unit.spawn <= 120)
      moments.push({
        ...interval,
        id: `highlight:${unit.id}`,
        kind: 'highlight',
        eventType: 'short-multikill',
        value: unit.kills,
        weight: unit.kills * (1 + 60 / Math.max(20, end - unit.spawn)),
      });
    if (
      unit.death !== null &&
      unit.kills === 0 &&
      unit.damage === 0 &&
      unit.cost >= 220 &&
      end - unit.spawn <= (lifeLimits[unit.role ?? ''] ?? 41)
    )
      moments.push({
        ...interval,
        id: `loss:${unit.id}`,
        kind: 'loss',
        eventType: 'rapid-death',
        value: Math.round(unit.lossCost),
        weight: unit.cost / 50,
      });
  }
  for (const side of [0, 1]) {
    const dead = sorties
      .filter((unit) => unit.team === side && unit.death !== null)
      .sort((a, b) => a.death! - b.death!);
    let bestStart = 0;
    let bestEnd = 0;
    let bestValue = 0;
    let end = 0;
    let value = 0;
    // Sliding 60-second window, rather than scanning every suffix for every death.
    for (let start = 0; start < dead.length; start++) {
      while (end < dead.length && dead[end]!.death! <= dead[start]!.death! + 60) {
        value += dead[end]!.lossCost;
        end++;
      }
      if (value > bestValue) {
        bestValue = value;
        bestStart = start;
        bestEnd = end;
      }
      value -= dead[start]!.lossCost;
    }
    const mean = dead.reduce((sum, unit) => sum + unit.lossCost, 0) / (duration / 60);
    if (bestValue >= 1800 && bestValue >= mean * 3 && bestEnd > bestStart) {
      const best = dead.slice(bestStart, bestEnd);
      moments.push({
        id: `burst:${side}`,
        kind: 'loss',
        eventType: 'loss-burst',
        team: side,
        playerId: null,
        player: side === 0 ? 'Alpha' : 'Bravo',
        start: best[0]!.death!,
        end: best.at(-1)!.death!,
        value: Math.round(bestValue),
        unit: '',
        sorties: best,
        weight: bestValue / 100,
      });
    } else {
      // A loss peak is a factual ranking, not a claim of an exceptional collapse.
      const key = side === 0 ? 'alphaLoss' : 'bravoLoss';
      let peakIndex = 1;
      for (let index = 2; index < points.length; index++)
        if (points[index]![key] > points[peakIndex]![key]) peakIndex = index;
      const peak = points[peakIndex]!;
      const start = points[peakIndex - 1]!.second;
      const units = dead.filter((unit) => unit.death! > start && unit.death! <= peak.second);
      if (units.length)
        moments.push({
          id: `peak:${side}`,
          kind: 'loss',
          eventType: 'loss-peak',
          team: side,
          playerId: null,
          player: side === 0 ? 'Alpha' : 'Bravo',
          start,
          end: peak.second,
          value: peak[key],
          unit: '',
          sorties: units,
          weight: 100,
        });
    }
    let drone: TimelineSortie | undefined;
    for (const unit of sorties)
      if (
        unit.team === side &&
        unit.role === 'recon' &&
        /Orion|RQ-|MQ-|Global Hawk|Forpost|Korsar|Shadow/i.test(unit.unit) &&
        (!drone || unit.spawn < drone.spawn)
      )
        drone = unit;
    if (drone)
      moments.push({
        id: `recon:${side}`,
        kind: 'recon',
        eventType: 'recon-deployment',
        team: side,
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
  const chosen = moments.filter((moment) => moment.kind === 'recon');
  for (const kind of ['highlight', 'loss'] as const) {
    const seen = new Set<string>();
    for (const moment of moments
      .filter((moment) => moment.kind === kind)
      .sort((a, b) => b.weight - a.weight)) {
      const key = moment.playerId ?? `team:${moment.team}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chosen.push(moment);
      if (seen.size === (kind === 'highlight' ? 3 : 4)) break;
    }
  }
  return chosen.sort((a, b) => a.start - b.start);
}
