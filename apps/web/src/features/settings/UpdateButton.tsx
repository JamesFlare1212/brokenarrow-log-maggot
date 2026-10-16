import { useState } from 'react';
import { Download, LoaderCircle, RefreshCw, RotateCw } from 'lucide-react';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button } from '../../components/ui';

export function UpdateButton({ inline = false }: { inline?: boolean }) {
  const { api, state, notify } = useApp(),
    { t } = useI18n();
  const [pending, setPending] = useState(false);
  const update = state.updates;
  const active = ['checking', 'downloading', 'installing'].includes(update.status);
  const busy = pending || active;
  const ready = update.status === 'downloaded';
  const available =
    update.status === 'available' ||
    (update.status === 'error' && update.errorContext === 'download');
  const blocked =
    ready &&
    (Boolean(state.session.current && !state.session.current.endedAt) ||
      ['starting', 'recording', 'stopping'].includes(state.recording.phase));
  const actionLabel = t(
    ready || update.status === 'installing'
      ? 'updateInstall'
      : available || update.status === 'downloading'
        ? inline && update.mode === 'portable'
          ? 'updateReleasePage'
          : inline && update.errorContext === 'download'
            ? 'updateRetryDownload'
            : 'updateDownload'
        : 'updateCheck',
  );
  const label =
    active && !inline
      ? t('update.' + update.status, { percent: update.downloadPercent ?? 0 })
      : actionLabel;
  const detail =
    update.mode === 'disabled'
      ? t('update.disabled')
      : blocked
        ? t('updateBlocked')
        : available
          ? `${t('update.available', { version: update.availableVersion || '' })}. ${t(update.mode === 'portable' ? 'updatePortable' : 'updateAutoInstall')}`
          : update.error || label;
  const Icon = busy ? LoaderCircle : ready ? RotateCw : available ? Download : RefreshCw;

  async function activate() {
    if (busy) return;
    setPending(true);
    try {
      if (available && update.mode === 'portable') {
        await api.invoke('updates.openDownload', null);
        return;
      }
      const result = await api.invoke(
        ready ? 'updates.install' : available ? 'updates.download' : 'updates.check',
        null,
      );
      if (result.error) notify(`${t('updateFailed')} ${result.error}`, true);
      else if (result.status === 'idle') notify(t('updateLatest'));
    } catch (error) {
      notify(`${t('updateFailed')} ${String(error)}`, true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={inline ? 'settings-update-action' : 'sidebar-update'}>
      <Button
        className={inline ? 'settings-update-button' : 'update-button button-borderless'}
        aria-label={label}
        title={`${detail} · v${update.currentVersion}`}
        aria-busy={busy}
        disabled={busy || blocked || update.mode === 'disabled'}
        onClick={() => void activate()}
      >
        <Icon size={18} className={busy ? 'spinner' : undefined} aria-hidden="true" />
        {inline && <span>{actionLabel}</span>}
        {!inline && available && <span className="update-dot" aria-hidden="true" />}
        {!inline && update.status === 'downloading' && (
          <span className="update-percent" aria-hidden="true">
            {update.downloadPercent ?? 0}%
          </span>
        )}
      </Button>
      {!inline && (
        <span className="sr-only" role="status">
          {t('update.' + update.status, {
            version: update.availableVersion || '',
            percent: update.downloadPercent ?? 0,
          })}
        </span>
      )}
    </div>
  );
}
