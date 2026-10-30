import type { Locale, RecordingState, Session, UpdateState } from '@ba/contracts';
import type { UpdateAction } from '../../hooks/useUpdateActions';
import { translate } from '../../hooks/useI18n';

export function updateActivityBlocked(
  update: UpdateState,
  session: Session,
  recording: RecordingState,
) {
  return (
    update.status === 'downloaded' &&
    (Boolean(session.current && !session.current.endedAt) ||
      ['starting', 'recording', 'stopping'].includes(recording.phase))
  );
}

export function updateStatusText(
  update: UpdateState,
  locale: Locale,
  blocked: boolean,
  action: UpdateAction | null,
  error: string | null,
) {
  const t = (key: string) =>
    translate(locale, key, {
      version: update.availableVersion ?? '',
      percent: update.downloadPercent ?? 0,
    });
  if (action)
    return t(
      action === 'open'
        ? 'updateOpeningDownloads'
        : action === 'install'
          ? 'update.installing'
          : action === 'download'
            ? 'update.downloading'
            : 'update.checking',
    );
  if (error) return t('updateFailed');
  if (blocked) return t('updateBlocked');
  if (update.installBlocked && update.status === 'downloaded') return t('updateInstallBlocked');
  return t('update.' + update.status);
}
