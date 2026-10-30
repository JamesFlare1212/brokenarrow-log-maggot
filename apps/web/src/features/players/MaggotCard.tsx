import { useEffect } from 'react';
import { formatMetric, formatTime } from '@ba/shared';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { Badge, Notice } from '../../components/ui';
import { RecoveryAction } from '../../components/RecoveryAction';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';

export function MaggotCard({ id }: { id: string }) {
  const { maggot, runMaggot, state } = useApp();
  const { t, locale } = useI18n();
  useEffect(() => {
    void runMaggot(id);
  }, [id, runMaggot]);
  const request = maggot[id];
  const report = request?.data;
  const pending = !request || request.status === 'queued' || request.status === 'loading';
  const progress =
    state.maggotProgress?.requestId === request?.requestId && state.maggotProgress?.id === id
      ? state.maggotProgress
      : null;
  const status = pending
    ? t(request?.status === 'queued' ? 'maggotQueued' : 'maggotCalculating')
    : request.error
      ? t('maggotFailed')
      : t(report?.complete ? 'maggotReady' : 'maggotInsufficient');
  return (
    <Card size="sm" className="maggot-card" role="region" aria-label={t('maggot')}>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          {t('maggot')}
        </CardTitle>
        <CardAction>
          <Badge>{status}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="maggot-card-content">
        {pending && (
          <div className="maggot-loading" role="status">
            {!report && <Skeleton className="h-9 w-20" />}
            <div className="maggot-progress-label">
              <span className="inline-flex items-center gap-2">
                <Spinner />
                {status}
              </span>
              <span className="tabular-nums">{progress?.done ?? 0}/12</span>
            </div>
            <Progress max={12} value={progress?.done ?? 0} aria-label={t('maggotCalculating')} />
          </div>
        )}
        {request?.error && (
          <Notice error>
            <span>{request.error}</span>
          </Notice>
        )}
        <RecoveryAction
          key={id}
          available={!!request?.error}
          pending={pending}
          retryLabel={t('retry')}
          refreshLabel={t('recalculateMaggot')}
          pendingLabel={status}
          onRetry={() => void runMaggot(id, true)}
        />
        {report && (
          <>
            {(pending || request?.error) && (
              <p role="status" className="text-sm text-muted-foreground wrap-anywhere">
                {t('maggotPreviousResult', {
                  time: formatTime(request?.updatedAt ?? null, locale),
                })}
              </p>
            )}
            <div className="maggot-summary">
              <div>
                <strong
                  className={cn(
                    'maggot-score',
                    report.index !== null &&
                      (report.index <= 3.5
                        ? 'text-success'
                        : report.index <= 7
                          ? 'text-warning'
                          : 'text-danger'),
                  )}
                >
                  {formatMetric(report.index, 1)}
                </strong>
                {report.index !== null && <span className="text-muted-foreground"> / 10</span>}
                <p className="text-xs text-muted-foreground">{t('maggotScale')}</p>
              </div>
              <dl className="maggot-summary-metrics">
                <div>
                  <dt>{t('averageRank')}</dt>
                  <dd>{formatMetric(report.averageRank, 1)}</dd>
                </div>
                <div>
                  <dt>{t('trend')}</dt>
                  <dd>{report.complete ? t(report.trend) : '—'}</dd>
                </div>
              </dl>
            </div>
            <p className="text-xs text-muted-foreground" role="status">
              {report.complete
                ? t('maggotSample', { n: report.rows.length })
                : t('partialMaggot', { n: report.rows.length })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
