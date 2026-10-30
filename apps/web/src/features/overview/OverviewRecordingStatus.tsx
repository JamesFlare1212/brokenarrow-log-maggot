import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Settings, TriangleAlert, Video } from 'lucide-react';
import { formatDuration } from '@ba/shared';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Item, ItemActions, ItemMedia } from '@/components/ui/item';
import { Button } from '../../components/ui';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { RecordingCaptureFeedback } from '../replays/RecordingCaptureFeedback';

export function OverviewRecordingStatus() {
  const { state, openModal } = useApp(),
    { t } = useI18n();
  const [open, setOpen] = useState(false);
  const title = useId(),
    region = useRef<HTMLDivElement>(null),
    focused = useRef<HTMLElement | null>(null);
  const recording = state.recording;
  const failed = !!recording.error || recording.phase === 'error';
  const attention =
    failed ||
    (recording.display?.selection === 'fallback' &&
      ['starting', 'recording', 'stopping'].includes(recording.phase)) ||
    (recording.audio &&
      Object.values(recording.audio).some((source) => source.gap) &&
      (recording.phase !== 'idle' || !!recording.lastSavedName));
  const label = t(
    failed
      ? 'recordingFailed'
      : attention
        ? 'recordingNeedsAttention'
        : recording.phase === 'recording'
          ? 'recording'
          : recording.phase === 'starting'
            ? 'starting'
            : recording.phase === 'stopping'
              ? 'stopping'
              : state.config.replayEnabled
                ? 'recordingReady'
                : 'recordingOff',
  );
  useLayoutEffect(() => {
    if (
      open &&
      focused.current &&
      !focused.current.isConnected &&
      document.activeElement === document.body
    )
      region.current?.focus({ preventScroll: true });
  }, [open, recording]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Item size="xs" className="h-14 shrink-0" data-overview-recording-status>
        <ItemMedia variant="icon">{attention ? <TriangleAlert /> : <Video />}</ItemMedia>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto min-w-0 flex-1 justify-start px-0 text-left"
            aria-label={t('recordingStatusReview', { status: label })}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate">{t('replays')}</span>
              <span className="truncate">
                {label}
                {recording.phase === 'recording' && <> · {formatDuration(recording.seconds)}</>}
              </span>
            </span>
          </Button>
        </PopoverTrigger>
        <span className="sr-only" role="status" aria-live="polite">
          {t('recordingStatusReview', { status: label })}
        </span>
        <ItemActions>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t(state.config.replayEnabled ? 'recordingSettings' : 'enableRecording')}
            onClick={() => openModal({ type: 'recordingSettings' })}
          >
            <Settings />
          </Button>
        </ItemActions>
      </Item>
      <PopoverContent
        align="end"
        className="overview-recording-popover"
        aria-labelledby={title}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          region.current?.focus({ preventScroll: true });
        }}
      >
        <PopoverHeader>
          <PopoverTitle id={title}>{t('recordingStatus')}</PopoverTitle>
        </PopoverHeader>
        <div
          ref={region}
          role="region"
          tabIndex={0}
          aria-label={t('recordingStatusDetails')}
          className="overview-recording-details"
          onFocusCapture={(event) => {
            focused.current = event.target as HTMLElement;
          }}
        >
          <p>
            {label}
            {recording.phase === 'recording' && <> · {formatDuration(recording.seconds)}</>}
          </p>
          <RecordingCaptureFeedback />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 self-end"
          onClick={() => setOpen(false)}
        >
          {t('close')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
