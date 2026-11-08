import { useId } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { PlayerReport } from '@ba/contracts';
import { formatDelta, formatMetric, formatTime } from '@ba/shared';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Empty } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { eloChangeClass } from '@/lib/elo';
import { useI18n } from '@/hooks/useI18n';
import { buildRatingTrend } from './rating-trend';

export function RatingTrendChart({
  report,
  pending = false,
}: {
  report: PlayerReport | null;
  pending?: boolean;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const loading = pending && !report;
  const { data, baseline, latest, change, hasRatings, domain } = buildRatingTrend(
    report?.ratingTrend ?? [],
  );
  const hasGaps = data.some((point) => point.ratingAfter === null);
  const color =
    change === null || change === 0
      ? 'var(--chart-1)'
      : change > 0
        ? 'var(--elo-increase)'
        : 'var(--elo-decrease)';

  return (
    <Card
      size="sm"
      className="rating-trend-card min-w-0"
      role="region"
      aria-labelledby={`${id}-title`}
      aria-busy={loading}
    >
      <CardHeader>
        <CardTitle id={`${id}-title`} role="heading" aria-level={3}>
          {t('ratingTrend')}
        </CardTitle>
        <CardDescription>
          {data.length ? t('ratingTrendRange', { count: data.length }) : t('ratingTrendScope')}
        </CardDescription>
        <CardAction>
          <dl className="rating-trend-summary flex flex-wrap items-center justify-end gap-y-1.5 gap-x-4 font-medium tabular-nums">
            <div>
              <dt className="sr-only">{t('ratingTrendLatest')}</dt>
              <dd>{loading ? <Skeleton className="h-5 w-16" /> : formatMetric(latest, 1)}</dd>
            </div>
            <div>
              <dt className="sr-only">{t('ratingTrendChange')}</dt>
              <dd className={eloChangeClass(change)}>
                {loading ? <Skeleton className="h-5 w-14" /> : formatDelta(change)}
              </dd>
            </div>
          </dl>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div
            className="rating-trend-placeholder flex h-[200px] items-center justify-center"
            aria-label={t('loading')}
          >
            <Skeleton className="h-full w-full" />
          </div>
        ) : !hasRatings ? (
          <div className="rating-trend-placeholder flex h-[200px] items-center justify-center">
            <Empty
              icon={<ChartNoAxesCombined aria-hidden="true" />}
              description={t('ratingTrendEmptyHint')}
            >
              {t('ratingTrendEmpty')}
            </Empty>
          </div>
        ) : (
          <ChartContainer
            config={{ ratingAfter: { label: 'ELO', color } }}
            className="rating-trend-plot tabular-nums aspect-auto h-[200px] w-full"
          >
            <AreaChart
              accessibilityLayer={false}
              role="img"
              aria-label={t('ratingTrend')}
              data={data}
              margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 5" />
              <XAxis
                dataKey="matchNumber"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={16}
                interval="preserveStartEnd"
              />
              <YAxis
                width={52}
                domain={domain}
                tickCount={5}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals={false}
                tickFormatter={(value: number) => formatMetric(value, 0)}
              />
              {baseline !== null && (
                <ReferenceLine
                  y={baseline}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.5}
                  strokeDasharray="4 4"
                />
              )}
              <ChartTooltip
                isAnimationActive={false}
                filterNull={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const point = data[Number(payload[0]?.payload?.matchNumber) - 1];
                      return point
                        ? `${t('ratingTrendMatch', { number: point.matchNumber })} · #${point.matchId}`
                        : null;
                    }}
                    formatter={(_, _name, item) => {
                      const point = data[Number(item.payload?.matchNumber) - 1];
                      if (!point) return null;
                      return (
                        <div className="rating-trend-tooltip grid gap-1.5 [&_dl]:grid [&_dl]:gap-1.5 [&_dl>div]:flex [&_dl>div]:items-center [&_dl>div]:justify-between [&_dl>div]:gap-6 [&_dt]:text-muted-foreground [&_dd]:font-medium [&_dd]:tabular-nums">
                          <span className="text-muted-foreground">
                            {formatTime(point.endTime, locale)}
                          </span>
                          <dl>
                            <div>
                              <dt>ELO</dt>
                              <dd>{formatMetric(point.ratingAfter, 2)}</dd>
                            </div>
                            <div>
                              <dt>{t('eloDelta')}</dt>
                              <dd className={eloChangeClass(point.change)}>
                                {formatDelta(point.change)}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="ratingAfter"
                name="ELO"
                stroke="var(--color-ratingAfter)"
                strokeWidth={2}
                fill="var(--color-ratingAfter)"
                fillOpacity={0.08}
                connectNulls={false}
                isAnimationActive={false}
                dot={
                  hasGaps || data.length === 1
                    ? { r: 3, fill: 'var(--color-ratingAfter)', strokeWidth: 0 }
                    : false
                }
                activeDot={{
                  r: 4,
                  fill: 'var(--color-ratingAfter)',
                  stroke: 'var(--card)',
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
