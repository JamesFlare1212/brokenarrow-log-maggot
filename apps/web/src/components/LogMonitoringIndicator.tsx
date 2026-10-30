import { useId, useRef, useState } from 'react';
import { Clock3, FolderSearch, Radio, TriangleAlert, Unplug } from 'lucide-react';
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
import { useApp } from '../app/state';
import { useI18n } from '../hooks/useI18n';

export function LogMonitoringIndicator() {
  const { state, monitoring, openSettings } = useApp();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const title = useId();
  const region = useRef<HTMLDivElement>(null);
  const watcher = state.watcher;
  const key =
    watcher.error || monitoring.error
      ? 'logMonitoringIssue'
      : monitoring.pending || watcher.recovering
        ? 'logMonitoringChecking'
        : !watcher.listening
          ? 'notListening'
          : !watcher.file
            ? 'logMonitoringWaiting'
            : watcher.live === false
              ? 'logMonitoringStale'
              : 'listening';
  const label = t(key);
  const Icon =
    key === 'logMonitoringIssue'
      ? TriangleAlert
      : !watcher.listening
        ? Unplug
        : !watcher.file
          ? FolderSearch
          : watcher.live === false
            ? Clock3
            : Radio;
  const refresh = async () => {
    const opener = document.activeElement;
    await monitoring.refresh();
    if (document.activeElement === opener) region.current?.focus({ preventScroll: true });
  };
  return (
    <div data-log-status="" data-log-state={key} className="shrink-0">
      <span
        className="sr-only"
        role="status"
        aria-label={t('logMonitoringTitle')}
        aria-live="polite"
      >
        {t('logMonitoringReview', { status: label })}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={key === 'logMonitoringIssue' ? 'destructive' : 'ghost'}
            size="sm"
            className="w-30 shrink-0 justify-start"
            aria-label={t('logMonitoringReview', { status: label })}
          >
            {monitoring.pending ? <Spinner /> : <Icon />}
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
            <PopoverTitle id={title}>{t('logMonitoringTitle')}</PopoverTitle>
          </PopoverHeader>
          <div
            ref={region}
            role="region"
            tabIndex={0}
            aria-label={t('logMonitoringDetails')}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
          >
            <p>
              {t(
                key === 'logMonitoringIssue'
                  ? 'logMonitoringFailureHint'
                  : key === 'logMonitoringWaiting'
                    ? 'logMonitoringWaitingHint'
                    : key === 'logMonitoringStale'
                      ? 'logMonitoringStaleHint'
                      : key === 'logMonitoringChecking'
                        ? 'logMonitoringCheckingHint'
                        : !watcher.listening
                          ? 'logMonitoringDisabledHint'
                          : 'logMonitoringReadyHint',
              )}
            </p>
            {['starting', 'recording', 'stopping'].includes(state.recording.phase) &&
              key === 'logMonitoringIssue' && <p>{t('logMonitoringCaptureContinues')}</p>}
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="text-muted-foreground">{t('logDirectory')}</dt>
                <dd>{watcher.dir || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('logMonitoringFile')}</dt>
                <dd>{watcher.file || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('logMonitoringLastCheck')}</dt>
                <dd>{watcher.checkedAt ? formatTime(watcher.checkedAt, locale) : '—'}</dd>
              </div>
            </dl>
            {(watcher.error || monitoring.error) && (
              <p className="text-destructive" role="alert">
                {monitoring.error || watcher.error}
              </p>
            )}
          </div>
          <div className="flex min-h-8 shrink-0 flex-wrap justify-end gap-2 border-t pt-2">
            <Button
              size="sm"
              variant="outline"
              aria-disabled={monitoring.pending || !watcher.listening}
              onClick={() => {
                if (!monitoring.pending && watcher.listening) void refresh();
              }}
            >
              {t('logMonitoringRetry')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(false);
                openSettings('connection');
              }}
            >
              {t('logMonitoringSettings')}
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
