import { useEffect, useRef, useState } from 'react';
import type { RpcOutputs } from '@ba/contracts';
import { formatTime } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { Button, Dialog, Empty, Loading, Notice } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { historyError } from './useHistoryDeletion';

export function HistoryRecoveryDialog() {
  const { api, closeModal, notify } = useApp(),
    { t, locale } = useI18n(),
    confirm = useConfirmation();
  const request = useRequest<RpcOutputs['history.backups']>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [restored, setRestored] = useState<string | null>(null);
  const pending = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!busy && (error || restored)) feedback.current?.focus();
  }, [busy, error, restored]);
  const refresh = () => request.load(() => api.invoke('history.backups', null), true);
  useEffect(() => {
    void refresh();
  }, [api]);
  return (
    <Dialog open onClose={closeModal} dismissible={!busy} title={t('historyRecovery')}>
      <p>{t('historyRecoveryHint')}</p>
      {request.data && <p className="wrap-anywhere">{request.data.directory}</p>}
      <div className="actions">
        <Button disabled={busy || request.pending} onClick={() => void refresh()}>
          {t('refresh')}
        </Button>
        <Button
          disabled={busy || !request.data?.backups.length}
          onClick={() =>
            void api
              .invoke('history.open', null)
              .catch((error) => notify(historyError(error, locale), true))
          }
        >
          {t('folder')}
        </Button>
      </div>
      {request.pending && !request.data && <Loading />}
      {request.error && (
        <Notice error>
          {request.error}
          <Button onClick={() => void refresh()}>{t('retry')}</Button>
        </Notice>
      )}
      {(error || restored) && (
        <div ref={feedback} tabIndex={-1} data-dialog-feedback>
          <Notice error={!!error}>{error || restored}</Notice>
        </div>
      )}
      {request.data?.backups.length ? (
        <ul className="flex min-w-0 flex-col gap-3">
          {request.data.backups.map((backup) => (
            <li
              key={backup.name}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0 flex-1 wrap-anywhere">
                <strong>
                  {backup.target.name || '—'} · #{backup.target.id}
                </strong>
                <p>
                  {formatTime(backup.createdAt, locale)} ·{' '}
                  {t(backup.kind === 'account' ? 'accounts' : 'matchDetail')} ·{' '}
                  {t('accountMatches', { count: backup.matchCount })}
                </p>
                <small>{backup.name}</small>
              </div>
              <Button
                disabled={busy || backup.restoredAt !== null}
                onClick={async () => {
                  if (pending.current) return;
                  pending.current = true;
                  setBusy(true);
                  setError(null);
                  setRestored(null);
                  try {
                    if (
                      !(await confirm({
                        title: t('historyRestoreTitle'),
                        description: t('historyRestoreHint'),
                        detail: `${backup.target.name} · #${backup.target.id}\n${backup.name}`,
                        confirmLabel: t('historyRestoreAction'),
                        variant: 'primary',
                      }))
                    )
                      return;
                    const result = await api.invoke('history.restore', {
                      name: backup.name,
                      version: backup.version,
                    });
                    setRestored(
                      t('historyRestoreResult', {
                        matches: result.restoredMatches,
                        accounts: result.restoredAccounts,
                      }),
                    );
                    await refresh();
                  } catch (error) {
                    setError(historyError(error, locale));
                  } finally {
                    pending.current = false;
                    setBusy(false);
                  }
                }}
              >
                {t(backup.restoredAt !== null ? 'historyAlreadyRestored' : 'historyRestoreAction')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        !request.pending && !request.error && <Empty>{t('empty')}</Empty>
      )}
    </Dialog>
  );
}
