import { useCallback, useRef, useState } from 'react';
import type { HistoryDeleteResult, HistoryDeletePlan } from '@ba/contracts';
import { errorMessage, formatTime } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { translate, useI18n } from '../../hooks/useI18n';

export function historyError(error: unknown, locale: 'zh' | 'en'): string {
  const message = errorMessage(error);
  for (const code of [
    'HISTORY_TARGET_CHANGED',
    'HISTORY_PLAN_EXPIRED',
    'HISTORY_RESTORE_CONFLICT',
    'HISTORY_BACKUP_CHANGED',
  ])
    if (message.includes(code)) return translate(locale, code);
  return message;
}
export function historyPlanDetails(plan: HistoryDeletePlan, locale: 'zh' | 'en'): string {
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const identity = (match: HistoryDeletePlan['removed'][number]) =>
    `${match.map || '—'} · #${match.fid || match.id} · ${formatTime(match.at, locale)} · ${match.accounts.map((account) => `${account.name} #${account.id}`).join(', ') || t('historyUnassigned')}`;
  return [
    `${plan.target.name || '—'} · #${plan.target.id}`,
    t('historyAffectedAccounts') +
      ' ' +
      (plan.affectedAccounts.map((account) => `${account.name} #${account.id}`).join(', ') ||
        t('historyUnassigned')),
    t('historyRemovedMatches', { count: plan.removed.length }),
    ...plan.removed.map(identity),
    t('historyRetainedMatches', { count: plan.retained.length }),
    ...plan.retained.map(identity),
    t('historyBackupBeforeDelete'),
    plan.backupDirectory + '/' + plan.backupName,
  ].join('\n');
}
export function useHistoryDeletion() {
  const { api, notify } = useApp(),
    { locale } = useI18n(),
    confirm = useConfirmation();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [result, setResult] = useState<HistoryDeleteResult | null>(null);
  const run = useCallback(
    async (kind: 'account' | 'match', id: string) => {
      if (pending.current) return undefined;
      pending.current = true;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const menuTrigger = active?.closest('[role="menu"]')?.getAttribute('aria-labelledby');
      const returnFocus = (menuTrigger ? document.getElementById(menuTrigger) : null) ?? active;
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const plan =
          kind === 'account'
            ? await api.invoke('accounts.planDelete', { id })
            : await api.invoke('matches.planDelete', { id });
        if (
          !(await confirm({
            title: translate(
              locale,
              kind === 'account' ? 'confirmation.deleteAccount' : 'confirmation.deleteMatch',
            ),
            description: translate(locale, 'historyDeleteHint'),
            detail: historyPlanDetails(plan, locale),
            confirmLabel: translate(locale, 'delete'),
            returnFocus,
          }))
        )
          return undefined;
        const outcome =
          kind === 'account'
            ? await api.invoke('accounts.delete', { token: plan.token })
            : await api.invoke('matches.delete', { token: plan.token });
        setResult(outcome);
        notify(translate(locale, 'success'));
        return outcome;
      } catch (error) {
        const message = historyError(error, locale);
        setError(message);
        notify(message, true);
        return null;
      } finally {
        pending.current = false;
        setBusy(false);
        requestAnimationFrame(() => {
          if (
            document.activeElement === document.body &&
            returnFocus?.isConnected &&
            !document.querySelector('[role="dialog"], [role="alertdialog"]')
          )
            returnFocus.focus({ preventScroll: true });
        });
      }
    },
    [api, confirm, locale, notify],
  );
  return { run, busy, error, result };
}
