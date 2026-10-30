import { Input } from '@/components/ui/input';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Layers as faLayerGroup,
  FileText as faFileLines,
  FolderOpen as faFolderOpen,
  RefreshCw as faArrowsRotate,
  Info,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import type {
  DeckList,
  DeckFile,
  DeckOperationResult,
  DeckRestoreResult,
  DeckSwitchAlert,
} from '@ba/contracts';
import { errorMessage, filename, formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Dialog, Notice, Empty } from '../../components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { Button as FileNameButton } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  FieldSet,
  FieldLegend,
  FieldGroup,
  Field as PrimitiveField,
  FieldLabel,
  FieldError,
} from '@/components/ui/field';
function DeckFiles({
  id,
  title,
  files,
  selected,
  onChange,
  placeholder,
  disabled = false,
}: {
  id: string;
  title: string;
  files: DeckFile[];
  selected: string[];
  onChange: (names: string[]) => void;
  placeholder?: 'loading' | 'unavailable';
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const selectedCount = files.filter((file) => selected.includes(file.name)).length;
  const allSelected = files.length > 0 && selectedCount === files.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FieldSet className="field deck-fieldset">
          <FieldLegend className="sr-only">{title}</FieldLegend>
          <div
            id={id}
            className="deck-file-list"
            tabIndex={0}
            onKeyDown={(e) => {
              if (!disabled && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                onChange(files.map((f) => f.name));
              }
            }}
          >
            {placeholder ? (
              <div className="flex flex-col gap-3" role="status">
                <span>{t(placeholder === 'loading' ? 'loading' : 'deckListUnavailable')}</span>
                {placeholder === 'loading' &&
                  Array.from({ length: 3 }, (_, index) => (
                    <Skeleton key={index} className="h-6 w-full" aria-hidden="true" />
                  ))}
              </div>
            ) : files.length ? (
              <FieldGroup>
                {files.map((f, index) => (
                  <PrimitiveField orientation="horizontal" key={f.name}>
                    <Checkbox
                      id={`${id}-${index}`}
                      checked={selected.includes(f.name)}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        onChange(
                          checked === true
                            ? [...selected, f.name]
                            : selected.filter((name) => name !== f.name),
                        )
                      }
                    />
                    <FieldLabel
                      htmlFor={`${id}-${index}`}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <Icon icon={faFileLines} aria-hidden="true" />
                      <span className="truncate">{f.name}</span>
                    </FieldLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FileNameButton
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t('viewFileName', { name: f.name })}
                        >
                          <Info aria-hidden="true" />
                        </FileNameButton>
                      </PopoverTrigger>
                      <PopoverContent
                        aria-label={t('viewFileName', { name: f.name })}
                        className="max-w-[calc(100vw-2rem)] max-h-[70svh] overflow-y-auto"
                      >
                        <p
                          tabIndex={0}
                          className="rounded-sm wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {f.name}
                        </p>
                      </PopoverContent>
                    </Popover>
                    <small className="shrink-0 text-muted-foreground">{formatSize(f.size)}</small>
                  </PrimitiveField>
                ))}
              </FieldGroup>
            ) : (
              <Empty>{t('empty')}</Empty>
            )}
          </div>
          <PrimitiveField orientation="horizontal" className="deck-selection">
            <Checkbox
              id={`${id}-all`}
              checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
              onCheckedChange={(checked) =>
                onChange(checked === true ? files.map((file) => file.name) : [])
              }
              disabled={disabled || !!placeholder || !files.length}
            />
            <FieldLabel htmlFor={`${id}-all`}>{t('selectAll')}</FieldLabel>
            <small className="muted">
              {placeholder ? '— / —' : `${selectedCount} / ${files.length}`}
            </small>
          </PrimitiveField>
        </FieldSet>
      </CardContent>
    </Card>
  );
}
export function DecksPanel() {
  const confirm = useConfirmation();
  const { api, state, notify, openSettings } = useApp(),
    { t } = useI18n(),
    request = useRequest<DeckList>(),
    [front, setFront] = useState<string[]>([]),
    [back, setBack] = useState<string[]>([]),
    [packageName, setPackageName] = useState(''),
    [backupNames, setBackupNames] = useState<string[] | null>(null),
    [backupDirectory, setBackupDirectory] = useState(''),
    [backupMode, setBackupMode] = useState<'selected' | 'all'>('selected'),
    [backupError, setBackupError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [outcome, setOutcome] = useState<
      (DeckOperationResult & { recoveryBackup?: string | null }) | null
    >(null),
    [operationError, setOperationError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const refreshFocus = useRef<HTMLButtonElement | null>(null);
  const configuredDirectory = useRef(state.config.decksDir);
  const list = request.data;
  useLayoutEffect(() => {
    const source = refreshFocus.current;
    if (!source) return;
    if (source.isConnected) {
      if (document.activeElement === source)
        source.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      return;
    }
    refreshFocus.current = null;
    if (document.activeElement !== document.body || root.current?.closest('[hidden],[inert]'))
      return;
    const target = root.current?.querySelector<HTMLButtonElement>('[data-deck-refresh]');
    target?.focus();
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [list, request.pending, request.error]);
  const feedback = (error: unknown) => {
    const message = errorMessage(error);
    for (const key of [
      'DECK_DIRECTORY_CHANGED',
      'DECK_RESTORE_CHANGED',
      'DECK_RESTORE_EXPIRED',
      'DECK_UNSAFE_TARGET',
    ])
      if (message.includes(key)) return t(key);
    return message;
  };
  const refresh = () => request.load(() => api.invoke('decks.list', null), true);
  useEffect(() => {
    const changed = configuredDirectory.current !== state.config.decksDir;
    configuredDirectory.current = state.config.decksDir;
    if (changed) {
      setFront([]);
      setBack([]);
      request.invalidate();
      if (!busyRef.current) setBackupNames(null);
    }
    void refresh();
  }, [api, state.decksRevision, state.config.decksDir]);
  useEffect(() => {
    if (!list) return;
    setFront((names) => names.filter((name) => list.decks.some((file) => file.name === name)));
    setBack((names) => names.filter((name) => list.backups.some((file) => file.name === name)));
  }, [list]);
  const operate = async (
    run: () => Promise<DeckOperationResult | { name: string } | null | void | false>,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setOperationError(null);
    setOutcome(null);
    try {
      const result = await run();
      if (result && 'completed' in result) {
        setOutcome(result);
        notify(
          t(result.failed.length ? 'deckOperationPartial' : 'success'),
          !!result.failed.length,
        );
      } else if (result !== false) notify(t('success'));
    } catch (e) {
      const message = feedback(e);
      setOperationError(message);
      notify(message, true);
    } finally {
      await refresh();
      busyRef.current = false;
      setBusy(false);
    }
  };
  const restore = (name: string, directory: string, alert?: DeckSwitchAlert) =>
    void operate(async () => {
      const plan = await api.invoke('decks.planRestore', {
        name,
        directory,
        ...(alert ? { version: alert.version } : {}),
      });
      const detail = [
        t('deckRestoreSource', { name: plan.name }),
        t('deckRestoreDirectory', { directory: plan.directory }),
        t('deckRestoreFiles'),
        ...plan.files,
        t('deckRestoreReplacements'),
        ...(plan.replacements.length ? plan.replacements : [t('deckRestoreNoReplacements')]),
        ...(plan.replacements.length ? [t('deckRestoreRecoveryHint')] : []),
      ].join('\n');
      if (
        !(await confirm({
          title: t('deploy'),
          description: t('confirmation.deployHint'),
          detail,
          confirmLabel: t('deploy'),
          variant: 'primary',
        }))
      )
        return false;
      const result: DeckRestoreResult | null = alert
        ? await api.invoke('decks.switch', { action: 'restore', token: plan.token })
        : await api.invoke('decks.deploy', { token: plan.token });
      return result;
    });
  const startBackup = (names: string[], mode: 'selected' | 'all') => {
    const base = 'decks-' + new Date().toISOString().slice(0, 10);
    const existing = new Set(list?.backups.map((file) => file.name.toLowerCase()));
    let name = base;
    for (let suffix = 2; existing.has(name.toLowerCase() + '.zip'); suffix++)
      name = `${base}-${suffix}`;
    setPackageName(name);
    setBackupMode(mode);
    setBackupError(null);
    setBackupDirectory(list?.decksDir ?? '');
    setBackupNames([...names]);
  };
  let nameInvalid = false;
  try {
    if (!packageName.trim()) throw new Error('Empty backup name');
    filename(packageName.toLowerCase().endsWith('.zip') ? packageName : packageName + '.zip');
  } catch {
    nameInvalid = true;
  }
  const nameError = nameInvalid ? t('backupNameInvalid') : backupError;
  const refreshButton = (
    <Button
      data-deck-refresh=""
      className="scroll-m-2"
      aria-disabled={request.pending || busy}
      aria-busy={request.pending}
      onBlur={() => {
        refreshFocus.current = null;
      }}
      onClick={(event) => {
        if (request.pending || busyRef.current) return;
        refreshFocus.current = event.currentTarget;
        void refresh();
      }}
    >
      <Icon icon={faArrowsRotate} size={15} spin={request.pending} aria-hidden="true" />
      {t('refresh')}
    </Button>
  );
  return (
    <div ref={root} className="decks-panel">
      <div className="deck-toolbar">{refreshButton}</div>
      {!list && (
        <div className="deck-columns" aria-busy={request.pending}>
          <DeckFiles
            id="front-decks"
            title={t('frontDecks')}
            files={[]}
            selected={[]}
            onChange={setFront}
            disabled
            placeholder={request.pending ? 'loading' : 'unavailable'}
          />
          <DeckFiles
            id="back-decks"
            title={t('backups')}
            files={[]}
            selected={[]}
            onChange={setBack}
            disabled
            placeholder={request.pending ? 'loading' : 'unavailable'}
          />
        </div>
      )}
      {list && !list.found ? (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('decks')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Empty
              icon={<Icon icon={faLayerGroup} />}
              description={t('decksDescription')}
              action={<Button onClick={() => openSettings('connection')}>{t('settings')}</Button>}
            >
              {t('deckMissing')}
            </Empty>
          </CardContent>
        </Card>
      ) : (
        list && (
          <div className="deck-columns">
            <section>
              <DeckFiles
                id="front-decks"
                title={t('frontDecks')}
                files={list.decks}
                selected={front}
                onChange={setFront}
                disabled={busy || request.pending}
              />
              <small className="path">{list.decksDir}</small>
              <div className="actions">
                <Button
                  disabled={busy || !front.length}
                  onClick={() => startBackup(front, 'selected')}
                >
                  <Icon icon={faLayerGroup} size={16} aria-hidden="true" />
                  {t('backupSelected')}
                </Button>
                <Button
                  disabled={busy || !list.decks.length}
                  onClick={() =>
                    startBackup(
                      list.decks.map((d) => d.name),
                      'all',
                    )
                  }
                >
                  {t('backupAll')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void operate(() => api.invoke('decks.open', { kind: 'decks' }))}
                >
                  <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                  {t('folder')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || !front.length}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t('confirmation.deleteDecks'),
                        description: t('confirmation.deleteHint'),
                        detail: [list.decksDir, ...front].join('\n'),
                        confirmLabel: t('delete'),
                      })
                    )
                      void operate(() =>
                        api.invoke('decks.delete', {
                          kind: 'decks',
                          names: front,
                          directory: list.decksDir,
                        }),
                      );
                  }}
                >
                  {t('delete')}
                </Button>
              </div>
            </section>
            <section>
              <DeckFiles
                id="back-decks"
                title={t('backups')}
                files={list.backups}
                selected={back}
                onChange={setBack}
                disabled={busy || request.pending}
              />
              <small className="path">{list.backupsDir}</small>
              <div className="actions">
                <Button
                  disabled={busy || back.length !== 1}
                  variant="default"
                  onClick={() => restore(back[0] || '', list.decksDir)}
                >
                  {t('deploy')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void operate(() => api.invoke('decks.open', { kind: 'backups' }))}
                >
                  {t('folder')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || !back.length}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t('confirmation.deleteBackups'),
                        description: t('confirmation.deleteHint'),
                        detail: [list.decksDir, ...back].join('\n'),
                        confirmLabel: t('delete'),
                      })
                    )
                      void operate(() =>
                        api.invoke('decks.delete', {
                          kind: 'backups',
                          names: back,
                          directory: list.decksDir,
                        }),
                      );
                  }}
                >
                  {t('delete')}
                </Button>
              </div>
            </section>
          </div>
        )
      )}
      {state.deckAlert && (
        <Notice>
          <span>{t('deckSwitch', { name: state.deckAlert.from })}</span>
          <div className="actions">
            {(['restore', 'ignore', 'dismiss'] as const).map((action) => (
              <Button
                key={action}
                disabled={busy}
                onClick={() =>
                  action === 'restore'
                    ? restore('上一局卡组包.zip', state.deckAlert!.directory, state.deckAlert!)
                    : void operate(() => api.invoke('decks.switch', { action }))
                }
              >
                {t(action === 'dismiss' ? 'close' : action)}
              </Button>
            ))}
          </div>
        </Notice>
      )}
      {request.error && <Notice error>{request.error}</Notice>}
      {operationError && (
        <Notice error>
          <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{operationError}</span>
        </Notice>
      )}
      {outcome && (
        <Notice error={outcome.failed.length > 0}>
          <div className="flex min-w-0 flex-1 flex-col gap-2 wrap-anywhere">
            <p>
              {t('deckOperationSummary', {
                completed: outcome.completed.length,
                failed: outcome.failed.length,
                skipped: outcome.skipped.length,
              })}
            </p>
            {outcome.completed.length > 0 && (
              <p>
                {t('deckCompletedFiles')} {outcome.completed.join(', ')}
              </p>
            )}
            {outcome.failed.length > 0 && (
              <ul>
                {outcome.failed.map((failure) => (
                  <li key={failure.name}>
                    {failure.name}: {feedback(failure.message)}
                  </li>
                ))}
              </ul>
            )}
            {outcome.skipped.length > 0 && (
              <p>
                {t('deckSkippedFiles')} {outcome.skipped.join(', ')}
              </p>
            )}
            {outcome.recoveryBackup && (
              <p>{t('deckRecoverySaved', { name: outcome.recoveryBackup })}</p>
            )}
          </div>
        </Notice>
      )}
      <Dialog
        open={backupNames !== null}
        onClose={() => setBackupNames(null)}
        title={t(backupMode === 'all' ? 'backupAll' : 'backupSelected')}
        dismissible={!busy}
      >
        <FieldGroup>
          <PrimitiveField data-invalid={!!nameError} data-disabled={busy}>
            <FieldLabel htmlFor="backup-name">{t('packageName')}</FieldLabel>
            <Input
              id="backup-name"
              value={packageName}
              onChange={(e) => {
                setPackageName(e.target.value);
                setBackupError(null);
              }}
              disabled={busy}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'backup-name-error' : undefined}
              maxLength={200}
            />
            {nameError && <FieldError id="backup-name-error">{nameError}</FieldError>}
          </PrimitiveField>
        </FieldGroup>
        <div className="flex min-w-0 flex-col gap-2">
          <p>{t('backupContents')}</p>
          <ul
            tabIndex={0}
            aria-label={t('backupContents')}
            className="max-h-40 overflow-y-auto whitespace-pre-wrap wrap-anywhere"
          >
            {backupNames?.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
        {busy && <p role="status">{t('backupSaving')}</p>}
        <div className="actions">
          <Button
            disabled={busy || nameInvalid}
            aria-busy={busy}
            variant="default"
            onClick={() =>
              void operate(async () => {
                setBackupError(null);
                try {
                  await api.invoke('decks.backup', {
                    names: backupNames || [],
                    packageName,
                    directory: backupDirectory,
                  });
                } catch (error) {
                  const message = errorMessage(error);
                  const feedback = message.includes('DECK_BACKUP_EXISTS')
                    ? t('backupNameExists')
                    : message;
                  setBackupError(feedback);
                  throw new Error(feedback);
                }
                setBackupNames(null);
              })
            }
          >
            {busy && <Spinner aria-hidden="true" data-icon="inline-start" />}
            {t('save')}
          </Button>
          <Button disabled={busy} onClick={() => setBackupNames(null)}>
            {t('cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
