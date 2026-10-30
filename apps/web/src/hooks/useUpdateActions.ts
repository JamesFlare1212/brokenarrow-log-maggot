import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Bridge, Locale, UpdateState } from '@ba/contracts';
import { errorMessage } from '@ba/shared';
import { translate } from './useI18n';

export type UpdateAction = 'check' | 'download' | 'install' | 'open';

export function useUpdateActions(api: Bridge, update: UpdateState | undefined, locale: Locale) {
  const [action, setAction] = useState<UpdateAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notificationId = useId();
  const current = useRef(update);
  current.current = update;
  const language = useRef(locale);
  language.current = locale;
  const busy = useRef(false);
  const owner = useRef<{
    action: UpdateAction;
    watching: boolean;
    start: UpdateState | undefined;
  } | null>(null);
  const publish = useCallback(
    (value: UpdateState) => {
      const t = (key: string) =>
        translate(language.current, key, {
          version: value.availableVersion ?? '',
          percent: value.downloadPercent ?? 0,
        });
      if (value.error) toast.error(`${t('updateFailed')} ${value.error}`, { id: notificationId });
      else if (value.installBlocked)
        toast.warning(t('updateInstallBlocked'), { id: notificationId });
      else if (['checking', 'downloading', 'installing'].includes(value.status)) {
        toast.loading(t('update.' + value.status), { id: notificationId });
        return;
      } else if (value.status === 'downloaded')
        toast.success(t('updateDownloaded'), { id: notificationId });
      else if (value.status === 'available')
        toast.success(t('update.available'), { id: notificationId });
      else if (value.status === 'idle') toast.success(t('updateLatest'), { id: notificationId });
      else toast.dismiss(notificationId);
      if (owner.current) owner.current.watching = false;
    },
    [notificationId],
  );
  useEffect(() => {
    if (
      !update ||
      !owner.current?.watching ||
      owner.current.action === 'open' ||
      update === owner.current.start
    )
      return;
    setError(null);
    publish(update);
  }, [update, locale, publish]);
  useEffect(
    () => () => {
      toast.dismiss(notificationId);
    },
    [notificationId],
  );
  const run = useCallback(
    async (kind: UpdateAction) => {
      if (busy.current) return;
      busy.current = true;
      owner.current = { action: kind, watching: true, start: current.current };
      const attempt = owner.current;
      setAction(kind);
      setError(null);
      const t = (key: string) => translate(language.current, key);
      toast.loading(
        t(
          kind === 'open'
            ? 'updateOpeningDownloads'
            : kind === 'install'
              ? 'update.installing'
              : kind === 'download'
                ? 'update.downloading'
                : 'update.checking',
        ),
        { id: notificationId },
      );
      try {
        if (kind === 'open') {
          await api.invoke('updates.openDownload', null);
          toast.success(t('updateDownloadsOpened'), { id: notificationId });
          attempt.watching = false;
        } else {
          const value = await api.invoke(
            kind === 'install'
              ? 'updates.install'
              : kind === 'download'
                ? 'updates.download'
                : 'updates.check',
            null,
          );
          publish(current.current && current.current !== attempt.start ? current.current : value);
        }
      } catch (value) {
        const latest = current.current;
        if (
          kind !== 'open' &&
          latest &&
          latest !== attempt.start &&
          (latest.error ||
            latest.installBlocked ||
            latest.status === 'downloaded' ||
            (kind === 'check' && ['idle', 'available'].includes(latest.status)))
        ) {
          publish(latest);
        } else {
          const message = errorMessage(value);
          setError(message);
          toast.error(`${t('updateFailed')} ${message}`, { id: notificationId });
          attempt.watching = true;
        }
      } finally {
        busy.current = false;
        setAction(null);
      }
    },
    [api, notificationId, publish],
  );
  return { action, pending: action !== null, error, run };
}
