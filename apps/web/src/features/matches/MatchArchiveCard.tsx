import type { Match } from '@ba/contracts';
import { formatDelta, formatMetric, teamLabel } from '@ba/shared';
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
import { Button } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { Skeleton } from '@/components/ui/skeleton';

export function MatchArchiveCardSkeleton() {
  return (
    <Card className="archive-card" aria-hidden="true">
      <CardHeader>
        <CardTitle className="archive-card-title">
          <Skeleton className="h-7 w-36" />
        </CardTitle>
        <CardDescription className="archive-card-meta">
          <Skeleton className="h-4 w-48" />
        </CardDescription>
        <CardAction>
          <Skeleton className="h-6 w-16" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Separator />
        <div className="archive-card-teams">
          {[0, 1].map((team) => (
            <section className="archive-card-team" key={team}>
              <h4 className="archive-card-team-title">
                <Skeleton className="h-4 w-24" />
              </h4>
              <ul className="archive-card-players">
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

export function MatchArchiveCard({ match }: { match: Match }) {
  const { openModal, notify } = useApp();
  const { t } = useI18n();
  const localTeam = match.players.find((player) => player.id === match.localPlayerId)?.teamId;
  const eloDelta =
    match.eloBefore !== null && match.eloAfter !== null ? match.eloAfter - match.eloBefore : null;

  return (
    <Card className="archive-card">
      <CardHeader>
        <CardTitle role="heading" aria-level={3} className="archive-card-title">
          <Button
            variant="link"
            className="archive-card-map"
            onClick={() =>
              match.fid ? openModal({ type: 'match', fid: match.fid }) : notify(t('offline'))
            }
          >
            {match.map || '#' + match.id}
          </Button>
        </CardTitle>
        <CardDescription className="archive-card-meta">
          <span>#{match.fid || match.id}</span>
          <span aria-hidden="true">·</span>
          <span>{t(match.mode)}</span>
          <span aria-hidden="true">·</span>
          <span>{t('playersCount', { n: match.players.length })}</span>
        </CardDescription>
        <CardAction>
          <Badge variant="outline" aria-label={`${t('eloDelta')}: ${formatDelta(eloDelta)}`}>
            <span className={eloChangeClass(eloDelta)}>{formatDelta(eloDelta)}</span>
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Separator />
        {match.players.length ? (
          <div className="archive-card-teams">
            {([0, 1, 100, null] as const).map((team) => {
              const players = match.players.filter((player) => player.teamId === team);
              if (!players.length) return null;
              return (
                <section className={`archive-card-team team-${team}`} key={String(team)}>
                  <h4 className="archive-card-team-title">
                    {(team === 0 || team === 1) && (
                      <span className="team-indicator" aria-hidden="true" />
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
                  <ul className="archive-card-players">
                    {players.map((player) => (
                      <li key={player.id}>
                        <Button
                          variant="link"
                          className="archive-card-player"
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
          <p className="archive-card-roster-empty muted">{t('archiveRosterUnavailable')}</p>
        )}
      </CardContent>
    </Card>
  );
}
