import type { Match, MatchPlayer, TeamId } from '@ba/contracts';
import { formatDelta, formatMetric } from '@ba/shared';

export const matchMetricGroups = {
  core: ['destructionScore', 'lossesScore', 'dlRatio', 'objectivesCaptured', 'eloDelta'],
  combat: ['killed', 'damageDealt', 'damageReceived', 'dlRatio', 'eloDelta'],
  support: ['supplyPoints', 'exp', 'medals', 'objectivesCaptured', 'eloDelta'],
} as const;
export type MatchMetricGroup = keyof typeof matchMetricGroups;
export type MatchMetric = Exclude<keyof MatchPlayer, 'id' | 'name' | 'teamId'> | 'eloDelta';
export const matchMetricLabels: Record<MatchMetric, string> = {
  destructionScore: 'destruction',
  lossesScore: 'losses',
  dlRatio: 'D/L',
  objectivesCaptured: 'objectives',
  killed: 'kills',
  damageDealt: 'damage',
  damageReceived: 'received',
  supplyPoints: 'supply',
  exp: 'experience',
  medals: 'medals',
  oldRating: 'matchRatingBefore',
  newRating: 'matchRatingAfter',
  eloDelta: 'eloDelta',
};

export function playerEloDelta(player: MatchPlayer) {
  return player.newRating !== null && player.oldRating !== null
    ? player.newRating - player.oldRating
    : null;
}

export function playerMetric(player: MatchPlayer, metric: MatchMetric) {
  if (metric === 'eloDelta') return formatDelta(playerEloDelta(player));
  if (metric === 'dlRatio' && player.lossesScore === 0)
    return player.destructionScore !== null && player.destructionScore > 0 ? '∞' : '—';
  return formatMetric(
    player[metric],
    ['dlRatio', 'oldRating', 'newRating'].includes(metric) ? 2 : 0,
  );
}

export function matchTeams(match: Match | null) {
  const local = match?.players.find((player) => player.id === match.localPlayerId);
  const order: TeamId[] = local?.teamId === 1 ? [1, 0, 100, null] : [0, 1, 100, null];
  return order.map((id) => {
    const players = match?.players.filter((player) => player.teamId === id) ?? [];
    const activeTeam = id === 0 || id === 1;
    const relation =
      activeTeam && (local?.teamId === 0 || local?.teamId === 1)
        ? id === local.teamId
          ? 'friendlyTeam'
          : 'enemyTeam'
        : null;
    const outcome = !activeTeam
      ? null
      : match?.winnerTeamId != null
        ? id === match.winnerTeamId
          ? 'win'
          : 'loss'
        : relation === 'friendlyTeam' && (match?.outcome === 'win' || match?.outcome === 'loss')
          ? match.outcome
          : 'unknown';
    const destruction =
      players.length && players.every((player) => player.destructionScore !== null)
        ? players.reduce((total, player) => total + player.destructionScore!, 0)
        : null;
    return { id, players, relation, outcome, destruction };
  });
}
