import { useEffect } from 'react';
import { formatMetric } from '@ba/shared';
import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import { TooltipButton } from '@/components/Tooltip';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { Button, Notice } from '../../components/ui';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';

export function MaggotCard({ id, enabled = true }: { id: string; enabled?: boolean }) {
  const { maggot, runMaggot, state } = useApp();
  const { t } = useI18n();
  useEffect(() => {
    if (enabled) void runMaggot(id);
  }, [id, runMaggot, enabled]);
  const request = maggot[id];
  const report = request?.data;
  const pending = !request || request.status === 'queued' || request.status === 'loading';
  const progress =
    state.maggotProgress?.requestId === request?.requestId && state.maggotProgress?.id === id
      ? state.maggotProgress
      : null;
  const status = !enabled
    ? t('loading')
    : pending
      ? t(request?.status === 'queued' ? 'maggotQueued' : 'maggotCalculating')
      : request.error
        ? t('maggotFailed')
        : t(report?.complete ? 'maggotReady' : 'maggotInsufficient');
  const sampleHint =
    report && !report.complete
      ? t('partialMaggot', { n: report.rows.length })
      : t('maggotSample', { n: report?.rows.length ?? 12 });
  const TrendIcon =
    report?.trend === 'up' ? ArrowUpRight : report?.trend === 'down' ? ArrowDownRight : Minus;
  return (
    <Card size="sm" className="maggot-card" role="region" aria-label={t('maggot')}>
      <CardHeader>
        <CardTitle
          role="heading"
          aria-level={3}
          aria-label={t('maggot')}
          className="flex min-w-0 items-center gap-1"
        >
          {t('maggot')}
          <TooltipButton
            variant="ghost"
            size="icon-xs"
            aria-label={t('maggotSampleInfo')}
            tooltip={sampleHint}
            pinOnClick
          >
            <Info aria-hidden="true" />
          </TooltipButton>
        </CardTitle>
        <CardAction className="self-center" role={enabled ? 'status' : undefined}>
          <Badge variant="outline">
            {pending && <Spinner aria-hidden="true" />}
            {status}
            {enabled && pending && <span className="tabular-nums">{progress?.done ?? 0}/12</span>}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="maggot-card-content flex min-w-0 flex-col gap-3">
        {(report || pending) && (
          <>
            <div className="maggot-summary flex min-w-0 items-end justify-between gap-3">
              <div
                className="maggot-score-row flex min-h-11 items-baseline gap-2 [&>[data-slot='skeleton']]:self-center"
                aria-busy={pending && !report}
              >
                {report ? (
                  <strong
                    className={cn(
                      'maggot-score text-[2.75rem] font-semibold leading-none tracking-[-0.055em] tabular-nums',
                      report.index === null
                        ? 'text-muted-foreground'
                        : report.index <= 3.5
                          ? 'text-success'
                          : report.index <= 7
                            ? 'text-warning'
                            : 'text-destructive',
                    )}
                  >
                    {formatMetric(report.index, 1)}
                  </strong>
                ) : (
                  <Skeleton className="h-11 w-20" aria-hidden="true" />
                )}
                <span className="text-sm text-muted-foreground">/ 10</span>
              </div>
              <p className="pb-0.5 text-xs text-muted-foreground">{t('maggotScale')}</p>
            </div>
            <MaggotScale value={report?.index ?? null} pending={pending && !report} />
            <dl className="maggot-summary-metrics flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs">
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">{t('averageRank')}</dt>
                <dd className="flex min-h-5 min-w-8 items-center text-base font-medium tabular-nums">
                  {report ? (
                    formatMetric(report.averageRank, 1)
                  ) : (
                    <Skeleton className="h-4 w-8" aria-hidden="true" />
                  )}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="sr-only">{t('trend')}</dt>
                <dd
                  className={cn(
                    'inline-flex min-h-5 min-w-8 items-center gap-1.5 text-sm font-medium',
                    report?.complete && report.trend === 'up' && 'text-success',
                    report?.complete && report.trend === 'down' && 'text-destructive',
                  )}
                >
                  {report ? (
                    report.complete ? (
                      <>
                        <TrendIcon className="size-4" aria-hidden="true" />
                        {t(report.trend)}
                      </>
                    ) : (
                      '—'
                    )
                  ) : (
                    <Skeleton className="h-4 w-8" aria-hidden="true" />
                  )}
                </dd>
              </div>
            </dl>
            <div className="maggot-progress h-1">
              {pending && (
                <Progress
                  max={12}
                  value={progress?.done ?? 0}
                  aria-label={t('maggotCalculating')}
                />
              )}
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

function MaggotScale({ value, pending }: { value: number | null; pending: boolean }) {
  const { t } = useI18n();
  const available = value !== null && Number.isFinite(value);
  const position = Math.max(0, Math.min(10, value ?? 0)) * 10;
  return (
    <svg
      className="maggot-scale h-12 w-full overflow-visible"
      role="img"
      aria-label={
        available
          ? t('maggotScaleValue', { value: formatMetric(value, 1) })
          : t(pending ? 'loading' : 'maggotScaleUnavailable')
      }
    >
      <svg
        x="6"
        width="calc(100% - 12px)"
        height="44"
        className="overflow-visible"
        aria-hidden="true"
      >
        <rect
          x="0"
          y="12"
          width="calc(35% - 1.5px)"
          height="5"
          rx="2.5"
          className="fill-success/35"
        />
        <rect
          x="calc(35% + 1.5px)"
          y="12"
          width="calc(35% - 3px)"
          height="5"
          rx="2.5"
          className="fill-warning/35"
        />
        <rect
          x="calc(70% + 1.5px)"
          y="12"
          width="calc(30% - 1.5px)"
          height="5"
          rx="2.5"
          className="fill-destructive/35"
        />
        {available && (
          <svg x={`${position}%`} width="1" height="44" className="overflow-visible">
            <path
              d="M -3 4 L 0 8 L 3 4 M 0 8 V 22"
              className="fill-none stroke-foreground"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <g className="fill-muted-foreground text-[10px] tabular-nums">
          <text x="0" y="39">
            0
          </text>
          <text x="35%" y="39" textAnchor="middle">
            3.5
          </text>
          <text x="70%" y="39" textAnchor="middle">
            7
          </text>
          <text x="100%" y="39" textAnchor="end">
            10
          </text>
        </g>
      </svg>
    </svg>
  );
}
