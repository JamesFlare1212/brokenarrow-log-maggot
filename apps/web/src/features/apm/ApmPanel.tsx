import { useEffect, useId, useState } from 'react';
import { faWaveSquare } from '@fortawesome/free-solid-svg-icons';
import type { ApmState } from '@ba/contracts';
import { Icon } from '../../components/Icon';
import { formatDuration, formatMetric, formatTime } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Card, Empty, Stats, Notice, Badge } from '../../components/ui';
import { ApmChart } from './ApmChart';

function ApmMetrics({ apm }: { apm: ApmState }) {
  const { t } = useI18n(),
    legacy = apm.perSecond === undefined,
    windowSec = legacy ? 60 : 10,
    counts = legacy
      ? apm.perMinute
      : Array.from({ length: Math.ceil(apm.perSecond!.length / 10) }, (_, index) =>
          apm.perSecond!.slice(index * 10, (index + 1) * 10).reduce((sum, count) => sum + count, 0),
        ),
    bucketSeconds = (index: number) =>
      Math.min(windowSec, Math.max(0, apm.durationSec - index * windowSec));
  return (
    <div className="apm-metrics">
      {apm.status === 'unavailable' && <Notice error>{t('apmUnavailable')}</Notice>}
      {apm.partial && <Notice>{t('apmPartial')}</Notice>}
      {apm.interrupted && <Notice>{t('apmInterrupted')}</Notice>}
      <div className="actions apm-context">
        <Badge tone={apm.status === 'active' && apm.focused ? 'success' : 'muted'}>
          {t(apm.status === 'active' ? (apm.focused ? 'focused' : 'notFocused') : 'apmStopped')}
        </Badge>
        {apm.fid && <span>#{apm.fid}</span>}
        {apm.map && <span>{apm.map}</span>}
      </div>
      <Stats
        items={[
          { label: t('apmAverage'), value: formatMetric(apm.apm, 1) },
          {
            label: t(legacy ? 'apmCurrentLegacy' : 'apmCurrent'),
            value: apm.currentApm === null ? '—' : formatMetric(apm.currentApm, 1),
          },
          {
            label: t(legacy ? 'apmPeakLegacy' : 'apmPeak'),
            value: apm.durationSec < windowSec ? '—' : formatMetric(apm.peak, 1),
          },
          { label: t('totalActions'), value: apm.totalActions },
          { label: t('apmCaptureDuration'), value: formatDuration(apm.durationSec) },
          { label: t('apmFocusedDuration'), value: formatDuration(apm.focusedDurationSec) },
          {
            label: t('apmMatchDuration'),
            value: apm.matchDurationSec === null ? '—' : formatDuration(apm.matchDurationSec),
          },
        ]}
      />
      {!legacy && apm.status === 'active' && apm.durationSec < windowSec && (
        <Notice>{t('apmWarmup')}</Notice>
      )}
      {counts.length > 0 && (
        <>
          <ApmChart
            key={apm.captureId}
            counts={counts}
            bucketSec={windowSec}
            durationSec={apm.durationSec}
            title={t(legacy ? 'apmBucketsLegacy' : 'apmBuckets')}
          />
          {counts.some((_, index) => bucketSeconds(index) < windowSec) && (
            <p className="muted">{t('apmPartialBucket')}</p>
          )}
          <details>
            <summary>{t('apmBucketTable')}</summary>
            <table>
              <thead>
                <tr>
                  <th>{t('time')}</th>
                  <th>{t('apmCaptureDuration')}</th>
                  <th>{t('totalActions')}</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((value, index) => (
                  <tr key={index}>
                    <td>
                      {formatDuration(index * windowSec)}–
                      {formatDuration(index * windowSec + bucketSeconds(index))}
                      {bucketSeconds(index) < windowSec ? ' *' : ''}
                    </td>
                    <td>{formatDuration(bucketSeconds(index))}</td>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      <div className="apm-notes">
        <p className="muted">{t('apmDefinition')}</p>
        {!legacy && <p className="muted">{t('apmWindowDefinition')}</p>}
        {legacy && <Notice>{t('apmLegacyData')}</Notice>}
      </div>
    </div>
  );
}

export function ApmPanel({ standalone = false }: { standalone?: boolean }) {
  const { state, api, patchConfig, openSettings } = useApp(),
    { t, locale } = useI18n(),
    [history, setHistory] = useState<ApmState[]>([]),
    [selected, setSelected] = useState(''),
    [historyError, setHistoryError] = useState(false),
    [reload, setReload] = useState(0),
    historyId = useId(),
    apm = history.find((capture) => capture.captureId === selected) ?? state.apm,
    collapsed = state.config.collapsedPanels.includes('apm');
  useEffect(() => {
    let cancelled = false;
    setHistoryError(false);
    void api.invoke('apm.history', null).then(
      (values) => {
        if (!cancelled) setHistory(values);
      },
      () => {
        if (!cancelled) setHistoryError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, state.apm.captureId, state.apm.status, reload]);
  const content = (
    <>
      {historyError && (
        <Notice error>
          {t('apmHistoryError')}{' '}
          <Button onClick={() => setReload((value) => value + 1)}>{t('retry')}</Button>
        </Notice>
      )}
      {history.length > 0 && (
        <div className="apm-history">
          <label htmlFor={historyId}>{t('apmHistory')}</label>
          <select
            id={historyId}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">{t('apmLatest')}</option>
            {history
              .filter((capture) => capture.captureId !== state.apm.captureId)
              .map((capture) => (
                <option value={capture.captureId!} key={capture.captureId}>
                  {formatTime(capture.startedAt, locale)} · {capture.map || '—'}
                  {capture.fid ? ` · #${capture.fid}` : ''}
                  {capture.partial ? ` · ${t('apmPartialLabel')}` : ''}
                </option>
              ))}
          </select>
        </div>
      )}
      {apm.captureId ? (
        <ApmMetrics apm={apm} />
      ) : !state.config.inputHookEnabled ? (
        <Empty
          icon={<Icon icon={faWaveSquare} size={30} />}
          description={t('apmDescription')}
          action={
            <Button variant="primary" onClick={() => openSettings('automation')}>
              {t('settings')}
            </Button>
          }
        >
          {t('apmDisabled')}
        </Empty>
      ) : apm.status === 'unavailable' ? (
        <Notice error>{t('apmUnavailable')}</Notice>
      ) : (
        <Empty description={t('apmDescription')}>{t('apmWaiting')}</Empty>
      )}
    </>
  );
  if (standalone) {
    return (
      <section className="apm-panel" aria-label={t('apm')}>
        {content}
      </section>
    );
  }
  return (
    <Card
      title={t('apm')}
      icon={<Icon icon={faWaveSquare} size={19} />}
      collapsed={collapsed}
      onToggle={() =>
        void patchConfig({
          collapsedPanels: collapsed
            ? state.config.collapsedPanels.filter((p) => p !== 'apm')
            : [...state.config.collapsedPanels, 'apm'],
        })
      }
    >
      {content}
    </Card>
  );
}
