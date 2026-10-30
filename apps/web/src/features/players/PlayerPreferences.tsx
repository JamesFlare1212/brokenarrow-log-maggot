import type { CSSProperties } from 'react';
import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatMetric } from '@ba/shared';
import { Badge, Empty } from '../../components/ui';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useI18n } from '../../hooks/useI18n';
import { MaggotCard } from './MaggotCard';

const UNIT_PLACEHOLDER_ROWS = 15;
const CATEGORY_PLACEHOLDER_ROWS = 7;

export function PlayerPreferences({
  id,
  report,
  profile,
  pending = false,
  showMaggot = true,
}: {
  id: string;
  report: PlayerReport | null;
  profile?: PlayerProfile | null;
  pending?: boolean;
  showMaggot?: boolean;
}) {
  const { t } = useI18n();
  const loading = pending && !report;
  const units =
    report?.favUnits ??
    (profile?.info?.topUnits
      .split(', ')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name, value: null, spawn: null, roi: null })) ||
      []);
  const categories =
    report?.categories ??
    (profile?.info?.category ? [{ key: profile.info.category, pct: null, totalCost: null }] : []);
  const unitRows = loading
    ? Array.from(
        { length: Math.max(UNIT_PLACEHOLDER_ROWS, units.length) },
        (_, index) => units[index] ?? null,
      )
    : units;
  const categoryRows = loading
    ? Array.from(
        { length: Math.max(CATEGORY_PLACEHOLDER_ROWS, categories.length) },
        (_, index) => categories[index] ?? null,
      )
    : categories;
  const categoryLabel = (key: string) => {
    const translationKey = 'cat.' + key.toLowerCase();
    const label = t(translationKey);
    return label === translationKey ? key : label;
  };
  const styleKey = 'style.' + report?.style?.toLowerCase();

  return (
    <div
      className="profile-analysis-grid"
      style={
        {
          '--profile-unit-rows': UNIT_PLACEHOLDER_ROWS,
          '--profile-category-rows': CATEGORY_PLACEHOLDER_ROWS,
        } as CSSProperties
      }
    >
      <Card size="sm" className="profile-highlights" aria-busy={pending}>
        <CardHeader>
          <CardTitle role="heading" aria-level={3}>
            {t('units')}
          </CardTitle>
          {(units.length > 0 || loading) && (
            <CardAction>
              {loading ? (
                <Skeleton className="h-5 w-8" aria-hidden="true" />
              ) : (
                <Badge>{units.length}</Badge>
              )}
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="profile-highlight-content">
          {unitRows.length > 0 ? (
            <Table className="profile-unit-table" aria-label={t('units')} aria-busy={pending}>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('unitName')}</TableHead>
                  <TableHead scope="col">{t('damage')}</TableHead>
                  <TableHead scope="col">{t('deployments')}</TableHead>
                  <TableHead scope="col">ROI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unitRows.map((unit, index) => (
                  <TableRow key={index} aria-hidden={!unit || undefined}>
                    <TableCell>
                      <div className="profile-unit-identity">
                        <span className="profile-unit-rank" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        {unit ? (
                          <span className="profile-unit-name">{unit.name}</span>
                        ) : (
                          <Skeleton className="h-4 w-3/4" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {unit && (!loading || unit.value != null) ? (
                        formatMetric(unit.value, 0)
                      ) : (
                        <Skeleton className="ml-auto h-4 w-12" aria-hidden="true" />
                      )}
                    </TableCell>
                    <TableCell>
                      {unit && (!loading || unit.spawn != null) ? (
                        formatMetric(unit.spawn, 0)
                      ) : (
                        <Skeleton className="ml-auto h-4 w-8" aria-hidden="true" />
                      )}
                    </TableCell>
                    <TableCell>
                      {unit && (!loading || unit.roi != null) ? (
                        formatMetric(unit.roi)
                      ) : (
                        <Skeleton className="ml-auto h-4 w-8" aria-hidden="true" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>{t('noHighlightUnits')}</Empty>
          )}
        </CardContent>
      </Card>
      <div className="profile-analysis-sidebar">
        <Card size="sm" className="profile-preferences" aria-busy={pending}>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {t('playerPreferences')}
            </CardTitle>
            {(report?.style || pending) && (
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
          <CardContent>
            <section className="profile-preference-section" aria-label={t('preference')}>
              <div className="profile-category-heading">
                <h4>{t('preference')}</h4>
                <span>{t('preferenceMetrics')}</span>
              </div>
              <div className="profile-category-content">
                {categoryRows.length > 0 ? (
                  <ul className="profile-category-list">
                    {categoryRows.map((category, index) => (
                      <li key={index} aria-hidden={!category || undefined}>
                        <div className="profile-category-label">
                          {category ? (
                            <span>{categoryLabel(category.key)}</span>
                          ) : (
                            <Skeleton className="h-4 w-12" />
                          )}
                          <span className="profile-category-values">
                            <span>
                              {loading && category?.pct == null ? (
                                <Skeleton className="ml-auto h-4 w-10" aria-hidden="true" />
                              ) : category?.pct == null ? (
                                '—'
                              ) : (
                                `${formatMetric(category.pct, 1)}%`
                              )}
                            </span>
                            <span className="text-muted-foreground">
                              {loading && category?.totalCost == null ? (
                                <Skeleton className="ml-auto h-4 w-14" aria-hidden="true" />
                              ) : (
                                formatMetric(category?.totalCost ?? null, 0)
                              )}
                            </span>
                          </span>
                        </div>
                        {category?.pct != null ? (
                          <Progress
                            value={Math.max(0, Math.min(100, category.pct))}
                            aria-label={categoryLabel(category.key)}
                            aria-valuetext={`${formatMetric(category.pct, 1)}%`}
                          />
                        ) : loading ? (
                          <Skeleton className="h-1 w-full" aria-hidden="true" />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>{t('noPlayerPreferences')}</Empty>
                )}
              </div>
            </section>
          </CardContent>
        </Card>
        {showMaggot && <MaggotCard id={id} />}
      </div>
    </div>
  );
}
