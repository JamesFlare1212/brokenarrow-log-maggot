import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/state';
import { Button, Notice } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';

export function RecordingAudioSummary() {
  const { state } = useApp(),
    { t } = useI18n();
  const audio = state.recording.audio;
  if (!audio) return <span>{t('recordingAudioUnknown')}</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 whitespace-normal" data-recording-audio-summary>
      {(['system', 'microphone'] as const).map((source) => (
        <span key={source}>
          {t(source === 'system' ? 'audio' : 'recordingMicrophone')}:{' '}
          {t(`recordingAudio.${audio[source].state}`)}
        </span>
      ))}
    </span>
  );
}

export function RecordingAudioFeedback({
  settingsAvailable = true,
}: { settingsAvailable?: boolean } = {}) {
  const { api, state, openModal } = useApp(),
    { t } = useI18n();
  const recording = state.recording;
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0),
    currentSession = useRef(recording.sessionId);
  currentSession.current = recording.sessionId;
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setPending(false);
  }, [recording.sessionId]);
  useEffect(() => setError(null), [recording.sessionId, recording.audio]);
  const audio = recording.audio;
  if (
    !audio ||
    !Object.values(audio).some((source) => source.gap) ||
    recording.phase === 'error' ||
    (recording.phase === 'idle' && !recording.lastSavedName)
  )
    return null;
  const missing = Object.values(audio).some((source) => !['active', 'off'].includes(source.state));
  const retry = async () => {
    if (busy.current || !recording.sessionId) return;
    busy.current = true;
    const request = ++generation.current,
      sessionId = recording.sessionId;
    setPending(true);
    setError(null);
    try {
      await api.invoke('replays.retryAudio', { sessionId });
    } catch (failure) {
      if (generation.current !== request || currentSession.current !== sessionId) return;
      const message = String(failure),
        code = [
          'RECORDING_AUDIO_RETRY_UNAVAILABLE',
          'RECORDING_AUDIO_RETRY_PENDING',
          'RECORDING_AUDIO_RETRY_TIMEOUT',
          'RECORDING_AUDIO_UNAVAILABLE',
        ].find((code) => message.includes(code));
      setError(code ? t(code) : message);
    } finally {
      if (generation.current === request) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  return (
    <Notice error>
      <div className="min-w-0 flex-1 space-y-2 wrap-anywhere" data-recording-audio-feedback>
        <p>
          {t(
            recording.phase === 'idle'
              ? 'recordingAudioSavedGap'
              : missing
                ? 'recordingAudioMissing'
                : 'recordingAudioRecovered',
          )}
        </p>
        {recording.phase === 'idle' && <p>{t('recordingAudioAtFinish')}</p>}
        <RecordingAudioSummary />
        {recording.phase === 'idle' && <p>{recording.lastSavedName}</p>}
        <p>{t('recordingAudioGapLimit')}</p>
        {missing && recording.phase === 'recording' && (
          <>
            <p>
              {t('recordingAudioRetryLimit')} {t('recordingAudioCheckDevices')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending || recording.audioRetryPending}
                aria-busy={pending || recording.audioRetryPending}
                onClick={() => void retry()}
              >
                {t('recordingAudioRetry')}
              </Button>
              {settingsAvailable && (
                <Button onClick={() => openModal({ type: 'recordingSettings' })}>
                  {t('recordingSettings')}
                </Button>
              )}
            </div>
          </>
        )}
        {(error || recording.audioRetryError) && (
          <p role="alert">{error || t(recording.audioRetryError!)}</p>
        )}
      </div>
    </Notice>
  );
}
