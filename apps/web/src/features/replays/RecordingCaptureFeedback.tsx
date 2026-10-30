import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Notice } from '../../components/ui';
import { RecordingAudioFeedback } from './RecordingAudioFeedback';
import { RecordingDisplayFeedback } from './RecordingDisplayFeedback';

export function RecordingCaptureFeedback({
  settingsAvailable = true,
}: { settingsAvailable?: boolean } = {}) {
  const { api, state } = useApp(),
    { t } = useI18n();
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const recording = state.recording;
  useEffect(() => setError(null), [recording.error, recording.sessionId]);
  if (!recording.error && recording.phase !== 'error')
    return (
      <>
        <RecordingDisplayFeedback />
        <RecordingAudioFeedback settingsAvailable={settingsAvailable} />
      </>
    );
  const retryAvailable =
    recording.phase === 'error' &&
    state.config.replayEnabled &&
    !!state.session.current &&
    state.session.current.endedAt === null &&
    !state.session.recovering &&
    state.watcher.live &&
    !state.watcher.error;
  const retry = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await api.invoke('replays.retry', null);
    } catch (failure) {
      setError(
        String(failure).includes('RECORDING_RETRY_UNAVAILABLE')
          ? t('RECORDING_RETRY_UNAVAILABLE')
          : String(failure),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <>
      <RecordingDisplayFeedback />
      <RecordingAudioFeedback settingsAvailable={settingsAvailable} />
      <Notice error>
        <div className="min-w-0 flex-1 space-y-2 wrap-anywhere" data-recording-capture-feedback>
          <p>
            {t(
              recording.failure?.kind === 'metadata'
                ? 'recordingSavedWithWarning'
                : recording.failure?.kind === 'start'
                  ? 'recordingStartFailed'
                  : 'recordingCaptureFailed',
            )}
          </p>
          {recording.failure?.savedName && <p>{recording.failure.savedName}</p>}
          <p>{recording.error}</p>
          {recording.failure && recording.failure.kind !== 'metadata' && (
            <p>
              {t(
                recording.failure.discarded
                  ? 'recordingTemporaryDiscarded'
                  : 'recordingTemporaryRemains',
              )}
            </p>
          )}
          {recording.failure?.kind !== 'metadata' && (
            <>
              <p>{t('recordingRetryLimit')}</p>
              {retryAvailable ? (
                <Button disabled={pending} aria-busy={pending} onClick={() => void retry()}>
                  {t('recordingRetryCurrent')}
                </Button>
              ) : (
                <p>{t('recordingRetryCondition')}</p>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </div>
      </Notice>
    </>
  );
}
