import { BATRACE_ORIGIN } from '@ba/contracts';
import { useEffect } from 'react';
import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatTime, formatMetric, formatDelta, outcomeTone } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Button, Loading, Notice, Stats, Badge } from '../../components/ui';
import { ReportView, ReportCopyButton, MaggotView, MaggotProgress } from './Reports';
export function ProfileDialog({ id, name }: { id: string; name: string }) {
  const { api, closeModal, backModal, openModal, maggot, runMaggot } = useApp(),
    { t, locale } = useI18n(),
    profile = useRequest<PlayerProfile>(),
    report = useRequest<PlayerReport>();
  const load = (force = false) =>
    Promise.all([
      profile.load(() => api.invoke('players.profile', { id, force }), true),
      report.load(() => api.invoke('players.report', { id, force }), true),
    ]);
  useEffect(() => {
    void load();
  }, [id, api]);
  const p = profile.data,
    encounters = p?.encounters || [],
    same = encounters.filter((e) => e.relation === 'same'),
    opponent = encounters.filter((e) => e.relation === 'opponent'),
    aliases = p?.names.filter((entry) => entry.name !== p.name) || [];
  return (
    <Dialog
      open
      onClose={closeModal}
      onBack={backModal}
      title={`${p?.name || report.data?.name || name} · #${id}`}
      className="dialog-wide profile-dialog"
    >
      <div className="profile-toolbar">
        <div className="actions">
          <Button
            onClick={() => void load(true)}
            disabled={profile.pending || report.pending}
            aria-busy={profile.pending || report.pending}
          >
            <Icon
              icon={faArrowsRotate}
              size={16}
              spin={profile.pending || report.pending}
              aria-hidden="true"
            />
            {t('refresh')}
          </Button>
          <Button
            onClick={() =>
              void api.invoke('external.open', { url: `${BATRACE_ORIGIN}/player/${id}` })
            }
          >
            {t('openBatrace')}
          </Button>
          {report.data && <ReportCopyButton report={report.data} />}
          <Button variant="primary" disabled={maggot.busy} onClick={() => void runMaggot(id)}>
            {t('maggot')}
          </Button>
        </div>
        {p?.banned && <Badge tone="danger">{t('banned')}</Badge>}
      </div>
      {((profile.pending && !p) || (report.pending && !report.data)) && <Loading />}
      {profile.error && <Notice error>{profile.error}</Notice>}
      {report.error && <Notice error>{report.error}</Notice>}
      {report.data && <ReportView report={report.data} embedded />}
      {report.error && !report.data && p && (
        <>
          <Stats
            items={
              p.info
                ? [
                    { label: 'ELO', value: formatMetric(p.info.elo, 0) },
                    { label: t('latestKd'), value: formatMetric(p.info.kd) },
                    {
                      label: t(p.info.fallback ? 'winRate' : 'recentWinRate'),
                      value: formatMetric(p.info.winRate, 0) + '%',
                    },
                    { label: t('totalMatches'), value: p.info.matchCount },
                    { label: t('samples'), value: p.info.sampleCount ?? '—' },
                  ]
                : [{ label: 'ELO', value: formatMetric(p.latestElo, 0) }]
            }
          />
          {p.info && (p.info.category || p.info.topUnits) && (
            <div className="report-tags">
              {p.info.category && <Badge>{p.info.category}</Badge>}
              {p.info.topUnits && <span>{p.info.topUnits}</span>}
            </div>
          )}
        </>
      )}
      {p && (
        <>
          {!report.data && p.info?.stale && (
            <Notice>
              {t('stale')} · {formatTime(p.info.updatedAt, locale)}
            </Notice>
          )}
          <div className="profile-columns">
            {(p.recentMatches.length > 0 || p.recentError) && (
              <section>
                <h3>{t('recent')}</h3>
                {p.recentError && <Notice error>{p.recentError}</Notice>}
                {p.recentMatches.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <caption className="sr-only">{t('recent')}</caption>
                      <thead>
                        <tr>
                          <th>{t('map')}</th>
                          <th>{t('result')}</th>
                          <th className="elo-column">{t('eloDelta')}</th>
                          <th>{t('time')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.recentMatches.map((m) => (
                          <tr key={m.id}>
                            <td>
                              <Button
                                onClick={() => openModal({ type: 'match', fid: m.fid || m.id })}
                              >
                                {m.map || '#' + m.id}
                              </Button>
                            </td>
                            <td>
                              <Badge tone={outcomeTone(m.outcome)}>{t(m.outcome)}</Badge>
                            </td>
                            <td
                              className={
                                m.eloAfter === null || m.eloBefore === null
                                  ? 'elo-column'
                                  : m.eloAfter >= m.eloBefore
                                    ? 'elo-column text-success'
                                    : 'elo-column text-danger'
                              }
                            >
                              {formatDelta(
                                m.eloAfter !== null && m.eloBefore !== null
                                  ? m.eloAfter - m.eloBefore
                                  : null,
                              )}
                            </td>
                            <td>{formatTime(m.endedAt, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
            {encounters.length > 0 && (
              <section>
                <h3>{t('encounters')}</h3>
                <div className="profile-encounter-summary">
                  <Stats
                    items={[
                      { label: t('encounters'), value: encounters.length },
                      { label: t('same'), value: same.length },
                      { label: t('opponent'), value: opponent.length },
                      { label: t('win'), value: same.filter((e) => e.won === true).length },
                      { label: t('loss'), value: same.filter((e) => e.won === false).length },
                    ]}
                  />
                </div>
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">{t('encounters')}</caption>
                    <thead>
                      <tr>
                        <th>{t('map')}</th>
                        <th>{t('team')}</th>
                        <th>{t('result')}</th>
                        <th>{t('time')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {encounters.map((e, i) => (
                        <tr key={e.matchId + ':' + i}>
                          <td>
                            <Button onClick={() => openModal({ type: 'match', fid: e.matchId })}>
                              {e.map || e.matchId}
                            </Button>
                          </td>
                          <td>{t(e.relation)}</td>
                          <td>
                            {e.won === null ? t('unknown') : t(e.won ? 'win' : 'loss')}{' '}
                            {e.custom && <Badge>{t('custom')}</Badge>}
                          </td>
                          <td>{formatTime(e.at, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
          {aliases.length > 0 && (
            <details className="profile-name-history">
              <summary>
                {t('names')} <Badge>{aliases.length}</Badge>
              </summary>
              <div className="name-history">
                {aliases.map((n) => (
                  <span className="profile-alias" key={n.name}>
                    <strong>{n.name}</strong>
                    <small>{formatTime(n.lastSeen, locale)}</small>
                  </span>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      <MaggotProgress id={id} />
      {maggot.id === id && maggot.error && <Notice error>{maggot.error}</Notice>}
      {maggot.id === id && maggot.data && <MaggotView report={maggot.data} />}
    </Dialog>
  );
}
