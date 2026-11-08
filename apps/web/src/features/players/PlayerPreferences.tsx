import { useId, useRef, useState, type CSSProperties } from 'react';
import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatMetric } from '@ba/shared';
import { Badge, Button, Empty } from '../../components/ui';
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
import { OverflowHint } from '../../components/OverflowHint';

const UNIT_PREVIEW_ROWS = 4;
const CATEGORY_PREVIEW_ROWS = 3;

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
  const unitListId = useId();
  const categoryListId = useId();
  const unitScroll = useRef<HTMLDivElement>(null);
  const [expandedUnitsFor, setExpandedUnitsFor] = useState<string | null>(null);
  const [expandedCategoriesFor, setExpandedCategoriesFor] = useState<string | null>(null);
  const unitsExpanded = expandedUnitsFor === id;
  const categoriesExpanded = expandedCategoriesFor === id;
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
  const visibleCategories = categoriesExpanded
    ? categories
    : categories.slice(0, CATEGORY_PREVIEW_ROWS);
  const unitRows = loading
    ? Array.from(
        { length: Math.max(UNIT_PREVIEW_ROWS, units.length) },
        (_, index) => units[index] ?? null,
      )
    : units;
  const categoryRows = loading
    ? Array.from(
        { length: Math.max(CATEGORY_PREVIEW_ROWS, visibleCategories.length) },
        (_, index) => visibleCategories[index] ?? null,
      )
    : visibleCategories;
  const categoryLabel = (key: string) => {
    const translationKey = 'cat.' + key.toLowerCase();
    const label = t(translationKey);
    return label === translationKey ? key : label;
  };
  const styleKey = 'style.' + report?.style?.toLowerCase();

  return (
    <div
      className="profile-analysis-grid grid grid-cols-[minmax(0,_1.5fr)_minmax(18rem,_1fr)] items-stretch gap-3 [&>:only-child]:col-span-full [&>*]:min-w-0 profile-overview-max-52:grid-cols-1"
      style={
        {
          '--profile-unit-rows': UNIT_PREVIEW_ROWS,
          '--profile-category-rows': CATEGORY_PREVIEW_ROWS,
        } as CSSProperties
      }
    >
      <Card
        size="sm"
        className="profile-highlights [&>[data-slot='card-header']]:min-h-7"
        aria-busy={pending}
        data-expanded={unitsExpanded}
      >
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
        <CardContent className="profile-highlight-content flex min-w-0 flex-col gap-2 flex-1 min-h-0">
          <div
            ref={unitScroll}
            id={unitListId}
            className="profile-unit-preview [&:focus-visible]:outline-2 [&:focus-visible]:outline-solid [&:focus-visible]:outline-ring [&:focus-visible]:outline-offset-[-2px] [&>[data-slot='table-container']]:overflow-visible min-h-[calc(_2.5rem+var(--profile-unit-rows)_*_var(--profile-unit-row-height)_-_1px+var(--scrollbar-size)_)] overflow-auto flex-1 [contain:size] [.profile-highlights[data-expanded='true']_&]:flex-none [.profile-highlights[data-expanded='true']_&]:[contain:none]"
            tabIndex={0}
            role="region"
            aria-label={`${t('units')} · ${t('tableScrollBothHint')}`}
          >
            {unitRows.length > 0 ? (
              <Table
                className="profile-unit-table min-w-[calc(14.5rem+2_*_var(--unit-metric-column-width))] table-fixed tabular-nums [.report_&]:min-w-[calc(14.5rem+2_*_var(--unit-metric-column-width))] [.report_&]:table-fixed [.report_&]:tabular-nums [&_th:not(:first-child)]:text-right [&_td:not(:first-child)]:text-right [&_th:first-child]:w-auto [&_th:nth-child(2)]:w-(--unit-metric-column-width) [&_th:nth-child(3)]:w-(--unit-metric-column-width) [&_th:nth-child(4)]:w-18 [&_td]:h-(--profile-unit-row-height) [&_td]:whitespace-normal [&_td]:wrap-anywhere"
                aria-label={t('units')}
                aria-busy={pending}
              >
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
                        <div className="profile-unit-identity flex min-w-36 items-center gap-3">
                          <span
                            className="profile-unit-rank text-muted-foreground [flex:0_0_1.25rem] text-[0.6875rem] tabular-nums"
                            aria-hidden="true"
                          >
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          {unit ? (
                            <span className="profile-unit-name whitespace-normal wrap-anywhere">
                              {unit.name}
                            </span>
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
          </div>
          <div className="profile-preference-actions flex min-h-7 items-center profile-unit-actions justify-between gap-1 [&>button]:shrink-0 [&>button]:ms-auto">
            <OverflowHint viewport={unitScroll} axis="both" compact />
            {units.length > UNIT_PREVIEW_ROWS && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={unitsExpanded}
                aria-controls={unitListId}
                onClick={() => setExpandedUnitsFor(unitsExpanded ? null : id)}
              >
                {unitsExpanded ? t('showLess') : t('showAllUnits', { count: units.length })}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="profile-analysis-sidebar flex flex-col gap-3">
        <Card
          size="sm"
          className="profile-preferences [.profile-analysis-sidebar>&]:flex-1 [&>[data-slot='card-header']]:min-h-7"
          aria-busy={pending}
        >
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
            <section
              className="profile-preference-section [&_h4]:text-muted-foreground flex min-w-0 flex-col gap-3 [&>p]:wrap-anywhere"
              aria-label={t('preference')}
            >
              <div className="profile-category-heading flex flex-wrap items-baseline justify-between gap-y-1 gap-x-4 text-muted-foreground text-[0.75rem] [&_h4]:font-normal">
                <h4>{t('preference')}</h4>
                <span>{t('preferenceMetrics')}</span>
              </div>
              <div
                className="profile-category-content min-h-[calc(_var(--profile-category-rows)_*_var(--profile-category-row-height)+(var(--profile-category-rows)_-_1)_*_var(--profile-category-gap)_)]"
                id={categoryListId}
              >
                {categoryRows.length > 0 ? (
                  <ul className="profile-category-list flex flex-col gap-(--profile-category-gap) [&>li]:flex [&>li]:flex-col [&>li]:gap-1.5 [&>li]:min-h-(--profile-category-row-height)">
                    {categoryRows.map((category, index) => (
                      <li key={index} aria-hidden={!category || undefined}>
                        <div className="profile-category-label flex min-h-5 flex-wrap items-center justify-between gap-y-1 gap-x-3 text-[0.8125rem]">
                          {category ? (
                            <span>{categoryLabel(category.key)}</span>
                          ) : (
                            <Skeleton className="h-4 w-12" />
                          )}
                          <span className="profile-category-values grid grid-cols-[3.5rem_minmax(4.5rem,_auto)] gap-3 ml-auto text-right tabular-nums">
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
              <div className="profile-preference-actions flex min-h-7 items-center">
                {categories.length > CATEGORY_PREVIEW_ROWS && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={categoriesExpanded}
                    aria-controls={categoryListId}
                    onClick={() => setExpandedCategoriesFor(categoriesExpanded ? null : id)}
                  >
                    {categoriesExpanded
                      ? t('showLess')
                      : t('showAllCategories', { count: categories.length })}
                  </Button>
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
