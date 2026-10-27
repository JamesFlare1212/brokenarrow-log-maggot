import { useState } from 'react';
import { Download, RefreshCw, RotateCw } from 'lucide-react';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button } from '../../components/ui';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

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
          ? `${t('update.available', { version: update.availableVersion || '' })}. ${t(update.mode === 'portable' ? 'updatePortable' : 'updateManualInstall')}`
          : update.error || label;
  const UpdateIcon =
    available || update.status === 'downloading' ? Download : ready ? RotateCw : RefreshCw;
  async function activate() {
    if (busy || blocked || update.mode === 'disabled') return;
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
  const icon =
    busy && update.status !== 'downloading' ? (
      <Spinner data-icon="inline-start" />
    ) : (
      <UpdateIcon data-icon="inline-start" />
    );
  if (inline)
    return (
      <Button
        tooltip={`${detail} · v${update.currentVersion}`}
        aria-label={label}
        aria-busy={busy}
        disabled={busy || blocked || update.mode === 'disabled'}
        onClick={() => void activate()}
      >
        {icon}
        {actionLabel}
      </Button>
    );
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="workspace"
        tooltip={`${detail} · v${update.currentVersion}`}
        aria-label={label}
        aria-busy={busy}
        disabled={busy || blocked || update.mode === 'disabled'}
        onClick={() => void activate()}
      >
        {icon}
        <span>{label}</span>
      </SidebarMenuButton>
      {update.status === 'downloading' && (
        <Progress
          className="mt-2 group-data-[collapsible=icon]:hidden"
          value={update.downloadPercent}
          aria-label={t('updateProgress')}
        />
      )}
      <span className="sr-only" role="status">
        {t('update.' + update.status, {
          version: update.availableVersion || '',
          percent: update.downloadPercent ?? 0,
        })}
      </span>
    </SidebarMenuItem>
  );
}
