import type { HistoryDeleteResult } from '@ba/contracts';
import { useApp } from '../../app/state';
import { Button, Notice } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';

export function HistoryOperationResult({ result }: { result: HistoryDeleteResult | null }) {
  const { openModal } = useApp(),
    { t } = useI18n();
  if (!result) return null;
  return (
    <Notice>
      <div className="flex min-w-0 flex-1 flex-col gap-2 wrap-anywhere">
        <p>
          {t('historyDeleteResult', {
            removed: result.removedMatches,
            retained: result.retainedMatches,
          })}
        </p>
        <p>
          {t('historySavedBackup')} {result.backup.name}
        </p>
        <div>
          <Button onClick={() => openModal({ type: 'historyRecovery' })}>
            {t('historyRecovery')}
          </Button>
        </div>
      </div>
    </Notice>
  );
}
