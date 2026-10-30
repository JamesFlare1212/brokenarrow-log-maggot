import { useId } from 'react';
import { Progress } from '@/components/ui/progress';

import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Notice } from '../../components/ui';
import { UpdateButton } from './UpdateButton';
import { updateActivityBlocked, updateStatusText } from './update-status';

export function UpdatePanel() {
  const { state, updater } = useApp(),
    { t, locale } = useI18n();
  const statusId = useId();
  const update = state.updates;
  const blocked = updateActivityBlocked(update, state.session, state.recording);
  const error = updater.pending ? null : (updater.error ?? update.error);
  const status = updateStatusText(update, locale, blocked, updater.action, error);

  return (
    <div className="flex flex-col gap-4" aria-label={t('appUpdates')} data-update-panel="">
      <div
        className="settings-about-row"
        onFocus={(event) =>
          event.currentTarget.scrollIntoView({ block: 'nearest', behavior: 'instant' })
        }
      >
        <div className="settings-about-copy">
          <div className="settings-about-title">
            <strong>{t('version')}</strong>
            <code>v{update.currentVersion}</code>
          </div>
          <div
            role="region"
            tabIndex={0}
            aria-label={t('updateStatusLabel')}
            className="flex h-28 flex-col gap-2 overflow-y-auto wrap-anywhere focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-ring"
          >
            <p id={statusId} role="status">
              {status}
            </p>
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
          </div>
        </div>
        <UpdateButton inline describedBy={statusId} />
      </div>
      {(error || update.notAppliedVersion) && (
        <Notice error>
          {error && (
            <p>
              {t('updateFailed')} {error}
            </p>
          )}
          {update.notAppliedVersion && (
            <p>{t('updateNotApplied', { version: update.notAppliedVersion })}</p>
          )}
          <Button aria-disabled={updater.pending} onClick={() => void updater.run('open')}>
            {t('updateReleasePage')}
          </Button>
        </Notice>
      )}
    </div>
  );
}
