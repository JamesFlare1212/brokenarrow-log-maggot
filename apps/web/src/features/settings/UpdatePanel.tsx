import { Progress } from '@/components/ui/progress';

import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Notice } from '../../components/ui';
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
    <div
      className="settings-update-row flex min-w-0 flex-col gap-3 @min-[32rem]/about-settings:flex-row @min-[32rem]/about-settings:items-start"
      aria-label={t('appUpdates')}
    >
      <div className="settings-about-copy flex min-w-0 flex-1 flex-col gap-1.5 [&_p]:text-sm [&_p]:text-muted-foreground [&_p]:wrap-anywhere">
        <div className="settings-about-title flex flex-wrap items-baseline gap-2">
          <span className="text-sm text-muted-foreground">{t('version')}</span>
          <code className="text-base font-medium tabular-nums">v{update.currentVersion}</code>
        </div>
        <p role="status">{update.mode === 'disabled' ? t('updateUnavailable') : status}</p>
        {update.mode === 'portable' && <p>{t('updatePortable')}</p>}
        {update.mode === 'installed' && update.status === 'available' && (
          <p>{t('updateManualInstall')}</p>
        )}
        {update.status === 'downloading' && (
          <Progress
            max={100}
            value={update.downloadPercent ?? 0}
            aria-label={t('updateProgress')}
          />
        )}
        {(update.error || update.notAppliedVersion) && (
          <Notice error>
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
          </Notice>
        )}
      </div>
      <div className="settings-update-action w-full shrink-0 @min-[32rem]/about-settings:w-auto [&>span]:w-full [&_button]:w-full">
        <UpdateButton inline />
      </div>
    </div>
  );
}
