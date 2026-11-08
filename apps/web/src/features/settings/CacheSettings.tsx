import { useEffect, useRef, useState } from 'react';
import {
  RefreshCw as faArrowsRotate,
  BrushCleaning as faBroom,
  Trash2 as faTrashCan,
} from 'lucide-react';
import type { CacheClearMode, CacheStats } from '@ba/contracts';
import { errorMessage, formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { Icon } from '../../components/Icon';
import { Button, Notice, Stats } from '../../components/ui';
import { LoadingStatus } from '../../components/LoadingState';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import {
  Card,
  CardAction,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';

export function CacheSettings() {
  const { api } = useApp(),
    { t, locale } = useI18n(),
    confirm = useConfirmation(),
    request = useRequest<CacheStats>();
  const [clearing, setClearing] = useState<CacheClearMode | null>(null),
    [error, setError] = useState<string | null>(null),
    [removed, setRemoved] = useState<number | null>(null);
  const running = useRef(false);
  const load = request.load;
  useEffect(() => {
    void load(() => api.invoke('cache.stats', null));
  }, [api, load]);

  const clear = async (mode: CacheClearMode) => {
    if (running.current) return;
    running.current = true;
    try {
      if (
        mode === 'all' &&
        !(await confirm({
          title: t('cacheClearAll'),
          description: t('cacheClearConfirm'),
          detail: t('cachePreserved'),
          confirmLabel: t('cacheClearAll'),
        }))
      )
        return;
      setClearing(mode);
      setError(null);
      setRemoved(null);
      const result = await api.invoke('cache.clear', { mode });
      request.setData(result.stats);
      setRemoved(result.removed);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      running.current = false;
      setClearing(null);
    }
  };
  const stats = request.data,
    entries = stats ? stats.api.entries + stats.snapshots.entries : 0,
    expired = stats ? stats.api.expired + stats.snapshots.expired : 0,
    busy = request.pending || clearing !== null;
  const count = (value: number) => value.toLocaleString(locale);
  const loading = !stats && (request.pending || !request.error);
  return (
    <>
      <section
        className="settings-section @container/cache-usage flex min-w-0 flex-col gap-(--content-gap)"
        aria-labelledby="cache-usage-heading"
        aria-busy={request.pending || loading}
      >
        <div className="cache-section-heading flex items-center justify-between gap-4 [&_h3]:text-[1rem] [&_h3]:font-medium">
          <h3 id="cache-usage-heading">{t('cacheUsage')}</h3>
          <Button
            disabled={busy}
            aria-busy={request.pending}
            onClick={() => {
              setError(null);
              setRemoved(null);
              void load(() => api.invoke('cache.stats', null), true);
            }}
          >
            <Icon icon={faArrowsRotate} size={14} spin={request.pending} aria-hidden="true" />
            {t('refresh')}
          </Button>
        </div>
        {loading && <LoadingStatus />}
        {request.error && <Notice error>{request.error}</Notice>}
        <>
          <Stats
            className="viewport-max-767:[&>[data-slot=card]:last-child]:col-span-2"
            items={[
              { label: t('cacheEntries'), value: stats ? count(entries) : '—', pending: loading },
              { label: t('cacheExpired'), value: stats ? count(expired) : '—', pending: loading },
              {
                label: t('cacheDataSize'),
                value: stats ? formatSize(stats.api.bytes + stats.snapshots.bytes) : '—',
                pending: loading,
              },
            ]}
          />
          <div className="cache-category-grid grid grid-cols-1 gap-(--content-gap) @min-[36rem]/cache-usage:grid-cols-2">
            {(['api', 'snapshots'] as const).map((category) => (
              <Card
                size="sm"
                className="cache-category min-w-0 gap-3"
                role="group"
                aria-labelledby={'cache-' + category + '-heading'}
                key={category}
              >
                <CardHeader className="grid-cols-[minmax(0,_1fr)_auto] items-center gap-x-3 gap-y-1">
                  <CardTitle id={'cache-' + category + '-heading'} className="min-w-0">
                    {t('cacheCategory.' + category)}
                  </CardTitle>
                  <CardAction className="col-start-2 row-span-1 row-start-1 self-center">
                    <strong className="cache-category-size flex min-h-7 items-center text-xl font-semibold tabular-nums">
                      {loading ? (
                        <Skeleton className="h-6 w-24" aria-hidden="true" />
                      ) : stats ? (
                        formatSize(stats[category].bytes)
                      ) : (
                        '—'
                      )}
                    </strong>
                  </CardAction>
                  <CardDescription className="col-span-2">
                    {t('cacheCategoryHint.' + category)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="cache-category-counts flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {(['entries', 'expired'] as const).map((metric) => (
                      <div className="flex min-h-4.5 items-center gap-1.5" key={metric}>
                        <dt className="text-muted-foreground">
                          {t(metric === 'entries' ? 'cacheEntriesShort' : 'cacheExpiredShort')}
                        </dt>
                        <dd className="font-medium tabular-nums">
                          {loading ? (
                            <Skeleton className="h-4 w-10" aria-hidden="true" />
                          ) : stats ? (
                            count(stats[category][metric])
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t('cacheSizeHint')}</p>
        </>
      </section>
      <Card
        className="cache-cleanup @container/cache-cleanup"
        aria-labelledby="cache-cleanup-heading"
      >
        <CardHeader className="flex flex-col gap-4 @min-[40rem]/cache-cleanup:flex-row @min-[40rem]/cache-cleanup:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <CardTitle id="cache-cleanup-heading">{t('cacheCleanup')}</CardTitle>
            <CardDescription>
              {t('cacheCleanupHint')} {t('cachePreservedShort')}
            </CardDescription>
          </div>
          <CardAction className="w-full self-stretch @min-[40rem]/cache-cleanup:w-auto @min-[40rem]/cache-cleanup:shrink-0 @min-[40rem]/cache-cleanup:self-center">
            <div className="cache-actions grid gap-2 @min-[40rem]/cache-cleanup:flex">
              <Button
                disabled={busy || !stats || expired === 0}
                aria-busy={clearing === 'expired'}
                onClick={() => void clear('expired')}
              >
                <Icon icon={faBroom} size={14} aria-hidden="true" />
                {t(clearing === 'expired' ? 'cacheClearing' : 'cacheClearExpired')}
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !stats || entries === 0}
                aria-busy={clearing === 'all'}
                onClick={() => void clear('all')}
              >
                <Icon icon={faTrashCan} size={14} aria-hidden="true" />
                {t(clearing === 'all' ? 'cacheClearing' : 'cacheClearAll')}
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        {(error || removed !== null) && (
          <CardContent className="flex flex-col gap-3">
            {error && <Notice error>{error}</Notice>}
            {removed !== null && (
              <p role="status">{t('cacheCleared', { count: count(removed) })}</p>
            )}
          </CardContent>
        )}
      </Card>
    </>
  );
}
