import { useId, useRef, type ComponentProps } from 'react';
import { Download, RefreshCw, RotateCw } from 'lucide-react';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button } from '../../components/ui';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import type { UpdateAction } from '../../hooks/useUpdateActions';
import { updateActivityBlocked, updateStatusText } from './update-status';

export function UpdateButton({
  inline = false,
  describedBy,
}: {
  inline?: boolean;
  describedBy?: string;
}) {
  const { state, updater } = useApp(),
    { t, locale } = useI18n();
  const feedbackId = useId();
  const press = useRef<{ action: UpdateAction; enabled: boolean } | null>(null);
  const update = state.updates;
  const active = ['checking', 'downloading', 'installing'].includes(update.status);
  const busy = updater.pending || active;
  const ready = update.status === 'downloaded';
  const available =
    update.status === 'available' ||
    (update.status === 'error' && update.errorContext === 'download');
  const blocked = updateActivityBlocked(update, state.session, state.recording);
  const unavailable = busy || blocked || update.mode === 'disabled';
  const action: UpdateAction =
    available && update.mode === 'portable'
      ? 'open'
      : ready
        ? 'install'
        : available
          ? 'download'
          : 'check';
  const actionLabel = t(
    ready || update.status === 'installing'
      ? update.installBlocked && ready
        ? 'updateRetryInstall'
        : 'updateInstall'
      : available || update.status === 'downloading'
        ? update.mode === 'portable'
          ? 'updateReleasePage'
          : update.errorContext === 'download'
            ? 'updateRetryDownload'
            : 'updateDownload'
        : 'updateCheck',
  );
  const label =
    active && !inline
      ? t('update.' + update.status, { percent: update.downloadPercent ?? 0 })
      : actionLabel;
  const error = updater.pending ? null : (updater.error ?? update.error);
  const status =
    update.mode === 'portable' && available && !error && !updater.pending
      ? t('updatePortable')
      : updateStatusText(update, locale, blocked, updater.action, error);
  const detail = [
    status,
    error,
    available && update.mode === 'installed' ? t('updateManualInstall') : null,
    `v${update.currentVersion}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const UpdateIcon =
    available || update.status === 'downloading' ? Download : ready ? RotateCw : RefreshCw;
  const activation: Pick<
    ComponentProps<typeof Button>,
    'onPointerDown' | 'onPointerCancel' | 'onKeyDown' | 'onBlur' | 'onClick'
  > = {
    onPointerDown: (event) => {
      if (event.button === 0) press.current = { action, enabled: !unavailable };
    },
    onPointerCancel: () => {
      if (press.current) press.current.enabled = false;
    },
    onBlur: () => {
      if (press.current) press.current.enabled = false;
    },
    onKeyDown: (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      if (event.repeat) {
        if (event.key === 'Enter') event.preventDefault();
        return;
      }
      press.current = { action, enabled: !unavailable };
    },
    onClick: () => {
      const intent = press.current;
      press.current = null;
      if (unavailable || (intent && (!intent.enabled || intent.action !== action))) return;
      void updater.run(action);
    },
  };
  const icon =
    busy && update.status !== 'downloading' ? (
      <Spinner data-icon="inline-start" />
    ) : (
      <UpdateIcon data-icon="inline-start" />
    );
  if (inline)
    return (
      <Button
        data-update-action={action}
        tooltip={detail}
        aria-label={label}
        aria-busy={busy}
        aria-disabled={unavailable}
        aria-describedby={describedBy}
        disabled={update.mode === 'disabled'}
        {...activation}
      >
        {icon}
        {actionLabel}
      </Button>
    );
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-update-action={action}
        className="aria-disabled:pointer-events-auto"
        size="workspace"
        tooltip={detail}
        aria-label={label}
        aria-busy={busy}
        aria-disabled={unavailable}
        aria-describedby={`${feedbackId}-status ${feedbackId}-detail`}
        disabled={update.mode === 'disabled'}
        {...activation}
      >
        {icon}
        <span>{label}</span>
      </SidebarMenuButton>
      <div className="mt-1 h-1 group-data-[collapsible=icon]:hidden">
        {update.status === 'downloading' && (
          <Progress
            className="h-1"
            value={update.downloadPercent}
            aria-label={t('updateProgress')}
          />
        )}
      </div>
      <div
        id={feedbackId}
        data-update-feedback=""
        role="region"
        tabIndex={0}
        aria-label={t('updateStatusLabel')}
        className="mt-1 h-14 overflow-y-auto px-3 text-xs leading-4 wrap-anywhere focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-ring group-data-[collapsible=icon]:hidden"
      >
        <p id={`${feedbackId}-status`} role="status">
          {status}
        </p>
        <div id={`${feedbackId}-detail`}>
          {error && <p>{error}</p>}
          {update.mode === 'portable' && available && update.availableVersion && (
            <p>{t('update.available', { version: update.availableVersion })}</p>
          )}
          <p>v{update.currentVersion}</p>
        </div>
      </div>
    </SidebarMenuItem>
  );
}
