import type { ReplayMoveResult } from '@ba/contracts';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Notice } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';

export function RecordingMigrationResult({
  result,
}: {
  result: ReplayMoveResult | null | undefined;
}) {
  const { t } = useI18n();
  if (!result) return null;
  const message = (value: string) => {
    for (const code of [
      'REPLAY_MIGRATION_COLLISION',
      'REPLAY_MIGRATION_COPY_MISMATCH',
      'REPLAY_MIGRATION_RECORDING_ACTIVE',
      'REPLAY_TARGET_CHANGED',
      'REPLAY_DIRECTORY_CHANGED',
    ])
      if (value.includes(code)) return t(code);
    return value;
  };
  const groups = [
    { id: 'copied', label: t('recordingMigrationCopied'), names: result.copied },
    { id: 'retained', label: t('recordingMigrationRetained'), names: result.retained },
    {
      id: 'destination',
      label: t('recordingMigrationDestinationCopies'),
      names: result.destinationCopies,
    },
  ].filter((group) => group.names.length);
  return (
    <Notice error={!result.committed || result.failed.length > 0}>
      <div className="min-w-0 flex-1 space-y-2 wrap-anywhere" data-recording-migration-result>
        <p>{t(result.committed ? 'recordingMigrationCommitted' : 'recordingMigrationUnchanged')}</p>
        <p>
          {t('recordingMigrationFrom')} {result.from}
        </p>
        <p>
          {t('recordingMigrationTo')} {result.to}
        </p>
        <p>
          {t('recordingMigrationLibrary')} {result.directory}
        </p>
        <p>{t('recordingMigrationPolicy')}</p>
        <Accordion type="multiple" className="min-w-0">
          {groups.map((group) => (
            <AccordionItem key={group.id} value={group.id}>
              <AccordionTrigger>
                {group.label} ({group.names.length})
              </AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-1">
                  {group.names.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
          {result.failed.length > 0 && (
            <AccordionItem value="errors">
              <AccordionTrigger>
                {t('recordingMigrationErrors')} ({result.failed.length})
              </AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-1">
                  {result.failed.map((failure, index) => (
                    <li key={index}>
                      {failure.name || t('recordingMigrationOperation')}: {message(failure.message)}
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </div>
    </Notice>
  );
}
