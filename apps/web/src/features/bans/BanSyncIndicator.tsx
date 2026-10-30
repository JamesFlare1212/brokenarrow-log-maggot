import { useId, useRef, useState } from 'react';
import { Clock3, CircleCheck, TriangleAlert } from 'lucide-react';
import { formatTime } from '@ba/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';

export function BanSyncIndicator({
  loading,
  readError,
  loaded,
  reload,
  hasUpdates = false,
  snapshotTime,
}: {
  loading: boolean;
  readError: string | null;
  loaded: boolean;
  hasUpdates?: boolean;
  snapshotTime?: number;
  reload: (apply?: boolean) => Promise<unknown>;
}) {
  const { state, banSynchronization } = useApp();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const title = useId();
  const region = useRef<HTMLDivElement>(null);
  const status = state.banSync;
  const error = banSynchronization.error || status.error;
  const key = readError
    ? 'banListReadIssue'
    : error
      ? 'banSyncFailed'
      : banSynchronization.pending
        ? 'banSyncPending'
        : loading
          ? 'banListReading'
          : status.lastSuccessAt
            ? 'banSyncSuccess'
            : 'banSyncNever';
  const label = t(key);
  const Icon = readError || error ? TriangleAlert : status.lastSuccessAt ? CircleCheck : Clock3;
  const act = async (action: () => Promise<unknown>) => {
    const opener = document.activeElement;
    await action();
    if (document.activeElement === opener) region.current?.focus({ preventScroll: true });
  };
  return (
    <div className="shrink-0" data-ban-sync-state={key}>
      <span className="sr-only" role="status" aria-label={t('banSyncTitle')}>
        {t('banSyncReview', { status: label })}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={readError || error ? 'destructive' : 'outline'}
            className="w-32 justify-start"
            aria-label={t('banSyncReview', { status: label })}
          >
            {banSynchronization.pending || loading ? <Spinner /> : <Icon />}
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-labelledby={title}
          className="log-monitoring-popover"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            region.current?.focus();
          }}
        >
          <PopoverHeader className="shrink-0">
            <PopoverTitle id={title}>{t('banSyncTitle')}</PopoverTitle>
          </PopoverHeader>
          <div
            ref={region}
            role="region"
            tabIndex={0}
            aria-label={t('banSyncDetails')}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
          >
            <p>
              {t(
                error
                  ? 'banSyncFailureHint'
                  : banSynchronization.pending
                    ? 'banSyncPendingHint'
                    : status.lastSuccessAt
                      ? 'banSyncSuccessHint'
                      : 'banSyncNeverHint',
              )}
            </p>
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="text-muted-foreground">{t('banSyncLastAttempt')}</dt>
                <dd>{status.lastAttemptAt ? formatTime(status.lastAttemptAt, locale) : '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('banSyncLastSuccess')}</dt>
                <dd>{status.lastSuccessAt ? formatTime(status.lastSuccessAt, locale) : '—'}</dd>
              </div>
            </dl>
            <p>
              {t(
                readError
                  ? loaded
                    ? 'banListRetainedHint'
                    : 'banListUnknownHint'
                  : hasUpdates
                    ? 'banListUpdatesRetainedHint'
                    : loading
                      ? 'banListLoadingHint'
                      : 'banListReadyHint',
              )}
            </p>
            {snapshotTime && (
              <p>{t('banListSnapshotTime', { time: formatTime(snapshotTime, locale) })}</p>
            )}
            {(error || readError) && (
              <p role="alert" className="text-destructive">
                {[error === 'BAN_SYNC_INTERRUPTED' ? t('banSyncInterrupted') : error, readError]
                  .filter(Boolean)
                  .join('\n')}
              </p>
            )}
          </div>
          <div className="flex min-h-8 shrink-0 flex-wrap justify-end gap-2 border-t pt-2">
            <Button
              size="sm"
              variant="outline"
              aria-disabled={loading}
              onClick={() => {
                if (!loading) void act(reload);
              }}
            >
              {t('banListReload')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-disabled={banSynchronization.pending}
              onClick={() => {
                if (!banSynchronization.pending)
                  void act(async () => {
                    if (await banSynchronization.synchronize()) await reload(false);
                  });
              }}
            >
              {t('sync')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              {t('close')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
