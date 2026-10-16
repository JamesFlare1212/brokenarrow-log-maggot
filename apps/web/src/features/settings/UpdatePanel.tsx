import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button } from '../../components/ui';
import { UpdateButton } from './UpdateButton';

export function UpdatePanel() {
  const { api, state, notify } = useApp(),
    { t } = useI18n();
  const update = state.updates;
  const blocked =
    update.status === 'downloaded' &&
    (Boolean(state.session.current && !state.session.current.endedAt) ||
      ['starting', 'recording', 'stopping'].includes(state.recording.phase));
  const status = blocked
    ? t('updateBlocked')
    : t('update.' + update.status, {
        version: update.availableVersion || '',
        percent: update.downloadPercent ?? 0,
      });

  return (
    <div className="settings-about-row" aria-label={t('appUpdates')}>
      <div className="settings-about-copy">
        <div className="settings-about-title">
          <strong>{t('version')}</strong>
          <code>v{update.currentVersion}</code>
        </div>
        <p role="status">{status}</p>
        {update.mode === 'portable' && <p>{t('updatePortable')}</p>}
        {update.mode === 'installed' && update.status === 'available' && (
          <p>{t('updateManualInstall')}</p>
        )}
        {update.status === 'downloading' && (
          <progress
            max={100}
            value={update.downloadPercent ?? 0}
            aria-label={t('updateProgress')}
          />
        )}
        {(update.error || update.notAppliedVersion) && (
          <div className="settings-update-error" role="alert">
            {update.error && (
              <p>
                {t('updateFailed')} {update.error}
              </p>
            )}
            {update.notAppliedVersion && (
              <p>{t('updateNotApplied', { version: update.notAppliedVersion })}</p>
            )}
            <Button
              onClick={() =>
                void api
                  .invoke('updates.openDownload', null)
                  .catch((error) => notify(String(error), true))
              }
            >
              {t('updateReleasePage')}
            </Button>
          </div>
        )}
      </div>
      <UpdateButton inline />
    </div>
  );
}
