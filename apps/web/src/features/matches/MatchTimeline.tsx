import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MatchTimelineResult, Mode } from '@ba/contracts';
import { RefreshCw } from 'lucide-react';
import { useApp } from '@/app/state';
import { useI18n } from '@/hooks/useI18n';
import { useRequest } from '@/hooks/useRequest';
import { Empty, Notice } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadingStatus } from '@/components/LoadingState';

const TimelineView = lazy(() =>
  import('../timeline/TimelineView').then((module) => ({ default: module.TimelineView })),
);

function TimelineLoading() {
  return (
    <div className="flex flex-col gap-4" data-testid="timeline-loading">
      <LoadingStatus />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** Resolve the actual archive/dialog scrolling surface, not the Electron window. */
export function timelineScrollContainer(element: HTMLElement): HTMLElement | null {
  let container: HTMLElement | null = element.parentElement;
  while (container && container !== document.body && container !== document.documentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(container).overflowY)) break;
    container = container.parentElement;
  }
  return container === document.body || container === document.documentElement ? null : container;
}

export function MatchTimeline({
  fid,
  mode,
  refreshVersion = 0,
}: {
  fid: string | null;
  mode?: Mode;
  refreshVersion?: number;
}) {
  const { api } = useApp();
  const { t } = useI18n();
  const request = useRequest<MatchTimelineResult>();
  const host = useRef<HTMLDivElement>(null);
  const previousRefresh = useRef(refreshVersion);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const supported = !!fid && mode !== 'pve';
  useLayoutEffect(() => {
    if (host.current) setScrollContainer(timelineScrollContainer(host.current));
  }, []);
  useEffect(() => {
    const force = previousRefresh.current !== refreshVersion;
    previousRefresh.current = refreshVersion;
    if (!supported) {
      request.invalidate();
      return;
    }
    void request.load(() => api.invoke('matches.timeline', { fid: fid!, force }), force);
  }, [api, fid, supported, refreshVersion, request.load, request.invalidate]);
  const reload = () => {
    if (supported)
      void request.load(
        () => api.invoke('matches.timeline', { fid: fid!, force: true }),
        !!request.data,
      );
  };
  const result = request.data;
  const reason = !fid
    ? 'matchTimelineLocalUnavailable'
    : mode === 'pve' || result?.reason === 'unsupported-mode'
      ? 'matchTimelineUnsupported'
      : result?.reason === 'invalid-time'
        ? 'matchTimelineInvalidTime'
        : 'matchTimelineMissingData';
  const ready =
    supported &&
    result?.status === 'ready' &&
    !!result.data?.frames.length &&
    !!result.data.points.length;
  return (
    <div
      ref={host}
      className="flex min-w-0 flex-col gap-4"
      aria-label={t('matchTimeline')}
      aria-busy={request.pending}
      data-testid="match-timeline"
    >
      {supported && request.error && (
        <Notice error>
          <span>
            {t('matchTimelineError')}: {request.error}
          </span>
          <Button variant="outline" onClick={reload} disabled={request.pending}>
            {t('retry')}
          </Button>
        </Notice>
      )}
      {supported && !result && !request.error ? (
        <TimelineLoading />
      ) : !ready && (!supported || !!result) ? (
        <Empty
          description={t(reason)}
          action={
            supported && result?.reason !== 'unsupported-mode' ? (
              <Button variant="outline" onClick={reload} disabled={request.pending}>
                <RefreshCw data-icon="inline-start" />
                {t('refresh')}
              </Button>
            ) : undefined
          }
        >
          {t('matchTimelineUnavailable')}
        </Empty>
      ) : null}
      {ready && result?.data && (
        <>
          {request.pending && <LoadingStatus />}
          {result.source === 'stale' && <Notice>{t('matchTimelineCached')}</Notice>}
          <Suspense fallback={<TimelineLoading />}>
            <TimelineView
              key={`${fid}:${result.updatedAt ?? 'unknown'}`}
              data={result.data}
              scrollContainer={scrollContainer}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}
