import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatMetric } from '@ba/shared';
import { Badge, Empty, Stats } from '../../components/ui';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { MaggotCard } from './MaggotCard';
import { useI18n } from '../../hooks/useI18n';

export function ProfileOverview({
  id,
  profile,
  report,
  profilePending,
  reportPending,
}: {
  id: string;
  profile: PlayerProfile | null;
  report: PlayerReport | null;
  profilePending: boolean;
  reportPending: boolean;
}) {
  const { t } = useI18n();
  const info = report ?? profile?.info;
  const metricsPending = !info && (profilePending || reportPending);
  const preferencesPending = reportPending || (!report && profilePending);
  const categories = report?.categories ?? [];
  const units = report?.favUnits ?? [];
  const categoryLabel = (key: string) => {
    const label = t('cat.' + key.toLowerCase());
    return label === 'cat.' + key.toLowerCase() ? key : label;
  };
  const styleKey = 'style.' + report?.style?.toLowerCase();
  const hasPreferences =
    categories.length > 0 ||
    units.length > 0 ||
    report?.style ||
    (!report && (profile?.info?.category || profile?.info?.topUnits));

  return (
    <div className="profile-overview">
      <Stats
        items={[
          {
            label: 'ELO',
            value: formatMetric(info?.elo ?? profile?.latestElo ?? null, 0),
            pending: metricsPending && profile?.latestElo == null,
          },
          {
            label: t(info?.fallback ? 'winRate' : 'recentWinRate'),
            value: info?.winRate == null ? '—' : `${formatMetric(info.winRate, 0)}%`,
            pending: metricsPending,
          },
          {
            label: t('latestKd'),
            value: formatMetric(info?.kd ?? null),
            pending: metricsPending,
          },
          {
            label: t('latestDmr'),
            value: formatMetric(report?.dmr ?? null),
            pending: reportPending,
          },
        ]}
      />
      <div className="profile-analysis-grid">
        <Card size="sm" className="profile-preferences" aria-busy={preferencesPending}>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {t('playerPreferences')}
            </CardTitle>
            {(report?.style || preferencesPending) && (
              <CardAction>
                {report?.style ? (
                  <Badge>
                    {t('style')}: {t(styleKey) === styleKey ? report.style : t(styleKey)}
                  </Badge>
                ) : (
                  <Skeleton className="h-5 w-20" aria-hidden="true" />
                )}
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="profile-preference-columns">
            {(categories.length > 0 ||
              (!report && profile?.info?.category) ||
              preferencesPending) && (
              <section className="profile-preference-section" aria-label={t('preference')}>
                <h4>{t('preference')}</h4>
                {categories.length > 0 ? (
                  <ul className="profile-category-list">
                    {categories.map((category) => (
                      <li key={category.key}>
                        <div className="profile-category-label">
                          <span>{categoryLabel(category.key)}</span>
                          <span className="tabular-nums">
                            {category.pct == null ? '—' : `${formatMetric(category.pct, 0)}%`}
                          </span>
                        </div>
                        {category.pct != null && (
                          <Progress
                            value={Math.max(0, Math.min(100, category.pct))}
                            aria-label={categoryLabel(category.key)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                ) : !report && profile?.info?.category ? (
                  <p>{profile?.info?.category}</p>
                ) : (
                  <ul className="profile-category-list" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                      <li key={index}>
                        <div className="profile-category-label">
                          <Skeleton className="h-4 w-12" />
                          <Skeleton className="h-4 w-8" />
                        </div>
                        <Skeleton className="h-1 w-full" />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {(units.length > 0 || (!report && profile?.info?.topUnits) || preferencesPending) && (
              <section
                className="profile-preference-section profile-unit-section"
                aria-label={t('units')}
              >
                <div className="profile-category-label">
                  <h4>{t('units')}</h4>
                  {(units.length > 0 || preferencesPending) && (
                    <span className="text-xs text-muted-foreground">{t('damage')}</span>
                  )}
                </div>
                {units.length > 0 ? (
                  <ol className="profile-unit-list">
                    {units.map((unit, index) => (
                      <li key={unit.name}>
                        <span className="profile-unit-rank" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="profile-unit-name">{unit.name}</span>
                        <span className="tabular-nums">{formatMetric(unit.value, 0)}</span>
                      </li>
                    ))}
                  </ol>
                ) : !report && profile?.info?.topUnits ? (
                  <p>{profile?.info?.topUnits}</p>
                ) : (
                  <ol className="profile-unit-list" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                      <li key={index}>
                        <span className="profile-unit-rank">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-12" />
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
            {!hasPreferences && !preferencesPending && (
              <div className="col-span-full flex items-center justify-center">
                <Empty>{t('noPlayerPreferences')}</Empty>
              </div>
            )}
          </CardContent>
        </Card>
        <MaggotCard id={id} />
      </div>
    </div>
  );
}
