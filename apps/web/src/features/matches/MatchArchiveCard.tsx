import type { Match } from '@ba/contracts';
import { formatDelta, formatMetric, formatTime, teamLabel } from '@ba/shared';
import { eloChangeClass } from '@/lib/elo';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useApp } from '../../app/state';
import { Button } from '@/components/ui/button';
import { useI18n } from '../../hooks/useI18n';
import { Skeleton } from '@/components/ui/skeleton';

export function MatchArchiveCardSkeleton() {
  return (
    <Card
      className="archive-card [&_[data-slot='card-header']]:min-w-0 [&_[data-slot='card-header']]:gap-2"
      aria-hidden="true"
    >
      <CardHeader className="items-baseline">
        <CardTitle className="archive-card-title min-w-0 text-[1.125rem] leading-snug font-bold">
          <Skeleton className="h-7 w-36" />
        </CardTitle>
        <CardDescription className="archive-card-meta col-start-1 flex flex-wrap items-center gap-1.5 wrap-anywhere">
          <Skeleton className="h-4 w-48" />
        </CardDescription>
        <CardDescription className="archive-card-time col-start-1">
          <Skeleton className="h-4 w-36" />
        </CardDescription>
        <CardAction className="row-span-1 self-baseline">
          <Skeleton className="h-7 w-16" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Separator />
        <div className="archive-card-teams grid grid-cols-2 gap-4 mt-4">
          {[0, 1].map((team) => (
            <section className="archive-card-team min-w-0" key={team}>
              <h4 className="archive-card-team-title flex items-center gap-2 mb-2.5 text-muted-foreground text-[0.875rem] font-semibold [&>span:last-child]:wrap-anywhere">
                <Skeleton className="h-4 w-24" />
              </h4>
              <ul className="archive-card-players flex flex-col gap-2.5 [&>li]:grid [&>li]:grid-cols-[minmax(0,_1fr)_auto] [&>li]:items-baseline [&>li]:gap-2 [&_strong]:text-[0.9375rem] [&_strong]:font-[750] [&_strong]:tabular-nums">
                {Array.from({ length: 5 }, (_, index) => (
                  <li key={index}>
                    <Skeleton className="h-7 w-28 max-w-full" />
                    <Skeleton className="h-4 w-10" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function MatchArchiveCard({ match, onOpen }: { match: Match; onOpen: () => void }) {
  const { openModal } = useApp();
  const { t, locale } = useI18n();
  const mapName = match.map || (match.fid ? '#' + match.fid : t('matchUnrecorded'));
  const localTeam = match.players.find((player) => player.id === match.localPlayerId)?.teamId;
  const timestamp = match.endedAt ?? match.startedAt;
  const eloDelta =
    match.eloBefore !== null && match.eloAfter !== null ? match.eloAfter - match.eloBefore : null;

  return (
    <Card
      className="archive-card [&_[data-slot='card-header']]:min-w-0 [&_[data-slot='card-header']]:gap-2 cursor-pointer"
      onClick={(event) => {
        if (
          event.button !== 0 ||
          !(event.target instanceof Element) ||
          event.target.closest(
            'button, a, input, select, textarea, [role="menu"], [role="menuitem"]',
          ) ||
          window.getSelection()?.toString()
        )
          return;
        onOpen();
      }}
    >
      <CardHeader className="items-baseline">
        <CardTitle
          role="heading"
          aria-level={3}
          aria-label={mapName}
          className="archive-card-title min-w-0 text-[1.125rem] leading-snug font-bold"
        >
          <Button
            type="button"
            variant="link"
            className="archive-card-map block w-full min-w-0 h-auto p-0 overflow-hidden text-inherit text-[length:inherit] leading-[inherit] font-[weight:inherit] text-left text-ellipsis whitespace-normal"
            data-match-open={match.id}
            aria-label={t('matchOpenDetail', {
              map: mapName,
              time: formatTime(match.endedAt ?? match.startedAt, locale),
            })}
            onClick={onOpen}
          >
            {mapName}
          </Button>
        </CardTitle>
        <CardDescription className="archive-card-meta col-start-1 flex flex-wrap items-center gap-1.5 wrap-anywhere">
          <span>{match.fid ? '#' + match.fid : t('matchLocalOnly')}</span>
          <span aria-hidden="true">·</span>
          <span>{t(!match.fid && match.mode === 'unknown' ? 'matchUnrecorded' : match.mode)}</span>
          <span aria-hidden="true">·</span>
          <span>{t('playersCount', { n: match.players.length })}</span>
        </CardDescription>
        <CardDescription className="archive-card-time col-start-1">
          <time dateTime={timestamp === null ? undefined : new Date(timestamp).toISOString()}>
            {formatTime(timestamp, locale)}
          </time>
        </CardDescription>
        <CardAction className="row-span-1 self-baseline">
          <Badge variant="value" aria-label={`${t('eloDelta')}: ${formatDelta(eloDelta)}`}>
            <span className={eloChangeClass(eloDelta)}>{formatDelta(eloDelta)}</span>
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Separator />
        {match.players.length ? (
          <div className="archive-card-teams grid grid-cols-2 gap-4 mt-4">
            {([0, 1, 100, null] as const).map((team) => {
              const players = match.players.filter((player) => player.teamId === team);
              if (!players.length) return null;
              return (
                <section className={`archive-card-team min-w-0 team-${team}`} key={String(team)}>
                  <h4 className="archive-card-team-title flex items-center gap-2 mb-2.5 text-muted-foreground text-[0.875rem] font-semibold [&>span:last-child]:wrap-anywhere">
                    {(team === 0 || team === 1) && (
                      <span
                        className="team-indicator w-0.75 h-3.5 shrink-0 rounded-sm bg-info [.team-1_&]:bg-[oklch(from_var(--info)_l_c_25)]"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      {team === 100
                        ? t('spectator')
                        : team === null
                          ? t('unknown')
                          : teamLabel(team)}
                      {(team === 0 || team === 1) && (localTeam === 0 || localTeam === 1) && (
                        <> · {t(team === localTeam ? 'friendlyTeam' : 'enemyTeam')}</>
                      )}
                    </span>
                  </h4>
                  <ul className="archive-card-players flex flex-col gap-2.5 [&>li]:grid [&>li]:grid-cols-[minmax(0,_1fr)_auto] [&>li]:items-baseline [&>li]:gap-2 [&_strong]:text-[0.9375rem] [&_strong]:font-[750] [&_strong]:tabular-nums">
                    {players.map((player) => (
                      <li key={player.id}>
                        <Button
                          type="button"
                          variant="link"
                          className="archive-card-player block w-full min-w-0 h-auto p-0 overflow-hidden text-inherit text-[length:inherit] leading-[inherit] font-[weight:inherit] text-left text-ellipsis whitespace-nowrap font-medium"
                          onClick={() =>
                            openModal({ type: 'profile', id: player.id, name: player.name })
                          }
                        >
                          {player.name || '#' + player.id}
                        </Button>
                        <strong title={t('ELO')}>
                          {formatMetric(player.newRating ?? player.oldRating, 0)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="archive-card-roster-empty py-[1rem_0.25rem] muted text-muted-foreground">
            {t('archiveRosterUnavailable')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
