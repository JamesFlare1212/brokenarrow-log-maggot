import { useEffect, useLayoutEffect, useRef, type FocusEvent } from 'react';
import {
  RefreshCw as faArrowsRotate,
  BrushCleaning as faBroom,
  Trash2 as faTrashCan,
} from 'lucide-react';
import type { CacheClearMode } from '@ba/contracts';
import { formatSize, formatTime } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { Icon } from '../../components/Icon';
import { Button, Notice, Stats } from '../../components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '../../hooks/useI18n';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';

export function CacheSettings() {
  const { cache } = useApp(),
    { t, locale } = useI18n(),
    confirm = useConfirmation();
  const { refresh, data: stats, busy, outcome } = cache;
  const clearing =
    cache.operation && cache.operation.phase !== 'confirming' ? cache.operation.mode : null;
  useEffect(() => {
    void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  useEffect(() => {
    if (!stats || busy || !cache.current) return;
    const delay = Math.max(
      25,
      Math.min(30000, stats.nextExpiryAt === null ? 30000 : stats.nextExpiryAt - Date.now()),
    );
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [stats, busy, cache.current, refresh]);

  const clear = (mode: CacheClearMode) => {
    if (busy || !cache.current) return;
    void cache.clear(
      mode,
      mode === 'all'
        ? () =>
            confirm({
              title: t('cacheClearAll'),
              description: t('cacheClearConfirm'),
              detail: t('cachePreserved'),
              confirmLabel: t('cacheClearAll'),
            })
        : undefined,
    );
  };
  const entries = stats ? stats.api.entries + stats.snapshots.entries : 0,
    expired = stats ? stats.api.expired + stats.snapshots.expired : 0;
  const focused = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (focused.current && document.activeElement === focused.current)
      focused.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [busy, stats, cache.error, outcome]);
  const focusProps = {
    className: 'scroll-m-2',
    onFocus: (event: FocusEvent<HTMLButtonElement>) => {
      focused.current = event.currentTarget;
    },
    onBlur: () => {
      focused.current = null;
    },
  };
  const count = (value: number) => value.toLocaleString(locale);
  return (
    <>
      <section
        className="settings-section"
        aria-labelledby="cache-usage-heading"
        aria-busy={cache.reading}
      >
        <div className="cache-section-heading">
          <h3 id="cache-usage-heading">{t('cacheUsage')}</h3>
          <Button
            {...focusProps}
            aria-disabled={busy}
            aria-busy={cache.reading}
            onClick={() => {
              if (!busy) void refresh();
            }}
          >
            <Icon icon={faArrowsRotate} size={14} spin={cache.reading} aria-hidden="true" />
            {t('refresh')}
          </Button>
        </div>
        <p
          role="status"
          tabIndex={0}
          className="cache-statistics-status text-sm text-muted-foreground wrap-anywhere"
        >
          {stats
            ? t(
                cache.reading
                  ? 'cacheStatsRefreshing'
                  : cache.current
                    ? 'cacheStatsAsOf'
                    : 'cacheStatsOutdated',
                { time: formatTime(stats.at, locale) },
              )
            : t(cache.reading ? 'loading' : 'cacheStatsUnavailable')}
        </p>
        <Stats
          items={[
            {
              label: t('cacheEntries'),
              value: stats ? (
                count(entries)
              ) : cache.reading ? (
                <Skeleton className="h-[1lh] w-20 max-w-full" aria-hidden="true" />
              ) : (
                '—'
              ),
            },
            {
              label: t('cacheExpired'),
              value: stats ? (
                count(expired)
              ) : cache.reading ? (
                <Skeleton className="h-[1lh] w-20 max-w-full" aria-hidden="true" />
              ) : (
                '—'
              ),
            },
            {
              label: t('cacheDataSize'),
              value: stats ? (
                formatSize(stats.api.bytes + stats.snapshots.bytes)
              ) : cache.reading ? (
                <Skeleton className="h-[1lh] w-20 max-w-full" aria-hidden="true" />
              ) : (
                '—'
              ),
            },
          ]}
        />
        <div className="cache-category-grid">
          {(['api', 'snapshots'] as const).map((category) => (
            <Item variant="outline" className="cache-category" key={category}>
              <ItemContent>
                <ItemTitle>{t('cacheCategory.' + category)}</ItemTitle>
                <ItemDescription>{t('cacheCategoryHint.' + category)}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <div className="cache-category-usage">
                  <strong>
                    {stats ? (
                      formatSize(stats[category].bytes)
                    ) : cache.reading ? (
                      <Skeleton className="h-[1lh] w-16 max-w-full" aria-hidden="true" />
                    ) : (
                      '—'
                    )}
                  </strong>
                  <span className="cache-category-count">
                    {stats
                      ? t('cacheEntrySummary', {
                          entries: count(stats[category].entries),
                          expired: count(stats[category].expired),
                        })
                      : '—'}
                  </span>
                </div>
              </ItemActions>
            </Item>
          ))}
        </div>
        <p>{t('cacheSizeHint')}</p>
      </section>
      <Card aria-labelledby="cache-cleanup-heading">
        <CardHeader>
          <CardTitle id="cache-cleanup-heading">{t('cacheCleanup')}</CardTitle>
          <CardDescription>{t('cacheCleanupHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>{t('cachePreserved')}</p>
          <div className="actions cache-actions">
            <Button
              {...focusProps}
              aria-disabled={busy || !cache.current || !stats || expired === 0}
              aria-busy={clearing === 'expired'}
              aria-label={t('cacheClearExpired')}
              onClick={() => {
                if (!busy && stats && expired > 0) void clear('expired');
              }}
            >
              <Icon icon={faBroom} size={14} aria-hidden="true" />
              {t('cacheClearExpired')}
            </Button>
            <Button
              {...focusProps}
              variant="destructive"
              aria-disabled={busy || !cache.current || !stats || entries === 0}
              aria-busy={clearing === 'all'}
              aria-label={t('cacheClearAll')}
              onClick={() => {
                if (!busy && stats && entries > 0) void clear('all');
              }}
            >
              <Icon icon={faTrashCan} size={14} aria-hidden="true" />
              {t('cacheClearAll')}
            </Button>
          </div>
          {clearing && (
            <p role="status">
              {t(cache.operation?.phase === 'reconciling' ? 'cacheReconciling' : 'cacheClearing')}
            </p>
          )}
          {outcome && outcome.kind !== 'success' && (
            <Notice error>
              <div className="min-w-0 space-y-1 wrap-anywhere">
                {outcome.kind === 'uncertain' && (
                  <p>{t(cache.current ? 'cacheClearUnknownReconciled' : 'cacheClearUnknown')}</p>
                )}
                <p>{outcome.error}</p>
              </div>
            </Notice>
          )}
          {outcome?.kind === 'success' && (
            <p role="status">{t('cacheCleared', { count: count(outcome.removed) })}</p>
          )}
        </CardContent>
      </Card>
      {cache.error && <Notice error>{cache.error}</Notice>}
    </>
  );
}
