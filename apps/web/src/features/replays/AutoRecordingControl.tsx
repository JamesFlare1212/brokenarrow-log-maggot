import { useRef, useState } from 'react';
import type { RecordingState } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Dialog, Notice, Toggle } from '../../components/ui';

export function AutoRecordingControl({ id }: { id: string }) {
  const { state, recordingPreference: preference } = useApp(),
    { t } = useI18n();
  const [review, setReview] = useState<RecordingState | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const active = ['starting', 'recording', 'stopping'].includes(state.recording.phase);
  const openReview = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReview({ ...state.recording });
  };
  const choose = async (stop: boolean) => {
    if (!review || (stop && !review.sessionId)) return;
    if (await preference.change(false, stop ? review.sessionId! : undefined)) setReview(null);
  };
  const checked = preference.pending ? preference.requested! : state.config.replayEnabled;
  const errorMessage = (message: string) =>
    message.includes('RECORDING_TARGET_CHANGED') ? t('RECORDING_TARGET_CHANGED') : message;
  return (
    <div className="min-w-0 space-y-2">
      <div aria-busy={preference.pending}>
        <Toggle
          id={id}
          label={t('autoRecord')}
          labelClickable={false}
          checked={checked}
          disabled={preference.pending}
          aria-describedby={`${id}-hint`}
          onChange={(enabled) => {
            if (!enabled && active) openReview();
            else void preference.change(enabled);
          }}
        />
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t(
          state.watcher.error ||
            state.watcher.live === false ||
            !state.watcher.listening ||
            state.watcher.recovering
            ? active
              ? 'logMonitoringCaptureContinues'
              : 'logMonitoringRecordingWaits'
            : 'autoRecordChoiceHint',
        )}
      </p>
      {active && !checked && (
        <Button disabled={preference.pending} onClick={openReview}>
          {t('recordingStopCurrent')}
        </Button>
      )}
      {preference.pending && (
        <p role="status" className="text-sm">
          {t('settingsSaving')}
        </p>
      )}
      {preference.failure && (
        <Notice error>
          <div className="min-w-0 flex-1 space-y-2 wrap-anywhere">
            <p>{t('recordingPreferenceNotSaved')}</p>
            <p>{preference.failure.message}</p>
            <Button
              disabled={preference.pending}
              onClick={() => void preference.change(preference.failure!.enabled)}
            >
              {t('settingsRetry')}
            </Button>
            <Button disabled={preference.pending} onClick={preference.discard}>
              {t('settingsDiscard')}
            </Button>
          </div>
        </Notice>
      )}
      {preference.captureError && (
        <Notice error>
          <div className="min-w-0 flex-1 space-y-2 wrap-anywhere">
            <p>{t('recordingPreferenceSavedCaptureUnchanged')}</p>
            <p>{errorMessage(preference.captureError)}</p>
          </div>
        </Notice>
      )}
      {preference.stopped && <Notice>{t('recordingStopCompleted')}</Notice>}
      <Dialog
        open={review !== null}
        title={t('recordingDisableTitle')}
        opener={opener.current}
        dismissible={!preference.pending}
        onClose={() => {
          if (!preference.pending) setReview(null);
        }}
      >
        <div className="space-y-4 wrap-anywhere">
          <p>{t('recordingDisableExplanation')}</p>
          {review && (
            <p>
              {t('recordingReviewedCapture', { map: review.map || '—', id: review.fid || '—' })}
            </p>
          )}
          <p>{t('recordingStopWarning')}</p>
          {review?.phase === 'starting' && <p>{t('recordingStartingStopWarning')}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={preference.pending} onClick={() => setReview(null)}>
              {t('cancel')}
            </Button>
            <Button
              className="h-auto min-h-8 whitespace-normal py-2 text-left"
              disabled={preference.pending}
              onClick={() => void choose(false)}
            >
              {t('recordingFinishCurrent')}
            </Button>
            <Button
              className="h-auto min-h-8 whitespace-normal py-2 text-left"
              disabled={preference.pending || !review?.sessionId}
              onClick={() => void choose(true)}
            >
              {t('recordingStopNow')}
            </Button>
          </div>
          {preference.failure && (
            <Notice error>
              {t('recordingPreferenceNotSaved')} {preference.failure.message}
            </Notice>
          )}
        </div>
      </Dialog>
    </div>
  );
}
