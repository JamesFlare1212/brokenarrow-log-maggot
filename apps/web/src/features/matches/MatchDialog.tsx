import { BATRACE_ORIGIN } from '@ba/contracts';
import { useEffect, useState } from 'react';
import type { Match, Replay } from '@ba/contracts';
import {
  formatMetric,
  formatDelta,
  formatDuration,
  formatTime,
  teamLabel,
  outcomeTone,
} from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Dialog, Loading, Notice, Stats, Badge } from '../../components/ui';
export function MatchDialog({ fid }: { fid: string }) {
  const { api, openModal, closeModal } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<Match>(),
    [replays, setReplays] = useState<Replay[]>([]);
  useEffect(() => {
    void request.load(() => api.invoke('matches.detail', { fid, force: false }));
    void api
      .invoke('replays.list', null)
      .then((list) => setReplays(list.filter((r) => r.fid === fid)));
  }, [api, fid]);
  const match = request.data,
    columns = [
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
      title={`${t('matchDetail')} · #${fid}`}
      className="dialog-wide"
    >
      <div className="actions">
        <Button
          disabled={request.pending}
          onClick={() =>
            void request.load(() => api.invoke('matches.detail', { fid, force: true }), true)
          }
        >
          {t('refresh')}
        </Button>
        <Button
          onClick={() =>
            void api.invoke('external.open', { url: `${BATRACE_ORIGIN}/match/${fid}` })
          }
        >
          {t('openBatrace')}
        </Button>
        {replays.map((r) => (
          <Button
            key={r.id}
            onClick={() => openModal({ type: 'replay', id: r.id, title: r.uploaderName || r.map })}
          >
            {t('play')} · {r.uploaderName || teamLabel(r.teamId)}
          </Button>
        ))}
      </div>
      {request.pending && <Loading />}
      {request.error && <Notice error>{request.error}</Notice>}
      {match && (
        <>
          {match.warning && <Notice>{match.warning}</Notice>}
          <Stats
            items={[
              { label: t('map'), value: match.map || '—' },
              {
                label: t('result'),
                value: <Badge tone={outcomeTone(match.outcome)}>{t(match.outcome)}</Badge>,
              },
              { label: t('mode'), value: t(match.mode) },
              { label: t('duration'), value: formatDuration(match.durationSec) },
              {
                label: t('eloDelta'),
                value: formatDelta(
                  match.eloAfter !== null && match.eloBefore !== null
                    ? match.eloAfter - match.eloBefore
                    : null,
                ),
              },
              { label: t('account'), value: match.localPersona || '—' },
              { label: t('time'), value: formatTime(match.endedAt, locale) },
            ]}
          />
          {[match.winnerTeamId === 1 ? 1 : 0, match.winnerTeamId === 1 ? 0 : 1, 100, null].map(
            (team) => {
              const players = match.players.filter((p) => p.teamId === team);
              if (!players.length) return null;
              return (
                <section key={String(team)}>
                  <h3>{teamLabel(team as 0 | 1 | 100 | null)}</h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {columns.map((k) => (
                            <th key={k} className={k === 'ELO' ? 'elo-column' : undefined}>
                              {t(k)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {players.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <Button
                                onClick={() =>
                                  openModal({ type: 'profile', id: p.id, name: p.name })
                                }
                              >
                                {p.name}
                              </Button>
                              <small className="muted">#{p.id}</small>
                            </td>
                            <td className="elo-column">
                              {formatMetric(p.newRating)}{' '}
                              <small>
                                (
                                {formatDelta(
                                  p.newRating !== null && p.oldRating !== null
                                    ? p.newRating - p.oldRating
                                    : null,
                                )}
                                )
                              </small>
                            </td>
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
                              <td key={i}>{formatMetric(value, i === 6 ? 2 : 0)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
