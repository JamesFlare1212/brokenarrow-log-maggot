import { useId, useRef, useState } from 'react';
import { Check, ChevronDown, TriangleAlert, X } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Field, FieldLabel } from '@/components/ui/field';
import { Button, Notice } from '../../components/ui';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import type { SettingsSaveStatus } from '../../hooks/useSettingsAutosave';

function statusMessage(status: SettingsSaveStatus) {
  return status === 'saved'
    ? 'settingsAutoSaved'
    : status === 'unconfirmed'
      ? 'settingsSaveUnconfirmed'
      : status === 'error'
        ? 'settingsSaveFailed'
        : 'settingsSaving';
}

export function SettingsSaveIndicator({
  compact = false,
  responsive = false,
}: {
  compact?: boolean;
  responsive?: boolean;
}) {
  const { settings, recordingSettings, recordingPreference, settingsStatus } = useApp(),
    { t } = useI18n(),
    [open, setOpen] = useState(false),
    [scope, setScope] = useState('application'),
    [operation, setOperation] = useState<string | null>(null);
  const titleId = useId(),
    scopeId = useId(),
    region = useRef<HTMLDivElement>(null),
    busy = useRef(false);
  const status = t(statusMessage(settingsStatus));
  const groups = [
    { id: 'application', title: t('settingsApplicationChanges'), ...settings },
    { id: 'recording', title: t('settingsRecordingChanges'), ...recordingSettings },
    {
      id: 'automatic',
      title: t('autoRecord'),
      status: recordingPreference.pending
        ? ('saving' as const)
        : recordingPreference.failure
          ? ('error' as const)
          : ('saved' as const),
      error: recordingPreference.failure?.message,
      flush: recordingPreference.flush,
      discard: recordingPreference.discard,
    },
  ];
  const group = groups.find((group) => group.id === scope)!;
  const act = async (id: string, action: () => unknown) => {
    if (busy.current) return;
    busy.current = true;
    setOperation(id);
    const opener = document.activeElement;
    try {
      await action();
    } finally {
      if (document.activeElement === opener) region.current?.focus({ preventScroll: true });
      busy.current = false;
      setOperation(null);
    }
  };
  return (
    <div
      className="settings-save-state"
      data-save-state={settingsStatus}
      role="status"
      aria-label={t('settingsSaveStatus')}
      aria-live="polite"
    >
      <Popover
        open={open}
        onOpenChange={(value) => {
          if (value)
            setScope(
              groups.find((group) => group.status === 'unconfirmed')?.id ??
                groups.find((group) => group.status === 'error')?.id ??
                groups.find((group) => group.status !== 'saved')?.id ??
                'application',
            );
          setOpen(value);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size={compact || responsive ? 'icon' : 'sm'}
            className={responsive ? 'sm:w-auto sm:gap-1.5 sm:px-2.5' : undefined}
            aria-label={t('settingsSaveReview', { status })}
            title={t('settingsSaveReview', { status })}
          >
            {settingsStatus === 'error' || settingsStatus === 'unconfirmed' ? (
              <TriangleAlert data-icon="inline-start" />
            ) : settingsStatus === 'saved' ? (
              <Check data-icon="inline-start" />
            ) : (
              <Spinner data-icon="inline-start" />
            )}
            <span className={compact ? 'sr-only' : responsive ? 'max-sm:sr-only' : undefined}>
              {status}
            </span>
            {!compact && (
              <ChevronDown
                data-icon="inline-end"
                className={responsive ? 'hidden sm:block' : undefined}
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={12}
          className="settings-save-popover"
          aria-labelledby={titleId}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            region.current?.focus();
          }}
        >
          <PopoverHeader>
            <div className="flex items-center justify-between gap-2">
              <PopoverTitle id={titleId}>{t('settingsSaveDetails')}</PopoverTitle>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('close')}
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>
          </PopoverHeader>
          <Field>
            <FieldLabel htmlFor={scopeId} className="sr-only">
              {t('settingsSaveScope')}
            </FieldLabel>
            <NativeSelect
              id={scopeId}
              className="w-full min-w-0 max-w-full"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              {groups.map((group) => (
                <NativeSelectOption key={group.id} value={group.id}>
                  {group.title} · {t(statusMessage(group.status))}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div
            ref={region}
            role="region"
            tabIndex={0}
            aria-label={t('settingsSaveDetails')}
            className="settings-save-details"
          >
            <section
              className="flex min-w-0 flex-col gap-2"
              aria-labelledby={`${titleId}-${group.id}`}
              data-save-scope={group.id}
            >
              <h3 id={`${titleId}-${group.id}`} className="font-medium">
                {group.title}
              </h3>
              <p>{t(statusMessage(group.status))}</p>
              {group.status === 'unconfirmed' && <p>{t('settingsSaveUnconfirmedHint')}</p>}
              <p>{t('settingsChangesRetained')}</p>
              {group.id === 'recording' && group.status !== 'saved' && (
                <p>
                  {t('saveDirectory')}: {recordingSettings.directory || t('defaultDirectory')}
                </p>
              )}
              {group.error && <Notice error>{group.error}</Notice>}
            </section>
          </div>
          <div className="settings-save-actions">
            {group.status !== 'saved' || operation === group.id ? (
              <>
                <Button
                  aria-disabled={operation !== null || group.status === 'saving'}
                  aria-busy={operation === group.id}
                  onClick={() => {
                    if (group.status !== 'saving') void act(group.id, group.flush);
                  }}
                >
                  {t('settingsRetry')}
                </Button>
                <Button
                  aria-disabled={operation !== null || group.status === 'saving'}
                  onClick={() => {
                    if (group.status !== 'saving') void act(group.id, group.discard);
                  }}
                >
                  {t('settingsDiscard')}
                </Button>
              </>
            ) : (
              <p>{t('settingsAutoSaved')}</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
