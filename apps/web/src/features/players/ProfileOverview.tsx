import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatMetric, formatPercent } from '@ba/shared';
import { Badge, Stats } from '../../components/ui';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { MaggotCard } from './MaggotCard';
import { useI18n } from '../../hooks/useI18n';

export function ProfileOverview({
  id,
  profile,
  report,
}: {
  id: string;
  profile: PlayerProfile | null;
  report: PlayerReport | null;
}) {
  const { t } = useI18n();
  const info = report ?? profile?.info;
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
          { label: 'ELO', value: formatMetric(info?.elo ?? profile?.latestElo ?? null, 0) },
          {
            label: t(info?.fallback ? 'winRate' : 'recentWinRate'),
            value: formatPercent(info?.winRate ?? null),
          },
          { label: t('latestKd'), value: formatMetric(info?.kd ?? null) },
          { label: t('latestDmr'), value: formatMetric(report?.dmr ?? null) },
        ]}
      />
      <div className="profile-analysis-grid">
        {hasPreferences && (
          <Card size="sm" className="profile-preferences">
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>
                {t('playerPreferences')}
              </CardTitle>
              {report?.style && (
                <CardAction>
                  <Badge>
                    {t('style')}: {t(styleKey) === styleKey ? report.style : t(styleKey)}
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="profile-preference-columns">
              {(categories.length > 0 || (!report && profile?.info?.category)) && (
                <section className="profile-preference-section" aria-label={t('preference')}>
                  <h4>{t('preference')}</h4>
                  {categories.length > 0 ? (
                    <ul className="profile-category-list">
                      {categories.map((category) => (
                        <li key={category.key}>
                          <div className="profile-category-label">
                            <span>{categoryLabel(category.key)}</span>
                            <span className="tabular-nums">{formatPercent(category.pct)}</span>
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
                  ) : (
                    <p>{profile?.info?.category}</p>
                  )}
                </section>
              )}
              {(units.length > 0 || (!report && profile?.info?.topUnits)) && (
                <section
                  className="profile-preference-section profile-unit-section"
                  aria-label={t('units')}
                >
                  <div className="profile-category-label">
                    <h4>{t('units')}</h4>
                    {units.length > 0 && (
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
                  ) : (
                    <p>{profile?.info?.topUnits}</p>
                  )}
                </section>
              )}
            </CardContent>
          </Card>
        )}
        <MaggotCard id={id} />
      </div>
    </div>
  );
}
