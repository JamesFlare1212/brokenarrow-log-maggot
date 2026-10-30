import { useApp } from '../../app/state';
import { Notice } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';

export function RecordingDisplayFeedback() {
  const { state } = useApp(),
    { t } = useI18n(),
    recording = state.recording,
    target = recording.display;
  if (
    target?.selection !== 'fallback' ||
    !['starting', 'recording', 'stopping'].includes(recording.phase)
  )
    return null;
  return (
    <Notice>
      <p data-recording-display-feedback>
        {t(
          recording.phase === 'starting'
            ? 'recordingDisplayFallbackStarting'
            : 'recordingDisplayFallback',
          { id: target.requestedId, display: target.label ?? target.sourceId ?? t('unknown') },
        )}
      </p>
    </Notice>
  );
}
