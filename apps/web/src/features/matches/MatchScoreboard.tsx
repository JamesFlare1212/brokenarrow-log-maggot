import {
  Fragment,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ChevronRight, ExternalLink, Shield, Trophy } from 'lucide-react';
import type { Match, MatchPlayer, MatchTitle } from '@ba/contracts';
import { formatMetric, teamLabel } from '@ba/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipButton } from '@/components/Tooltip';
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
import { OverflowHint } from '../../components/OverflowHint';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { cn } from '@/lib/utils';
import { eloChangeClass } from '@/lib/elo';
import { MatchAwards } from './MatchAwards';
import {
  matchMetricGroups,
  matchMetricLabels,
  matchTeams,
  playerEloDelta,
  playerMetric,
  type MatchMetric,
  type MatchMetricGroup,
} from './detail-model';

function PlayerDetails({ player }: { player: MatchPlayer }) {
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
  return (
    <div className="match-player-details p-4 bg-muted/50">
      <div className="match-player-details-heading flex items-center gap-2 justify-between flex-wrap wrap-anywhere">
        <span>
          {player.name} <span className="muted text-muted-foreground">#{player.id}</span>
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
      <dl className="match-player-metrics grid grid-cols-4 gap-4 my-4 [&_dt]:text-muted-foreground [&_dt]:text-[0.75rem] [&_dd]:mt-1 [&_dd]:tabular-nums">
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
  const { t, locale } = useI18n();
  const regionId = useId();
  const layout = useRef<HTMLDivElement>(null);
  const [teamWidths, setTeamWidths] = useState<Record<string, number>>({});
  const columns = matchMetricGroups[group];
  useLayoutEffect(() => {
    const root = layout.current;
    if (!root) return;
    let active = true;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      if (!active || !bounds.width) return;
      const scale = root.offsetWidth ? bounds.width / root.offsetWidth : 1;
      const widths: Record<string, number> = {};
      for (const team of root.querySelectorAll<HTMLElement>('[data-match-team]')) {
        const columnWidths: number[] = [];
        for (const row of team.querySelectorAll<HTMLTableRowElement>(
          'table tr:not(.match-player-expanded)',
        )) {
          Array.from(row.cells).forEach((cell, index) => {
            const content = cell.querySelector('.match-player-heading, [data-slot="skeleton"]');
            const range = document.createRange();
            range.selectNodeContents(cell);
            const width =
              (content
                ? content.getBoundingClientRect().width
                : range.getBoundingClientRect().width) / scale;
            const style = getComputedStyle(cell);
            columnWidths[index] = Math.max(
              columnWidths[index] ?? 0,
              width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
            );
          });
        }
        widths[team.dataset.matchTeam!] =
          Math.ceil(columnWidths.reduce((sum, width) => sum + width, 0)) + 2;
      }
      setTeamWidths((current) =>
        Object.keys(current).length === Object.keys(widths).length &&
        Object.entries(widths).every(([id, width]) => current[id] === width)
          ? current
          : widths,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    void document.fonts?.ready.then(measure);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      active = false;
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [match, titles, group, loading, locale]);
  return (
    <div ref={layout} className="match-scoreboard-grid flex flex-wrap items-start gap-4">
      {matchTeams(match).map((team) => {
        const teamWidth = teamWidths[String(team.id)];
        const skeleton = !team.players.length && loading && (team.id === 0 || team.id === 1);
        if (!team.players.length && !skeleton) return null;
        const label =
          team.id === 100 ? t('spectator') : team.id === null ? t('unknown') : teamLabel(team.id);
        return (
          <section
            className="match-team flex min-w-0 grow basis-[min(100%,var(--match-team-width,36rem))] flex-col overflow-hidden border border-border rounded-lg"
            key={String(team.id)}
            data-match-team={String(team.id)}
            style={
              teamWidth
                ? ({
                    '--match-team-width': `${teamWidth}px`,
                    '--match-table-width': `${teamWidth - 2}px`,
                  } as CSSProperties)
                : undefined
            }
            aria-label={label}
          >
            <div className="match-team-heading flex items-center gap-2 justify-between [.match-details_&]:flex-wrap [.match-details_&]:min-h-11 [.match-details_&]:py-2 [.match-details_&]:px-3 [.match-details_&]:gap-2">
              <div className="match-team-identity flex items-center gap-2 flex-wrap text-[0.75rem] [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:text-muted-foreground">
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
                          : !match?.fid
                            ? 'matchUnrecorded'
                            : 'unknown',
                    )}
                  </Badge>
                )}
                <span className="muted text-muted-foreground match-team-count match-detail-max-36:hidden">
                  {skeleton ? (
                    <Skeleton className="h-4 w-12" />
                  ) : (
                    t('playersCount', { n: team.players.length })
                  )}
                </span>
              </div>
              <span className="match-team-total inline-flex gap-1.5 text-muted-foreground text-[0.6875rem] [&_strong]:text-foreground [&_strong]:font-medium [&_strong]:tabular-nums">
                {t('destruction')}{' '}
                <strong>
                  {skeleton ? <Skeleton className="h-4 w-12" /> : formatMetric(team.destruction, 0)}
                </strong>
              </span>
            </div>
            <MatchTeamTable label={t('matchTeamTable', { team: label })}>
              <Table
                stickyHeader
                aria-label={t('matchTeamTable', { team: label })}
                aria-busy={loading}
              >
                <colgroup>
                  <col />
                  {columns.map((metric) => (
                    <col key={metric} className="match-metric-column w-[1%]" />
                  ))}
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('player')}</TableHead>
                    {columns.map((metric) => (
                      <TableHead scope="col" key={metric}>
                        {metric === 'dlRatio' ? (
                          <Tooltip content={t('matchRatioHint')}>
                            <abbr tabIndex={0} aria-label={t('matchRatioHint')}>
                              D/L
                            </abbr>
                          </Tooltip>
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
                    const isOpen = expanded === player.id;
                    const id = `${regionId}-${player.id}`;
                    const playerTitles = titles[player.id] ?? [];
                    const scoreLabels =
                      match?.endedAt != null ? (match.scoreLabels?.[player.id] ?? []) : [];
                    const hasLabels = playerTitles.length > 0 || scoreLabels.length > 0;
                    return (
                      <Fragment key={player.id}>
                        <TableRow data-self={player.id === match?.localPlayerId || undefined}>
                          <TableCell className="match-player-cell whitespace-nowrap">
                            <div className="match-player-heading flex items-center gap-2 w-max min-w-0 flex-nowrap">
                              <TooltipButton
                                variant="ghost"
                                size="sm"
                                tooltip={player.name || `#${player.id}`}
                                className="match-player-toggle min-w-0 max-w-56 h-7 shrink-0 items-center gap-1.5 justify-start px-0.5 whitespace-nowrap [&_svg]:text-muted-foreground"
                                aria-expanded={isOpen}
                                aria-controls={isOpen ? id : undefined}
                                onClick={() => onExpand(isOpen ? null : player.id)}
                              >
                                <ChevronRight
                                  data-icon="inline-start"
                                  className={cn(isOpen && 'rotate-90')}
                                  aria-hidden="true"
                                />
                                <span className="match-player-name min-w-0 text-left truncate">
                                  {player.name || `#${player.id}`}
                                </span>
                              </TooltipButton>
                              {hasLabels && (
                                <div className="match-player-labels flex shrink-0 flex-nowrap items-center gap-1">
                                  <MatchAwards
                                    key={`${match?.id}:${player.id}`}
                                    titles={playerTitles}
                                    scoreLabels={scoreLabels}
                                  />
                                </div>
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
                          <TableRow className="match-player-expanded [&>td]:p-0 [&>td]:whitespace-normal">
                            <TableCell colSpan={6}>
                              <div id={id}>
                                <PlayerDetails player={player} />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </MatchTeamTable>
          </section>
        );
      })}
    </div>
  );
}

function MatchTeamTable({ label, children }: { label: string; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  return (
    <div className="match-team-data min-w-0">
      <div
        ref={viewport}
        className="match-team-table max-h-144 overflow-auto [&>[data-slot='table-container']]:overflow-visible [&_table]:min-w-[var(--match-table-width,35rem)] [&_table]:table-auto [&_th]:px-2.5 [&_th]:text-right [&_th]:tabular-nums [&_th]:h-9 [&_th]:text-[0.75rem] [&_th]:font-normal [&_th]:text-muted-foreground [&_td]:px-2.5 [&_td]:text-right [&_td]:tabular-nums [&_td]:py-1 [&_td]:text-[0.8125rem] [&_th:first-child]:text-left [&_td:first-child]:text-left [&_tbody_tr]:h-11 [&_[data-self]]:bg-accent/50 [&_[data-self]>td:first-child]:shadow-[inset_3px_0_var(--ring)] [&:focus-visible]:outline-2 [&:focus-visible]:outline-solid [&:focus-visible]:outline-ring [&:focus-visible]:outline-offset-[-2px]"
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        {children}
      </div>
      <OverflowHint viewport={viewport} />
    </div>
  );
}
