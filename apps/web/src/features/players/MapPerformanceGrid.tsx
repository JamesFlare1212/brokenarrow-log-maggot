import type { PlayerReport } from '@ba/contracts';
import { formatMetric } from '@ba/shared';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '../../hooks/useI18n';

type MapPerformance = PlayerReport['mapStats'][number];

export function MapPerformanceGrid({
  maps,
  pending = false,
}: {
  maps: MapPerformance[];
  pending?: boolean;
}) {
  const { t } = useI18n();
  const entries: Array<MapPerformance | null> =
    pending && maps.length === 0
      ? Array.from({ length: 6 }, () => null)
      : maps.slice().sort((a, b) => b.matchCount - a.matchCount);

  return (
    <ul className="map-performance-grid" aria-label={t('mapStatistics')} aria-busy={pending}>
      {entries.map((map, index) => (
        <li
          key={map?.mapId ?? map?.name ?? index}
          aria-label={map?.name}
          aria-hidden={!map || undefined}
        >
          <MapPerformanceCard map={map} />
        </li>
      ))}
    </ul>
  );
}

function MapPerformanceCard({ map }: { map: MapPerformance | null }) {
  const { t } = useI18n();
  const winRate = map?.winRate == null ? null : Math.min(100, Math.max(0, map.winRate));
  const tone =
    winRate === null
      ? 'muted'
      : winRate > 50
        ? 'success'
        : winRate === 50
          ? 'info'
          : winRate >= 40
            ? 'warning'
            : 'danger';
  const destruction = map?.avgDestructionScore ?? null;

  return (
    <Card size="sm" className="map-performance-card h-full" data-tone={tone}>
      <CardHeader className="min-w-0 items-center gap-x-3">
        <CardTitle role="heading" aria-level={4} className="min-w-0 wrap-anywhere">
          {map ? map.name : <Skeleton className="h-5 w-3/4" />}
        </CardTitle>
        <CardAction>
          <CardDescription className="whitespace-nowrap tabular-nums">
            {map ? (
              t(map.matchCount === 1 ? 'mapMatchCountOne' : 'mapMatchCount', {
                count: formatMetric(map.matchCount, 0),
              })
            ) : (
              <Skeleton className="h-5 w-10" />
            )}
          </CardDescription>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {map ? (
          <Progress
            className="map-performance-progress"
            value={winRate ?? 0}
            aria-label={`${map.name} · ${t('winRate')}`}
            aria-hidden={winRate === null || undefined}
          />
        ) : (
          <Skeleton className="h-1 w-full" />
        )}
        <dl className="map-performance-metrics">
          <div>
            <dt>{t('winRate')}</dt>
            <dd className="map-performance-win-rate">
              {map ? (
                winRate === null ? (
                  '—'
                ) : (
                  `${formatMetric(winRate, 1)}%`
                )
              ) : (
                <Skeleton className="h-5 w-12" />
              )}
            </dd>
          </div>
          <div>
            <dt>{t('averageKd')}</dt>
            <dd>{map ? formatMetric(map.avgKd) : <Skeleton className="h-5 w-10" />}</dd>
          </div>
          <div>
            <dt>{t('averageDestruction')}</dt>
            <dd title={map ? formatMetric(destruction, 0) : undefined}>
              {map ? (
                destruction != null && destruction >= 1000 ? (
                  `${formatMetric(destruction / 1000, 1)}k`
                ) : (
                  formatMetric(destruction, 0)
                )
              ) : (
                <Skeleton className="h-5 w-12" />
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
