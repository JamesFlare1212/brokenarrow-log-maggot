import { BATRACE_ORIGIN } from '@ba/contracts';
import type { MaggotReport, PlayerReport } from '@ba/contracts';
import { formatMetric, formatDelta, formatTime } from '@ba/shared';
import { Badge, Button, Notice, Stats } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { useApp } from '../../app/state';
export function ReportView({ report }: { report: PlayerReport }) {
  const { t, locale } = useI18n(),
    { api, openModal, notify, maggot, runMaggot } = useApp();
  return (
    <div className="report">
      <div className="section-heading">
        <h3>
          {report.name} <small>#{report.id}</small>
        </h3>
        <div className="actions">
          <Button onClick={() => openModal({ type: 'profile', id: report.id, name: report.name })}>
            {t('investigate')}
          </Button>
          <Button
            disabled={maggot.busy}
            variant="primary"
            onClick={() => void runMaggot(report.id)}
          >
            {t('maggot')}
          </Button>
          <Button
            onClick={() =>
              void navigator.clipboard
                .writeText(
                  `${report.name} · ELO ${formatMetric(report.elo, 0)} · ${t(report.fallback ? 'winRate' : 'recentWinRate')} ${formatMetric(report.winRate, 0)}% (${report.sampleCount}) · ${report.favUnits.map((u) => u.name).join(', ')}`,
                )
                .then(() => notify(t('copied')))
                .catch((e) => notify(String(e), true))
            }
          >
            {t('copy')}
          </Button>
        </div>
      </div>
      {report.stale && (
        <Notice>
          {t('stale')} · {formatTime(report.updatedAt, locale)}
        </Notice>
      )}
      <Stats
        items={[
          { label: 'ELO', value: formatMetric(report.elo, 0) },
          { label: t('latestKd'), value: formatMetric(report.kd) },
          { label: t('latestDmr'), value: formatMetric(report.dmr) },
          {
            label: t(report.fallback ? 'winRate' : 'recentWinRate'),
            value: formatMetric(report.winRate, 0) + '%',
          },
          { label: t('totalMatches'), value: report.matchCount },
          { label: t('samples'), value: report.sampleCount },
        ]}
      />
      <div className="report-tags">
        <span>{t('preference')}</span>
        {report.categories.map((c) => (
          <Badge key={c.key}>
            {t('cat.' + c.key.toLowerCase()) === 'cat.' + c.key.toLowerCase()
              ? c.key
              : t('cat.' + c.key.toLowerCase())}{' '}
            {formatMetric(c.pct, 0)}%
          </Badge>
        ))}
        <span>{t('units')}</span>
        {report.favUnits.map((u) => (
          <Badge key={u.name}>
            {u.name} · {formatMetric(u.value, 0)}
          </Badge>
        ))}
        {report.style && (
          <Badge>
            {t('style')}:{' '}
            {t('style.' + report.style.toLowerCase()) === 'style.' + report.style.toLowerCase()
              ? report.style
              : t('style.' + report.style.toLowerCase())}
          </Badge>
        )}
      </div>
      <div className="report-tags">
        {report.mapStats.map((m) => (
          <Badge key={m.mapId ?? m.name}>
            {m.name} · {formatMetric(m.winRate, 0)}% ({m.matchCount})
          </Badge>
        ))}
      </div>
      {!!report.recentMatches.length && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t('recent')}</caption>
            <thead>
              <tr>
                {[
                  'matchId',
                  'result',
                  'eloDelta',
                  'K/D',
                  'DMR',
                  'destruction',
                  'losses',
                  'objectives',
                  'time',
                ].map((k) => (
                  <th key={k} className={k === 'eloDelta' ? 'elo-column' : undefined}>
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.recentMatches.map((m) => (
                <tr key={m.matchId}>
                  <td>
                    <Button onClick={() => openModal({ type: 'match', fid: m.matchId })}>
                      #{m.matchId}
                    </Button>
                  </td>
                  <td>
                    <Badge tone={m.won === true ? 'success' : m.won === false ? 'danger' : 'muted'}>
                      {m.won === null ? t('unknown') : m.won ? t('win') : t('loss')}
                    </Badge>
                  </td>
                  <td className="elo-column">{formatDelta(m.eloDelta)}</td>
                  <td>{formatMetric(m.kd)}</td>
                  <td>{formatMetric(m.dmr)}</td>
                  <td>{formatMetric(m.destruction, 0)}</td>
                  <td>{formatMetric(m.losses, 0)}</td>
                  <td>{formatMetric(m.objectives, 0)}</td>
                  <td>{formatTime(m.endTime, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button
        onClick={() =>
          void api
            .invoke('external.open', { url: `${BATRACE_ORIGIN}/player/${report.id}` })
            .catch((e) => notify(String(e), true))
        }
      >
        {t('openBatrace')}
      </Button>
    </div>
  );
}
export function MaggotView({ report }: { report: MaggotReport }) {
  const { t } = useI18n(),
    { openModal } = useApp();
  const rankAverage = (key: 'killRank' | 'lossRank' | 'kdRank') => {
    const values = report.rows.map((r) => r[key]).filter((v): v is number => v !== null);
    return values.length ? formatMetric(values.reduce((s, n) => s + n, 0) / values.length, 1) : '—';
  };
  return (
    <div className="maggot-report">
      <h3>
        {t('maggot')} · #{report.id}
      </h3>
      {!report.complete && <Notice>{t('partialMaggot', { n: report.rows.length })}</Notice>}
      <Stats
        items={[
          {
            label: t('maggot'),
            value: (
              <span
                className={
                  report.index === null
                    ? ''
                    : report.index <= 3.5
                      ? 'text-success'
                      : report.index <= 7
                        ? 'text-warning'
                        : 'text-danger'
                }
              >
                {formatMetric(report.index, 1)}
              </span>
            ),
          },
          { label: t('averageRank'), value: formatMetric(report.averageRank) },
          { label: t('trend'), value: t(report.trend) },
          { label: t('calls'), value: report.calls },
          { label: t('kills'), value: rankAverage('killRank') },
          { label: t('losses'), value: rankAverage('lossRank') },
          { label: 'K/D', value: rankAverage('kdRank') },
        ]}
      />
      <div className="table-wrap">
        <table>
          <caption className="sr-only">{t('maggot')}</caption>
          <thead>
            <tr>
              {['matchId', 'result', 'MVP', 'kills', 'losses', 'K/D', 'eloDelta'].map((k) => (
                <th key={k} className={k === 'eloDelta' ? 'elo-column' : undefined}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.matchId}>
                <td>
                  <Button onClick={() => openModal({ type: 'match', fid: r.matchId })}>
                    #{r.matchId}
                  </Button>
                </td>
                <td>{r.won === null ? t('unknown') : t(r.won ? 'win' : 'loss')}</td>
                <td>{formatMetric(r.mvpRank, 1)}</td>
                <td>{formatMetric(r.killRank, 1)}</td>
                <td>{formatMetric(r.lossRank, 1)}</td>
                <td>{formatMetric(r.kdRank, 1)}</td>
                <td className="elo-column">{formatDelta(r.eloDelta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function MaggotProgress({ id }: { id?: string } = {}) {
  const { state, maggot } = useApp(),
    { t } = useI18n();
  if (!maggot.busy || (id && maggot.id !== id)) return null;
  const progress =
    state.maggotProgress?.requestId === maggot.requestId ? state.maggotProgress : null;
  return (
    <div className="progress" role="status">
      <span>
        {t('maggot')} · {progress?.done ?? 0}/12 · #{maggot.id}
      </span>
      <progress max={12} value={progress?.done ?? 0} />
    </div>
  );
}
