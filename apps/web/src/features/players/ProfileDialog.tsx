import { BATRACE_ORIGIN } from '@ba/contracts';
import { useEffect } from 'react';
import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatTime, formatMetric, formatDelta } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Button, Loading, Notice, Stats, Badge } from '../../components/ui';
import { ReportView, MaggotView, MaggotProgress } from './Reports';
export function ProfileDialog({ id, name }: { id: string; name: string }) {
  const { api, closeModal, openModal, maggot, runMaggot } = useApp(),
    { t, locale } = useI18n(),
    profile = useRequest<PlayerProfile>(),
    report = useRequest<PlayerReport>();
  const load = (force = false) =>
    Promise.all([
      profile.load(() => api.invoke('players.profile', { id, force })),
      report.load(() => api.invoke('players.report', { id, force })),
    ]);
  useEffect(() => {
    void load();
  }, [id, api]);
  const p = profile.data,
    encounters = p?.encounters || [],
    same = encounters.filter((e) => e.relation === 'same'),
    opponent = encounters.filter((e) => e.relation === 'opponent');
  return (
    <Dialog open onClose={closeModal} title={`${name} · #${id}`} className="dialog-wide">
      <div className="actions">
        <Button onClick={() => void load(true)} disabled={profile.pending || report.pending}>
          {t('refresh')}
        </Button>
        <Button
          onClick={() =>
            void api.invoke('external.open', { url: `${BATRACE_ORIGIN}/player/${id}` })
          }
        >
          {t('openBatrace')}
        </Button>
        <Button variant="primary" disabled={maggot.busy} onClick={() => void runMaggot(id)}>
          {t('maggot')}
        </Button>
      </div>
      {profile.pending && <Loading />}
      {profile.error && <Notice error>{profile.error}</Notice>}
      {p && (
        <>
          <div className="section-heading">
            <h3>{p.name}</h3>
            {p.banned && <Badge tone="danger">{t('banned')}</Badge>}
          </div>
          <Stats
            items={[
              { label: 'ELO', value: formatMetric(p.latestElo, 0) },
              { label: t('encounters'), value: encounters.length },
              { label: t('same'), value: same.length },
              { label: t('opponent'), value: opponent.length },
              { label: t('win'), value: same.filter((e) => e.won === true).length },
              { label: t('loss'), value: same.filter((e) => e.won === false).length },
            ]}
          />
          {p.info?.stale && (
            <Notice>
              {t('stale')} · {formatTime(p.info.updatedAt, locale)}
            </Notice>
          )}
          {p.info && !report.data && (
            <>
              <Stats
                items={[
                  { label: 'ELO', value: formatMetric(p.info.elo, 0) },
                  { label: t('latestKd'), value: formatMetric(p.info.kd) },
                  {
                    label: t(p.info.fallback ? 'winRate' : 'recentWinRate'),
                    value: formatMetric(p.info.winRate, 0) + '%',
                  },
                  { label: t('totalMatches'), value: p.info.matchCount },
                  { label: t('samples'), value: p.info.sampleCount ?? '—' },
                ]}
              />
              <div className="report-tags">
                <Badge>{p.info.category || '—'}</Badge>
                <span>{p.info.topUnits}</span>
              </div>
            </>
          )}
          <div className="profile-columns">
            <section>
              <h3>{t('recent')}</h3>
              {p.recentError && <Notice error>{p.recentError}</Notice>}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('map')}</th>
                      <th>{t('result')}</th>
                      <th>ELO</th>
                      <th>{t('time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.recentMatches.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <Button onClick={() => openModal({ type: 'match', fid: m.fid || m.id })}>
                            {m.map || '#' + m.id}
                          </Button>
                        </td>
                        <td>{t(m.outcome)}</td>
                        <td>
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
            </section>
            <section>
              <h3>{t('encounters')}</h3>
              <div className="table-wrap">
                <table>
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
          </div>
          <h3>{t('names')}</h3>
          <div className="name-history">
            {p.names.map((n) => (
              <Badge key={n.name}>
                {n.name} · {formatTime(n.lastSeen, locale)}
              </Badge>
            ))}
          </div>
        </>
      )}
      {report.pending && <Loading />}
      {report.error && <Notice error>{report.error}</Notice>}
      {report.data && <ReportView report={report.data} />}
      <MaggotProgress />
      {maggot.id === id && maggot.error && <Notice error>{maggot.error}</Notice>}
      {maggot.id === id && maggot.data && <MaggotView report={maggot.data} />}
    </Dialog>
  );
}
