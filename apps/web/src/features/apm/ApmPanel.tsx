import { Activity } from 'lucide-react';
import { formatDuration, formatMetric } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Card, Stats, Notice, Badge } from '../../components/ui';
export function ApmPanel() {
  const { state, patchConfig } = useApp(),
    { t } = useI18n(),
    apm = state.apm,
    collapsed = state.config.collapsedPanels.includes('apm'),
    peak = Math.max(1, ...apm.perMinute);
  return (
    <Card
      title={t('apm')}
      icon={<Activity size={19} />}
      collapsed={collapsed}
      onToggle={() =>
        void patchConfig({
          collapsedPanels: collapsed
            ? state.config.collapsedPanels.filter((p) => p !== 'apm')
            : [...state.config.collapsedPanels, 'apm'],
        })
      }
    >
      {apm.status === 'disabled' ? (
        <Notice>{t('apmDisabled')}</Notice>
      ) : apm.status === 'unavailable' ? (
        <Notice error>{t('apmUnavailable')}</Notice>
      ) : apm.status === 'replay' ? (
        <Notice>{t('apmReplay')}</Notice>
      ) : (
        <>
          <Stats
            items={[
              { label: 'APM', value: formatMetric(apm.apm, 1) },
              { label: t('totalActions'), value: apm.totalActions },
              { label: t('duration'), value: formatDuration(apm.durationSec) },
              { label: t('peak'), value: apm.peak },
            ]}
          />
          <Badge tone={apm.focused ? 'success' : 'muted'}>
            {t(apm.focused ? 'focused' : 'notFocused')}
          </Badge>
          <div
            className="apm-chart"
            role="img"
            aria-label={`${t('apm')}: ${apm.perMinute.join(', ')}`}
          >
            {apm.perMinute.map((value, index) => (
              <div className="apm-bar-wrap" key={index}>
                <span>{value}</span>
                <div className="apm-bar" style={{ height: `${(value / peak) * 120}px` }} />
                <small>{index + 1}</small>
              </div>
            ))}
          </div>
          <details>
            <summary>{t('apm')}</summary>
            <table>
              <thead>
                <tr>
                  <th>{t('time')}</th>
                  <th>{t('totalActions')}</th>
                </tr>
              </thead>
              <tbody>
                {apm.perMinute.map((value, index) => (
                  <tr key={index}>
                    <td>{index + 1} min</td>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </Card>
  );
}
