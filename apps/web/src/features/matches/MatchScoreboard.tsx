import { Fragment, useId } from 'react';
import { ChevronRight, ExternalLink, Medal, Shield, Trophy } from 'lucide-react';
import type { Match, MatchPlayer, MatchTitle } from '@ba/contracts';
import { formatMetric, teamLabel } from '@ba/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeletonRows } from '../../components/LoadingState';
import { TooltipButton } from '../../components/Tooltip';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { cn } from '@/lib/utils';
import { eloChangeClass } from '@/lib/elo';
import { MatchAwards } from './MatchAwards';
import { matchAwardGroups } from './award-model';
import {
  matchMetricGroups,
  matchMetricLabels,
  matchTeams,
  playerEloDelta,
  playerMetric,
  type MatchMetric,
  type MatchMetricGroup,
} from './detail-model';

function PlayerDetails({
  player,
  match,
  titles,
}: {
  player: MatchPlayer;
  match: Match;
  titles: MatchTitle[];
}) {
  const { t } = useI18n();
  const { openModal } = useApp();
  const metrics: MatchMetric[] = [
    'oldRating',
    'newRating',
    'eloDelta',
    'destructionScore',
    'lossesScore',
    'dlRatio',
    'objectivesCaptured',
    'killed',
    'damageDealt',
    'damageReceived',
    'supplyPoints',
    'exp',
    'medals',
  ];
  const scoreLabels = match.endedAt != null ? match.scoreLabels?.[player.id] : undefined;
  return (
    <div className="match-player-details">
      <div className="match-player-details-heading">
        <span>
          {player.name} <span className="muted">#{player.id}</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openModal({ type: 'profile', id: player.id, name: player.name })}
        >
          {t('matchViewProfile')}
          <ExternalLink data-icon="inline-end" aria-hidden="true" />
        </Button>
      </div>
      <dl className="match-player-metrics">
        {metrics.map((metric) => (
          <div key={metric}>
            <dt>{t(matchMetricLabels[metric])}</dt>
            <dd
              className={metric === 'eloDelta' ? eloChangeClass(playerEloDelta(player)) : undefined}
            >
              {playerMetric(player, metric)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="match-player-awards">
        <span className="muted">{t('matchAwards')}</span>
        <MatchAwards titles={titles} scoreLabels={scoreLabels} />
        {!titles.length && !scoreLabels?.length && (
          <span className="muted">{t('matchNoAwards')}</span>
        )}
      </div>
    </div>
  );
}

export function MatchScoreboard({
  match,
  titles,
  group,
  loading,
  expanded,
  onExpand,
}: {
  match: Match | null;
  titles: Record<string, MatchTitle[]>;
  group: MatchMetricGroup;
  loading: boolean;
  expanded: string | null;
  onExpand: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const regionId = useId();
  const columns = matchMetricGroups[group];
  return (
    <div className="match-scoreboard-grid">
      {matchTeams(match).map((team) => {
        const skeleton = !team.players.length && loading && (team.id === 0 || team.id === 1);
        if (!team.players.length && !skeleton) return null;
        const label =
          team.id === 100 ? t('spectator') : team.id === null ? t('unknown') : teamLabel(team.id);
        return (
          <section className="match-team" key={String(team.id)} aria-label={label}>
            <div className="match-team-heading">
              <div className="match-team-identity">
                {team.outcome === 'win' ? (
                  <Trophy aria-hidden="true" />
                ) : (
                  <Shield aria-hidden="true" />
                )}
                <h3>
                  {team.relation && <span>{t(team.relation)} · </span>}
                  {label}
                </h3>
                {team.outcome && !skeleton && (
                  <Badge
                    variant={
                      team.outcome === 'win'
                        ? 'success'
                        : team.outcome === 'loss'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {t(
                      team.outcome === 'win'
                        ? 'matchVictory'
                        : team.outcome === 'loss'
                          ? 'matchDefeat'
                          : 'unknown',
                    )}
                  </Badge>
                )}
                <span className="muted match-team-count">
                  {skeleton ? (
                    <Skeleton className="h-4 w-12" />
                  ) : (
                    t('playersCount', { n: team.players.length })
                  )}
                </span>
              </div>
              <span className="match-team-total">
                {t('destruction')}{' '}
                <strong>
                  {skeleton ? <Skeleton className="h-4 w-12" /> : formatMetric(team.destruction, 0)}
                </strong>
              </span>
            </div>
            <div
              className="match-team-table"
              tabIndex={0}
              aria-label={t('matchTeamTable', { team: label })}
            >
              <Table aria-label={t('matchTeamTable', { team: label })} aria-busy={loading}>
                <colgroup>
                  <col className="match-player-column" />
                  {columns.map((metric) => (
                    <col
                      key={metric}
                      className={metric === 'eloDelta' ? 'match-rating-column' : undefined}
                    />
                  ))}
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('player')}</TableHead>
                    {columns.map((metric) => (
                      <TableHead scope="col" key={metric}>
                        {metric === 'dlRatio' ? (
                          <abbr title={t('matchRatioHint')}>D/L</abbr>
                        ) : (
                          t(matchMetricLabels[metric])
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skeleton && <TableSkeletonRows columns={['player', ...columns]} />}
                  {team.players.map((player) => {
                    const awards = matchAwardGroups(
                      titles[player.id] ?? [],
                      match?.endedAt != null ? (match.scoreLabels?.[player.id] ?? []) : [],
                      t,
                    ).flatMap((group) => group.awards);
                    const isOpen = expanded === player.id;
                    const id = `${regionId}-${player.id}`;
                    return (
                      <Fragment key={player.id}>
                        <TableRow data-self={player.id === match?.localPlayerId || undefined}>
                          <TableCell className="match-player-cell">
                            <div className="match-player-heading">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="match-player-toggle"
                                aria-expanded={isOpen}
                                aria-controls={isOpen ? id : undefined}
                                onClick={() => onExpand(isOpen ? null : player.id)}
                              >
                                <ChevronRight
                                  data-icon="inline-start"
                                  className={cn(isOpen && 'rotate-90')}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{player.name || `#${player.id}`}</span>
                              </Button>
                              {player.id === match?.localPlayerId && (
                                <Badge variant="outline">{t('you')}</Badge>
                              )}
                              {awards.length > 0 && (
                                <TooltipButton
                                  size="icon-xs"
                                  variant="ghost"
                                  className="match-awards-toggle"
                                  aria-label={t('matchPlayerAwards', {
                                    name: player.name,
                                    count: awards.length,
                                  })}
                                  tooltip={awards.map((award) => award.name).join(' · ')}
                                  aria-expanded={isOpen}
                                  aria-controls={isOpen ? id : undefined}
                                  onClick={() => onExpand(isOpen ? null : player.id)}
                                >
                                  <Medal aria-hidden="true" />
                                </TooltipButton>
                              )}
                            </div>
                          </TableCell>
                          {columns.map((metric) => (
                            <TableCell
                              key={metric}
                              className={
                                metric === 'eloDelta'
                                  ? eloChangeClass(playerEloDelta(player))
                                  : undefined
                              }
                            >
                              {playerMetric(player, metric)}
                            </TableCell>
                          ))}
                        </TableRow>
                        {isOpen && match && (
                          <TableRow className="match-player-expanded">
                            <TableCell colSpan={6}>
                              <div id={id}>
                                <PlayerDetails
                                  player={player}
                                  match={match}
                                  titles={titles[player.id] ?? []}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
