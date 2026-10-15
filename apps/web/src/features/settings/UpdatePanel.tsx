import { useState } from 'react';
import { Download, RefreshCw, RotateCw, ExternalLink } from 'lucide-react';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Notice } from '../../components/ui';

export function UpdatePanel({ compact = false }: { compact?: boolean }) {
  const { api, state, notify, setPage } = useApp(),
    { t } = useI18n();
  const [pending, setPending] = useState(false);
  const update = state.updates;
  const busy = pending || ['checking', 'downloading', 'installing'].includes(update.status);
  const blocked =
    Boolean(state.session.current && !state.session.current.endedAt) ||
    ['starting', 'recording', 'stopping'].includes(state.recording.phase);
  const action = (
    method: 'updates.check' | 'updates.download' | 'updates.install' | 'updates.openDownload',
  ) => {
    setPending(true);
    void api
      .invoke(method, null)
      .catch((error) => notify(String(error), true))
      .finally(() => setPending(false));
  };
  if (compact) {
    if (
      !['available', 'downloading', 'downloaded', 'installing'].includes(update.status) &&
      !update.notAppliedVersion
    )
      return null;
    return (
      <Notice>
        <span role="status">
          {update.notAppliedVersion
            ? t('updateNotApplied', { version: update.notAppliedVersion })
            : t('update.' + update.status, {
                version: update.availableVersion || '',
                percent: update.downloadPercent ?? 0,
              })}
        </span>
        <Button onClick={() => setPage('about')}>{t('updateDetails')}</Button>
      </Notice>
    );
  }
  return (
    <section className="update-panel" aria-label={t('appUpdates')} aria-busy={busy}>
      <h3>{t('appUpdates')}</h3>
      <p role="status" aria-live="polite">
        {t('update.' + update.status, {
          version: update.availableVersion || '',
          percent: update.downloadPercent ?? 0,
        })}
      </p>
      {update.mode === 'portable' && <p className="muted">{t('updatePortable')}</p>}
      {update.checkedAt !== null && (
        <p className="muted">
          {t('updateCheckedAt', { time: new Date(update.checkedAt).toLocaleString() })}
        </p>
      )}
      {update.status === 'downloading' && (
        <progress max={100} value={update.downloadPercent ?? 0} aria-label={t('updateProgress')} />
      )}
      {update.notAppliedVersion && (
        <Notice error>{t('updateNotApplied', { version: update.notAppliedVersion })}</Notice>
      )}
      {update.error && (
        <Notice error>
          {t('updateFailed')} {update.error}
        </Notice>
      )}
      <div className="actions">
        <Button
          disabled={busy || update.mode === 'disabled' || update.status === 'downloaded'}
          onClick={() => action('updates.check')}
        >
          <RefreshCw size={16} />
          {t('updateCheck')}
        </Button>
        {update.mode === 'installed' &&
          (update.status === 'available' ||
            (update.status === 'error' && update.errorContext === 'download')) && (
            <Button variant="primary" disabled={busy} onClick={() => action('updates.download')}>
              <Download size={16} />
              {t(update.errorContext === 'download' ? 'updateRetryDownload' : 'updateDownload')}
            </Button>
          )}
        {update.mode === 'installed' && update.status === 'downloaded' && (
          <Button
            variant="primary"
            disabled={busy || blocked}
            onClick={() => action('updates.install')}
          >
            <RotateCw size={16} />
            {t('updateInstall')}
          </Button>
        )}
        <Button disabled={pending} onClick={() => action('updates.openDownload')}>
          <ExternalLink size={16} />
          {t('updateReleasePage')}
        </Button>
      </div>
      {update.status === 'downloaded' && blocked && <p className="muted">{t('updateBlocked')}</p>}
    </section>
  );
}
