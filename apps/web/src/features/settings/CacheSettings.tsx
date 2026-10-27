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
import { Button, Loading, Notice, Stats } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';

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
  return (
    <>
      <section className="settings-section" aria-labelledby="cache-usage-heading">
        <div className="cache-section-heading">
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
        {request.pending && !stats && <Loading />}
        {request.error && <Notice error>{request.error}</Notice>}
        {stats && (
          <>
            <Stats
              items={[
                { label: t('cacheEntries'), value: count(entries) },
                { label: t('cacheExpired'), value: count(expired) },
                {
                  label: t('cacheDataSize'),
                  value: formatSize(stats.api.bytes + stats.snapshots.bytes),
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
                      <strong>{formatSize(stats[category].bytes)}</strong>
                      <span>
                        {t('cacheEntrySummary', {
                          entries: count(stats[category].entries),
                          expired: count(stats[category].expired),
                        })}
                      </span>
                    </div>
                  </ItemActions>
                </Item>
              ))}
            </div>
            <p>{t('cacheSizeHint')}</p>
          </>
        )}
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
          {error && <Notice error>{error}</Notice>}
          {removed !== null && <p role="status">{t('cacheCleared', { count: count(removed) })}</p>}
        </CardContent>
      </Card>
    </>
  );
}
