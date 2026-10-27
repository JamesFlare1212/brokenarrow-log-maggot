import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw as faArrowsRotate } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { Match, Replay } from '@ba/contracts';
import {
  formatMetric,
  formatDelta,
  formatDuration,
  formatTime,
  teamLabel,
  outcomeTone,
  matchTitles,
} from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Dialog, Loading, Notice, Badge } from '../../components/ui';
import { TooltipButton } from '../../components/Tooltip';
import { MatchAwards } from './MatchAwards';
export function MatchDialog({ fid }: { fid: string }) {
  const { api, openModal, closeModal, backModal } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<Match>(),
    [replays, setReplays] = useState<Replay[]>([]);
  useEffect(() => {
    void request.load(() => api.invoke('matches.detail', { fid, force: false }));
    void api
      .invoke('replays.list', null)
      .then((list) => setReplays(list.filter((r) => r.fid === fid)));
  }, [api, fid]);
  const match = request.data;
  const titles = useMemo(() => (match ? (match.titles ?? matchTitles(match)) : {}), [match]);
  const columns = [
    'player',
    'ELO',
    'destruction',
    'losses',
    'objectives',
    'kills',
    'damage',
    'received',
    'D/L',
    'supply',
    'experience',
    'medals',
  ];
  return (
    <Dialog
      open
      onClose={closeModal}
      onBack={backModal}
      title={`${t('matchDetail')} · #${fid}`}
      className="dialog-wide match-dialog"
    >
      <div className="actions match-dialog-actions">
        <Button
          size="sm"
          disabled={request.pending}
          aria-busy={request.pending}
          onClick={() =>
            void request.load(() => api.invoke('matches.detail', { fid, force: true }), true)
          }
        >
          <Icon icon={faArrowsRotate} size={16} spin={request.pending} aria-hidden="true" />
          {t('refresh')}
        </Button>
        <Button
          size="sm"
          onClick={() =>
            void api.invoke('external.open', { url: `${BATRACE_ORIGIN}/match/${fid}` })
          }
        >
          {t('openBatrace')}
        </Button>
        {replays.map((r) => (
          <Button
            key={r.id}
            size="sm"
            onClick={() => openModal({ type: 'replay', id: r.id, title: r.uploaderName || r.map })}
          >
            {t('play')} · {r.uploaderName || teamLabel(r.teamId)}
          </Button>
        ))}
      </div>
      {request.pending && !match && <Loading />}
      {request.error && <Notice error>{request.error}</Notice>}
      {match && (
        <>
          {match.warning && <Notice>{match.warning}</Notice>}
          <div className="match-overview">
            <div className="match-overview-heading">
              <div className="match-map">
                <span className="muted">{t('map')}</span>
                <h3>{match.map || '—'}</h3>
              </div>
              <div className="match-overview-badges">
                <Badge tone={outcomeTone(match.outcome)}>{t(match.outcome)}</Badge>
                <Badge>{t(match.mode)}</Badge>
              </div>
            </div>
            <dl className="match-summary">
              <div>
                <dt>{t('duration')}</dt>
                <dd>{formatDuration(match.durationSec)}</dd>
              </div>
              <div>
                <dt>{t('eloDelta')}</dt>
                <dd>
                  {formatDelta(
                    match.eloAfter !== null && match.eloBefore !== null
                      ? match.eloAfter - match.eloBefore
                      : null,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t('account')}</dt>
                <dd>{match.localPersona || '—'}</dd>
              </div>
              <div>
                <dt>{t('time')}</dt>
                <dd>{formatTime(match.endedAt, locale)}</dd>
              </div>
            </dl>
          </div>
          {[match.winnerTeamId === 1 ? 1 : 0, match.winnerTeamId === 1 ? 0 : 1, 100, null].map(
            (team) => {
              const players = match.players.filter((p) => p.teamId === team);
              if (!players.length) return null;
              return (
                <section className={`match-team match-team-${team}`} key={String(team)}>
                  <div className="match-team-heading">
                    <h3>{teamLabel(team as 0 | 1 | 100 | null)}</h3>
                    <span className="muted">{t('playersCount', { n: players.length })}</span>
                  </div>
                  <div className="table-wrap match-team-table">
                    <Table>
                      <TableCaption className="sr-only">
                        {teamLabel(team as 0 | 1 | 100 | null)}
                      </TableCaption>
                      <colgroup>
                        <col className="match-player-column" />
                        <col className="match-rating-column" />
                        {columns.slice(2).map((column) => (
                          <col key={column} />
                        ))}
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          {columns.map((k) => (
                            <TableHead
                              scope="col"
                              key={k}
                              className={k === 'ELO' ? 'elo-column' : undefined}
                            >
                              {t(k)}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {players.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="match-player-cell">
                              <div className="match-player-heading">
                                <TooltipButton
                                  variant="link"
                                  className="player-name-button match-player-name"
                                  tooltip={`${p.name} · #${p.id}`}
                                  onClick={() =>
                                    openModal({ type: 'profile', id: p.id, name: p.name })
                                  }
                                >
                                  <span className="player-name">{p.name}</span>
                                </TooltipButton>
                                <MatchAwards
                                  key={`${match.id}:${p.id}`}
                                  titles={titles[p.id] ?? []}
                                  scoreLabels={
                                    match.endedAt !== null ? match.scoreLabels?.[p.id] : undefined
                                  }
                                />
                              </div>
                              <small className="player-id muted">#{p.id}</small>
                            </TableCell>
                            <TableCell className="elo-column">
                              {formatMetric(p.newRating)}{' '}
                              <small className="muted">
                                (
                                {formatDelta(
                                  p.newRating !== null && p.oldRating !== null
                                    ? p.newRating - p.oldRating
                                    : null,
                                )}
                                )
                              </small>
                            </TableCell>
                            {[
                              p.destructionScore,
                              p.lossesScore,
                              p.objectivesCaptured,
                              p.killed,
                              p.damageDealt,
                              p.damageReceived,
                              p.dlRatio,
                              p.supplyPoints,
                              p.exp,
                              p.medals,
                            ].map((value, i) => (
                              <TableCell key={i}>{formatMetric(value, i === 6 ? 2 : 0)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              );
            },
          )}
        </>
      )}
    </Dialog>
  );
}
