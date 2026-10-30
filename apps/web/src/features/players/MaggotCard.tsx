import { useEffect } from 'react';
import { formatMetric } from '@ba/shared';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { Badge, Button, Notice } from '../../components/ui';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';

export function MaggotCard({ id }: { id: string }) {
  const { maggot, runMaggot, state } = useApp();
  const { t } = useI18n();
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
        <CardAction role="status">
          <Badge>
            {pending && <Spinner aria-hidden="true" />}
            {status}
            {pending && <span className="tabular-nums">{progress?.done ?? 0}/12</span>}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="maggot-card-content">
        {(report || pending) && (
          <>
            <div className="maggot-summary">
              <div>
                <div className="maggot-score-row" aria-busy={pending && !report}>
                  {report ? (
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
                  ) : (
                    <Skeleton className="h-9 w-16" aria-hidden="true" />
                  )}
                  {(!report || report.index !== null) && (
                    <span className="pb-1 text-muted-foreground"> / 10</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t('maggotScale')}</p>
              </div>
              <dl className="maggot-summary-metrics">
                <div>
                  <dt>{t('averageRank')}</dt>
                  <dd>
                    {report ? (
                      formatMetric(report.averageRank, 1)
                    ) : (
                      <Skeleton className="h-4 w-8" aria-hidden="true" />
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('trend')}</dt>
                  <dd>
                    {report ? (
                      report.complete ? (
                        t(report.trend)
                      ) : (
                        '—'
                      )
                    ) : (
                      <Skeleton className="h-4 w-8" aria-hidden="true" />
                    )}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="maggot-feedback">
              {report ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {report.complete
                    ? t('maggotSample', { n: report.rows.length })
                    : t('partialMaggot', { n: report.rows.length })}
                </p>
              ) : (
                <Skeleton className="h-4 w-40" aria-hidden="true" />
              )}
              <div className="h-1">
                {pending && (
                  <Progress
                    max={12}
                    value={progress?.done ?? 0}
                    aria-label={t('maggotCalculating')}
                  />
                )}
              </div>
            </div>
          </>
        )}
        {request?.error && (
          <Notice error>
            <span>{request.error}</span>
            <Button size="sm" onClick={() => void runMaggot(id, true)}>
              {t('retry')}
            </Button>
          </Notice>
        )}
      </CardContent>
    </Card>
  );
}
