import {
  Fragment,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ChevronRight, Shield, Trophy, UserRound } from 'lucide-react';
import type { Match, MatchPlayer, MatchTitle } from '@ba/contracts';
import { formatMetric, teamLabel } from '@ba/shared';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/Tooltip';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuGroup,
  ContextMenuItem,
} from '@/components/ui/context-menu';
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
import { panelShapeClasses } from '@/lib/surfaces';
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

function PlayerDisclosure({
  player,
  expanded,
  controls,
  onToggle,
}: {
  player: MatchPlayer;
  expanded: boolean;
  controls: string;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  const { openModal } = useApp();
  const trigger = useRef<HTMLButtonElement>(null);
  const openingProfile = useRef(false);
  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) openingProfile.current = false;
      }}
    >
      <ContextMenuTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="overlay"
          size="sm"
          aria-label={player.name || '#' + player.id}
          aria-haspopup="menu"
          aria-keyshortcuts="Shift+F10"
          aria-expanded={expanded}
          aria-controls={expanded ? controls : undefined}
          className="match-player-toggle absolute inset-0 size-full rounded-none focus-visible:inset-ring-2 focus-visible:inset-ring-ring active:not-aria-[haspopup]:translate-y-0"
          onClick={() => onToggle(player.id)}
          onContextMenu={(event) => event.currentTarget.focus({ preventScroll: true })}
          onKeyDown={(event) => {
            if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
            event.preventDefault();
            const node = event.currentTarget,
              rect = node.getBoundingClientRect();
            node.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                button: 2,
                clientX: rect.left + 16,
                clientY: rect.bottom,
              }),
            );
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-40"
        onCloseAutoFocus={(event) => {
          if (openingProfile.current) event.preventDefault();
        }}
      >
        <ContextMenuLabel>#{player.id}</ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem
            onSelect={() => {
              openingProfile.current = true;
              trigger.current?.focus({ preventScroll: true });
              openModal({ type: 'profile', id: player.id, name: player.name });
            }}
          >
            <UserRound aria-hidden="true" />
            {t('matchViewProfile')}
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PlayerDetails({ player }: { player: MatchPlayer }) {
  const { t } = useI18n();
  const metrics: MatchMetric[] = [
    'oldRating',
    'newRating',
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
    <div className="match-player-details py-4 pe-4 ps-(--player-name-inset) bg-muted/50">
      <dl className="match-player-metrics grid grid-cols-4 gap-4 [&_dt]:text-muted-foreground [&_dt]:text-[0.75rem] [&_dd]:mt-1 [&_dd]:tabular-nums">
        {metrics.map((metric) => (
          <div key={metric}>
            <dt>{t(matchMetricLabels[metric])}</dt>
            <dd>{playerMetric(player, metric)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type TeamWidths = Record<string, number>;

export function MatchScoreboard({
  match,
  titles,
  group,
  loading,
  expanded,
  onTogglePlayer,
}: {
  match: Match | null;
  titles: Record<string, MatchTitle[]>;
  group: MatchMetricGroup;
  loading: boolean;
  expanded: ReadonlySet<string>;
  onTogglePlayer: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const regionId = useId();
  const layout = useRef<HTMLDivElement>(null);
  const [teamWidths, setTeamWidths] = useState<TeamWidths>({});
  const columns = matchMetricGroups[group];
  useLayoutEffect(() => {
    const root = layout.current;
    if (!root) return;
    let active = true;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      if (!active || !bounds.width) return;
      const scale = root.offsetWidth ? bounds.width / root.offsetWidth : 1;
      const widths: TeamWidths = {};
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
        widths[team.dataset.matchTeam!] = Math.ceil(
          columnWidths.reduce((sum, width) => sum + width, 0),
        );
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
            className={cn(
              panelShapeClasses,
              'match-team flex min-w-0 grow basis-[min(100%,var(--match-team-width,36rem))] flex-col overflow-hidden border border-border',
            )}
            key={String(team.id)}
            data-match-team={String(team.id)}
            style={
              teamWidth
                ? ({
                    '--match-team-width': `${teamWidth + 2}px`,
                    '--match-table-width': `${teamWidth}px`,
                  } as CSSProperties)
                : undefined
            }
            aria-label={label}
          >
            <div className="match-team-heading flex items-center gap-2 justify-between [.match-details_&]:flex-wrap [.match-details_&]:min-h-11 [.match-details_&]:py-2 [.match-details_&]:px-5 [.match-details_&]:gap-2">
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
              <Table aria-label={t('matchTeamTable', { team: label })} aria-busy={loading}>
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
                <TableBody className="[&_tr:last-child]:border-b [&_tr:last-child]:border-b-transparent">
                  {skeleton && <TableSkeletonRows columns={['player', ...columns]} />}
                  {team.players.map((player) => {
                    const isOpen = expanded.has(player.id);
                    const id = `${regionId}-${player.id}`;
                    const playerName = player.name || `#${player.id}`;
                    const playerTitles = titles[player.id] ?? [];
                    const scoreLabels =
                      match?.endedAt != null ? (match.scoreLabels?.[player.id] ?? []) : [];
                    const hasLabels = playerTitles.length > 0 || scoreLabels.length > 0;
                    return (
                      <Fragment key={player.id}>
                        <TableRow data-self={player.id === match?.localPlayerId || undefined}>
                          <TableCell className="match-player-cell relative isolate whitespace-nowrap">
                            <div className="match-player-heading flex items-center gap-2 w-max min-w-0 flex-nowrap">
                              <PlayerDisclosure
                                player={player}
                                expanded={isOpen}
                                controls={id}
                                onToggle={onTogglePlayer}
                              />
                              <span className="pointer-events-none relative inline-flex h-7 max-w-56 items-center gap-1.5 pr-0.5 pl-1.5 text-[0.8rem] font-medium select-none">
                                <ChevronRight
                                  aria-hidden="true"
                                  className={cn(
                                    'size-3.5 shrink-0 text-muted-foreground',
                                    isOpen && 'rotate-90',
                                  )}
                                />
                                <span className="match-player-name truncate">{playerName}</span>
                              </span>
                              {hasLabels && (
                                <div className="match-player-labels pointer-events-none relative flex shrink-0 flex-nowrap items-center gap-1 [&_button]:pointer-events-auto">
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
        className="match-team-table rounded-(--radius-panel) [corner-shape:squircle] [--player-name-inset:--spacing(9)] overflow-x-auto [&>[data-slot='table-container']]:overflow-visible [&_table]:min-w-[var(--match-table-width,35rem)] [&_table]:table-auto [&_th]:px-2.5 [&_th]:text-right [&_th]:tabular-nums [&_th]:h-9 [&_th]:text-[0.75rem] [&_th]:font-normal [&_th]:text-muted-foreground [&_td]:px-2.5 [&_td]:text-right [&_td]:tabular-nums [&_td]:py-1 [&_td]:text-[0.8125rem] [&_th:first-child]:text-left [&_th:first-child]:ps-(--player-name-inset) [&_td:first-child]:text-left [&_tbody_tr]:h-11 [&_[data-self]]:bg-accent/50 [&_[data-self]>.match-player-cell]:before:pointer-events-none [&_[data-self]>.match-player-cell]:before:absolute [&_[data-self]>.match-player-cell]:before:inset-y-0 [&_[data-self]>.match-player-cell]:before:start-0 [&_[data-self]>.match-player-cell]:before:z-10 [&_[data-self]>.match-player-cell]:before:w-[3px] [&_[data-self]>.match-player-cell]:before:bg-ring [&:focus-visible]:outline-2 [&:focus-visible]:outline-solid [&:focus-visible]:outline-ring [&:focus-visible]:outline-offset-[-2px]"
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
