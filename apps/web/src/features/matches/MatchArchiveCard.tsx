import type { Match } from '@ba/contracts';
import type { ReactNode } from 'react';
import { formatDelta, formatDuration, formatMetric, formatTime, outcomeTone } from '@ba/shared';
import { localizedTeamLabel } from '../../lib/team-label';
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
import { Badge as OutlineBadge } from '@/components/ui/badge';
import { useApp } from '../../app/state';
import { Badge, Button } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';

export function MatchArchiveCard({
  match,
  disabled = false,
  actions,
}: {
  match: Match;
  disabled?: boolean;
  actions?: ReactNode;
}) {
  const { openModal, notify } = useApp();
  const { t, locale } = useI18n();
  const localTeam = match.players.find((player) => player.id === match.localPlayerId)?.teamId;
  const eloDelta =
    match.eloBefore !== null && match.eloAfter !== null ? match.eloAfter - match.eloBefore : null;
  const at = match.endedAt ?? match.startedAt;

  return (
    <Card className="archive-card">
      <CardHeader>
        <CardTitle role="heading" aria-level={3} className="archive-card-title">
          <Button
            variant="link"
            className="archive-card-map"
            disabled={disabled}
            aria-describedby={disabled ? 'archive-updates-status' : undefined}
            onClick={() =>
              match.fid
                ? openModal({ type: 'match', fid: match.fid, accountId: match.localPlayerId })
                : notify(t('offline'))
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
        <CardAction className="archive-card-actions">
          <OutlineBadge variant="outline" aria-label={`${t('eloDelta')}: ${formatDelta(eloDelta)}`}>
            <span className={eloChangeClass(eloDelta)}>{formatDelta(eloDelta)}</span>
          </OutlineBadge>
          {actions}
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="archive-card-summary">
          <Badge
            tone={outcomeTone(match.outcome)}
            aria-label={`${t('result')}: ${t(match.restarted ? 'restarted' : match.outcome)}`}
          >
            {t(match.restarted ? 'restarted' : match.outcome)}
          </Badge>
          <dl>
            <div>
              <dt>{t('time')}</dt>
              <dd>
                {at === null ? (
                  t('matchTimeUnknown')
                ) : (
                  <time dateTime={new Date(at).toISOString()}>{formatTime(at, locale)}</time>
                )}
              </dd>
            </div>
            <div>
              <dt>{t('duration')}</dt>
              <dd>
                {match.durationSec === null
                  ? t('matchDurationUnknown')
                  : formatDuration(match.durationSec)}
              </dd>
            </div>
          </dl>
        </div>
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
                      {localizedTeamLabel(team, locale)}
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
                          disabled={disabled}
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
