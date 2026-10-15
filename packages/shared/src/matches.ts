import type { Match, MatchPlayer, MaggotReport, MaggotRow, Mode, Outcome } from '@ba/contracts';
import { array, object, number, text, team, timestamp, boolean } from './values';
import { mergePlayers } from './merge';
export const MAP_NAMES: Record<number, string> = {
  3: 'Baltiisk',
  4: 'Coast',
  6: 'River',
  7: 'Dam',
  9: 'Airport',
  10: 'Frontiers',
  11: 'Central Village',
  12: 'Oil refinery',
  13: 'Suwalki',
  16: 'Klaipeda',
  17: 'Ruda',
  20: 'Parnu',
  21: 'Chernyakhovsk',
  22: 'Ignalina Powerplant',
};
export function mapName(id: number | null): string {
  return id == null ? '' : MAP_NAMES[id] || `map:${id}`;
}
export function mapId(name: string): number | null {
  const hit = Object.entries(MAP_NAMES).find(
    ([, n]) => n.toLowerCase() === name.trim().toLowerCase(),
  );
  const numeric = /^map:(\d+)$/.exec(name);
  return hit ? Number(hit[0]) : numeric ? Number(numeric[1]) : null;
}
export function emptyPlayer(id: string, name = id): MatchPlayer {
  return {
    id,
    name,
    teamId: null,
    oldRating: null,
    newRating: null,
    destructionScore: null,
    lossesScore: null,
    objectivesCaptured: null,
    killed: null,
    damageDealt: null,
    damageReceived: null,
    dlRatio: null,
    supplyPoints: null,
    exp: null,
    medals: null,
  };
}
export function emptyMatch(id: string, at: number | null = null): Match {
  return {
    id,
    fid: /^\d+$/.test(id) ? id : null,
    sessionId: id,
    mapId: null,
    map: '',
    scenario: '',
    startedAt: at,
    endedAt: null,
    durationSec: null,
    durationSource: null,
    localDeck: '',
    points: null,
    players: [],
    mode: 'unknown',
    winnerTeamId: null,
    localPlayerId: null,
    localPersona: '',
    outcome: 'unknown',
    eloBefore: null,
    eloAfter: null,
    restarted: false,
    source: 'log',
    updatedAt: at || 0,
  };
}
export function normalizePlayer(
  value: unknown,
  id: string,
  api = true,
  previous?: MatchPlayer,
): MatchPlayer {
  const p = object(value),
    base = previous || emptyPlayer(id);
  const metric = (legacy: string, remote: string) =>
    number(p[legacy] ?? p[remote]) ?? (base[legacy as keyof MatchPlayer] as number | null);
  return {
    id: text(p.id ?? p.Id, id),
    name: text(p.name ?? p.Name, base.name),
    teamId: team(p.teamId ?? p.TeamId ?? p.team, api && !p._idOnly),
    oldRating: metric('oldRating', 'OldRating'),
    newRating: metric('newRating', 'NewRating'),
    destructionScore: metric('destructionScore', 'DestructionScore'),
    lossesScore: metric('lossesScore', 'LossesScore'),
    objectivesCaptured: metric('objectivesCaptured', 'ObjectivesCaptured'),
    killed: number(p.killed ?? p.Destruction ?? p.KilledCount) ?? base.killed,
    damageDealt: metric('damageDealt', 'DamageDealt'),
    damageReceived: metric('damageReceived', 'DamageReceived'),
    dlRatio: metric('dlRatio', 'DLRatio'),
    supplyPoints: metric('supplyPoints', 'SupplyPointsConsumed'),
    exp: metric('exp', 'TotalExp'),
    medals: Array.isArray(p.Medals) ? p.Medals.length : metric('medals', 'Medals'),
  };
}
export function playersFromData(data: unknown, previous: MatchPlayer[] = []): MatchPlayer[] {
  if (typeof data === 'string')
    return [...data.matchAll(/(\d+)\s*=/g)].map(
      (m) => previous.find((p) => p.id === m[1]) || emptyPlayer(m[1] || ''),
    );
  return Object.entries(object(data)).map(([key, value]) => {
    const id = text(object(value).Id, key);
    return normalizePlayer(
      value,
      id,
      true,
      previous.find((p) => p.id === id),
    );
  });
}
export function determineOutcome(
  players: MatchPlayer[],
  localId: string | null,
  mode: Mode,
  winner: 0 | 1 | null,
): { outcome: Outcome; winner: 0 | 1 | null; before: number | null; after: number | null } {
  const me = players.find((p) => p.id === localId);
  if (!me) return { outcome: 'unknown', winner, before: null, after: null };
  if (me.teamId === 100) return { outcome: 'spectator', winner, before: null, after: null };
  if (me.teamId !== 0 && me.teamId !== 1)
    return { outcome: 'unknown', winner, before: me.oldRating, after: me.newRating };
  let won: boolean | null = null;
  if (
    mode === 'ranked' &&
    me.oldRating !== null &&
    me.newRating !== null &&
    Math.abs(me.newRating - me.oldRating) >= 0.01
  ) {
    won = me.newRating > me.oldRating;
    winner = won ? me.teamId : me.teamId === 0 ? 1 : 0;
  } else if (winner !== null) won = me.teamId === winner;
  return {
    outcome: won === null ? 'unknown' : won ? 'win' : 'loss',
    winner,
    before: me.oldRating,
    after: me.newRating,
  };
}
export function normalizeMatch(
  value: unknown,
  options: {
    id: string;
    localId?: string | null;
    previous?: Match;
    legacy?: boolean;
    now?: number;
  },
): Match {
  const wrapper = object(value),
    p = object(wrapper.matchInfo ?? wrapper.data ?? value),
    base = options.previous || emptyMatch(options.id),
    legacy = !!options.legacy;
  const incoming =
    legacy && Array.isArray(p.players)
      ? array(p.players).map((v) => {
          const id = text(object(v).id);
          return normalizePlayer(
            v,
            id,
            false,
            base.players.find((b) => b.id === id),
          );
        })
      : playersFromData(p.Data, base.players);
  const players = mergePlayers(base.players, incoming);
  const mode: Mode = legacy
    ? p.mode === 'ranked' || p.mode === 'custom'
      ? p.mode
      : p.custom === true
        ? 'custom'
        : p.custom === false
          ? 'ranked'
          : base.mode
    : p.Type == null
      ? 'ranked'
      : 'custom';
  const localId = text(p.localPlayerId, options.localId ?? base.localPlayerId ?? '') || null;
  const winner = team(p.winnerTeamId ?? p.winnerTeam ?? p.WinnerTeam) as 0 | 1 | 100 | null;
  const result = determineOutcome(
    players,
    localId,
    mode,
    winner === 0 || winner === 1 ? winner : base.winnerTeamId,
  );
  const map = legacy ? text(p.map, base.map) : mapName(number(p.MapId));
  let outcome = result.outcome;
  if (outcome === 'unknown' && legacy)
    outcome =
      p.localSpectator === true
        ? 'spectator'
        : boolean(p.localWon) === true
          ? 'win'
          : boolean(p.localWon) === false
            ? 'loss'
            : base.outcome;
  return {
    ...base,
    id: options.id,
    fid: /^\d+$/.test(options.id) ? options.id : base.fid,
    players,
    mode,
    winnerTeamId: result.winner,
    localPlayerId: localId,
    localPersona: text(p.localPersona ?? p.localName, base.localPersona),
    outcome,
    eloBefore: result.before ?? base.eloBefore,
    eloAfter: result.after ?? number(p.localEloAfter) ?? base.eloAfter,
    map: map || base.map,
    mapId: number(p.mapId ?? p.MapId) ?? mapId(map) ?? base.mapId,
    scenario: text(p.scenario, base.scenario),
    startedAt: legacy ? (number(p.startedAt ?? p.startTime) ?? base.startedAt) : base.startedAt,
    endedAt: legacy
      ? (number(p.endedAt ?? p.endTime ?? p.archivedAt) ?? base.endedAt)
      : (timestamp(p.EndTime) ?? base.endedAt),
    durationSec: number(p.durationSec ?? p.TotalPlayTimeInSec) ?? base.durationSec,
    durationSource:
      p.TotalPlayTimeInSec != null ? 'api' : p.durationSec != null ? 'log' : base.durationSource,
    localDeck: text(p.localDeck, base.localDeck),
    points: number(p.points) ?? base.points,
    restarted: legacy ? p.restarted === true || base.restarted : false,
    source: legacy ? 'legacy' : 'api',
    updatedAt: options.now ?? Date.now(),
  };
}
export function winnerFromAnalysis(value: unknown): 0 | 1 | null {
  const raw = object(value),
    comparison = object(raw.teamComparison);
  const winner = team(
    raw.winnerTeamId ??
      raw.winnerTeam ??
      raw.WinnerTeam ??
      comparison.winnerTeamId ??
      comparison.winnerTeam,
  );
  return winner === 0 || winner === 1 ? winner : null;
}
export function summarizeMaggot(id: string, rows: MaggotRow[], calls = 0): MaggotReport {
  const complete = rows.length === 12,
    average = rows.length ? rows.reduce((s, r) => s + r.mvpRank, 0) / rows.length : null;
  const index =
    complete && average !== null
      ? Math.round((1 + (9 * (1 - Math.cos(((average - 1) / 4) * Math.PI))) / 2) * 10) / 10
      : null;
  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (complete) {
    const recent = rows.slice(0, 3).reduce((s, r) => s + r.mvpRank, 0) / 3,
      older = rows.slice(3).reduce((s, r) => s + r.mvpRank, 0) / 9;
    trend = recent < older - 0.4 ? 'up' : recent > older + 0.4 ? 'down' : 'flat';
  }
  return {
    id,
    complete,
    index,
    averageRank: average,
    trend,
    rows,
    calls,
    warning: complete ? null : `Only ${rows.length}/12 eligible ranked matches are available.`,
  };
}
