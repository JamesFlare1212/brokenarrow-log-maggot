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
  const categories = report?.categories ?? [];
  const units = report?.favUnits ?? [];
  const cachedUnits = !report ? profile?.info?.topUnits : null;
  const categoryLabel = (key: string) => {
    const translationKey = 'cat.' + key.toLowerCase();
    const label = t(translationKey);
    return label === translationKey ? key : label;
  };
  const styleKey = 'style.' + report?.style?.toLowerCase();

  return (
    <div className="profile-analysis-grid">
      <Card size="sm" className="profile-highlights" aria-busy={pending}>
        <CardHeader>
          <CardTitle role="heading" aria-level={3}>
            {t('units')}
          </CardTitle>
          {units.length > 0 && (
            <CardAction>
              <Badge>{units.length}</Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {units.length > 0 || (pending && !cachedUnits) ? (
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
                {units.length > 0
                  ? units.map((unit, index) => (
                      <TableRow key={`${unit.name}:${index}`}>
                        <TableCell>
                          <div className="profile-unit-identity">
                            <span className="profile-unit-rank" aria-hidden="true">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span className="profile-unit-name">{unit.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>{formatMetric(unit.value, 0)}</TableCell>
                        <TableCell>{formatMetric(unit.spawn, 0)}</TableCell>
                        <TableCell>{formatMetric(unit.roi)}</TableCell>
                      </TableRow>
                    ))
                  : Array.from({ length: 15 }, (_, index) => (
                      <TableRow key={index} aria-hidden="true">
                        <TableCell>
                          <div className="profile-unit-identity">
                            <span className="profile-unit-rank">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <Skeleton className="h-4 w-3/4" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="ml-auto h-4 w-12" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="ml-auto h-4 w-8" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="ml-auto h-4 w-8" />
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          ) : cachedUnits ? (
            <p className="wrap-anywhere">{cachedUnits}</p>
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
              {categories.length > 0 ? (
                <ul className="profile-category-list">
                  {categories.map((category) => (
                    <li key={category.key}>
                      <div className="profile-category-label">
                        <span>{categoryLabel(category.key)}</span>
                        <span className="profile-category-values">
                          <span>
                            {category.pct == null ? '—' : `${formatMetric(category.pct, 1)}%`}
                          </span>
                          <span className="text-muted-foreground">
                            {formatMetric(category.totalCost, 0)}
                          </span>
                        </span>
                      </div>
                      {category.pct != null && (
                        <Progress
                          value={Math.max(0, Math.min(100, category.pct))}
                          aria-label={categoryLabel(category.key)}
                          aria-valuetext={`${formatMetric(category.pct, 1)}%`}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              ) : !report && profile?.info?.category ? (
                <p>{categoryLabel(profile.info.category)}</p>
              ) : pending ? (
                <ul className="profile-category-list" aria-hidden="true">
                  {Array.from({ length: 7 }, (_, index) => (
                    <li key={index}>
                      <div className="profile-category-label">
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <Skeleton className="h-1 w-full" />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>{t('noPlayerPreferences')}</Empty>
              )}
            </section>
          </CardContent>
        </Card>
        {showMaggot && <MaggotCard id={id} />}
      </div>
    </div>
  );
}
