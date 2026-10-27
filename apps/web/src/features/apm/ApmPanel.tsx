import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { Activity as faWaveSquare } from 'lucide-react';
import type { ApmState } from '@ba/contracts';
import { Icon } from '../../components/Icon';
import { formatDuration, formatMetric, formatTime } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Card, Empty, Stats, Notice, Badge, Field } from '../../components/ui';
import { Skeleton } from '@/components/ui/skeleton';

const ApmChart = lazy(() => import('./ApmChart').then((module) => ({ default: module.ApmChart })));

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
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ApmChart
              key={apm.captureId}
              counts={counts}
              bucketSec={windowSec}
              durationSec={apm.durationSec}
              title={t(legacy ? 'apmBucketsLegacy' : 'apmBuckets')}
            />
          </Suspense>
          {counts.some((_, index) => bucketSeconds(index) < windowSec) && (
            <p className="muted">{t('apmPartialBucket')}</p>
          )}
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
          <Field id={historyId} label={t('apmHistory')}>
            <NativeSelect
              id={historyId}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <NativeSelectOption value="">{t('apmLatest')}</NativeSelectOption>
              {history
                .filter((capture) => capture.captureId !== state.apm.captureId)
                .map((capture) => (
                  <NativeSelectOption value={capture.captureId!} key={capture.captureId}>
                    {formatTime(capture.startedAt, locale)} · {capture.map || '—'}
                    {capture.fid ? ` · #${capture.fid}` : ''}
                    {capture.partial ? ` · ${t('apmPartialLabel')}` : ''}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
        </div>
      )}
      {apm.captureId ? (
        <ApmMetrics apm={apm} />
      ) : !state.config.inputHookEnabled ? (
        <Empty
          icon={<Icon icon={faWaveSquare} size={30} />}
          description={t('apmDescription')}
          action={
            <Button variant="default" onClick={() => openSettings('automation')}>
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
        <Card title={t('apm')} showHeader={false}>
          {content}
        </Card>
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
