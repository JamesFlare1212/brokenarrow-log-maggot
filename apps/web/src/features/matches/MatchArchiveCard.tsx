import type { Match, TeamId } from '@ba/contracts';
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
import { Tooltip } from '@/components/Tooltip';

function ArchiveTeamTitle({ team, localTeam }: { team: TeamId; localTeam?: TeamId }) {
  const { t } = useI18n();
  return (
    <h4 className="archive-card-team-title flex items-center gap-2 mb-2.5 text-muted-foreground text-[0.875rem] font-semibold [&>span:last-child]:wrap-anywhere">
      {(team === 0 || team === 1) && (
        <span
          className="team-indicator w-0.75 h-3.5 shrink-0 rounded-sm bg-info [.team-1_&]:bg-[oklch(from_var(--info)_l_c_25)]"
          aria-hidden="true"
        />
      )}
      <span>
        {team === 100 ? t('spectator') : team === null ? t('unknown') : teamLabel(team)}
        {(team === 0 || team === 1) && (localTeam === 0 || localTeam === 1) && (
          <> · {t(team === localTeam ? 'friendlyTeam' : 'enemyTeam')}</>
        )}
      </span>
    </h4>
  );
}

export function MatchArchiveCardSkeleton({ match }: { match?: Match }) {
  const localTeam = match?.players.find((player) => player.id === match.localPlayerId)?.teamId;
  const { t } = useI18n();
  return (
    <Card
      className="archive-card [&_[data-slot='card-header']]:min-w-0 [&_[data-slot='card-header']]:gap-2"
      aria-hidden="true"
    >
      <CardHeader className="items-center">
        <CardTitle className="archive-card-title min-w-0 text-[1.125rem] leading-snug font-bold">
          <div className="flex min-h-[calc(1lh+2px)] items-center">
            <Skeleton className="h-5 w-36 max-w-full" />
          </div>
        </CardTitle>
        <CardDescription className="archive-card-meta col-start-1 flex flex-wrap items-center gap-1.5 wrap-anywhere">
          <div className="flex h-lh w-full items-center">
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
        </CardDescription>
        <CardDescription className="archive-card-time col-start-1">
          <div className="flex h-lh items-center">
            <Skeleton className="h-3 w-36 max-w-full" />
          </div>
        </CardDescription>
        <CardAction className="row-span-1 self-baseline">
          <Skeleton className="h-5 w-16" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Separator />
        {match?.players.length === 0 ? (
          <p className="archive-card-roster-empty py-[1rem_0.25rem] text-muted-foreground">
            {t('archiveRosterUnavailable')}
          </p>
        ) : (
          <div className="archive-card-teams grid grid-cols-2 gap-4 mt-4">
            {([0, 1, 100, null] as const).map((team) => {
              const count = match
                ? match.players.filter((p) => p.teamId === team).length
                : team === 0 || team === 1
                  ? 5
                  : 0;
              if (!count) return null;
              return (
                <section className={`archive-card-team min-w-0 team-${team}`} key={String(team)}>
                  <ArchiveTeamTitle team={team} localTeam={localTeam} />
                  <ul className="archive-card-players flex flex-col gap-2.5 [&>li]:grid [&>li]:grid-cols-[minmax(0,_1fr)_auto] [&>li]:items-baseline [&>li]:gap-2 [&_strong]:text-[0.9375rem] [&_strong]:font-[750] [&_strong]:tabular-nums">
                    {Array.from({ length: count }, (_, index) => (
                      <li key={index} className="min-h-[calc(1lh+2px)]">
                        <Skeleton className="h-3.5 w-28 max-w-full self-center" />
                        <Skeleton className="h-3.5 w-10 self-center" />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
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
            className="archive-card-map block h-auto w-full min-w-0 p-0 text-left text-inherit text-[length:inherit] leading-[inherit] font-[weight:inherit] whitespace-normal wrap-anywhere underline-offset-2"
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
                  <ArchiveTeamTitle team={team} localTeam={localTeam} />
                  <ul className="archive-card-players flex flex-col gap-2.5 [&>li]:grid [&>li]:grid-cols-[minmax(0,_1fr)_auto] [&>li]:items-baseline [&>li]:gap-2 [&_strong]:text-[0.9375rem] [&_strong]:font-[750] [&_strong]:tabular-nums">
                    {players.map((player) => (
                      <li key={player.id}>
                        <Button
                          type="button"
                          variant="link"
                          className="archive-card-player block h-auto w-full min-w-0 p-0 text-left text-[length:inherit] leading-[inherit] font-medium text-inherit underline-offset-2"
                          onClick={() =>
                            openModal({ type: 'profile', id: player.id, name: player.name })
                          }
                        >
                          <span className="block truncate">{player.name || '#' + player.id}</span>
                        </Button>
                        <Tooltip content={t('ELO')}>
                          <strong tabIndex={0}>
                            {formatMetric(player.newRating ?? player.oldRating, 0)}
                          </strong>
                        </Tooltip>
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
