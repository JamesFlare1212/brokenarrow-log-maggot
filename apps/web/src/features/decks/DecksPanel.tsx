import { Input } from '@/components/ui/input';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Layers as faLayerGroup,
  FileText as faFileLines,
  FolderOpen as faFolderOpen,
  RefreshCw as faArrowsRotate,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import { Tooltip } from '../../components/Tooltip';
import type { DeckList, DeckFile } from '@ba/contracts';
import { formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Dialog, Field, Notice, Empty } from '../../components/ui';
import { LoadingStatus } from '../../components/LoadingState';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import {
  FieldSet,
  FieldLegend,
  FieldGroup,
  Field as PrimitiveField,
  FieldLabel,
} from '@/components/ui/field';
function DeckFiles({
  id,
  title,
  files,
  selected,
  onChange,
  actions,
  directory,
  emptyLabel,
  onOpenDirectory,
  children,
  pending = false,
}: {
  id: string;
  title: string;
  files: DeckFile[];
  selected: string[];
  onChange: (names: string[]) => void;
  actions: ReactNode;
  directory: string;
  emptyLabel: string;
  onOpenDirectory: () => void;
  children: ReactNode;
  pending?: boolean;
}) {
  const { t } = useI18n();
  const { access } = useApp();
  const selectedCount = files.filter((file) => selected.includes(file.name)).length;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const rows = pending ? Array.from({ length: 4 }, () => null) : files;
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        <CardDescription className="min-w-0">
          {pending ? (
            <Skeleton className="h-4 w-44 max-w-full" />
          ) : (
            <Tooltip content={<span className="wrap-anywhere">{directory}</span>}>
              <span className="block truncate text-xs" tabIndex={0}>
                {directory}
              </span>
            </Tooltip>
          )}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t('folder')}
            disabled={pending || !access.method('decks.open')}
            onClick={onOpenDirectory}
          >
            <Icon icon={faFolderOpen} aria-hidden="true" />
          </Button>
          {actions}
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldSet className="field deck-fieldset min-w-0 gap-1">
          <FieldLegend className="sr-only">{title}</FieldLegend>
          {rows.length > 0 && (
            <PrimitiveField orientation="horizontal" className="deck-selection border-b pb-2">
              <Checkbox
                id={`${id}-all`}
                checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
                onCheckedChange={(checked) =>
                  onChange(checked === true ? files.map((file) => file.name) : [])
                }
                disabled={pending || !files.length}
              />
              <FieldLabel htmlFor={`${id}-all`}>{t('selectAll')}</FieldLabel>
              <small className="muted text-muted-foreground">
                {pending ? (
                  <Skeleton className="h-4 w-12" aria-hidden="true" />
                ) : (
                  <>
                    {selectedCount} / {files.length}
                  </>
                )}
              </small>
            </PrimitiveField>
          )}
          <div
            id={id}
            className="deck-file-list min-w-0 max-h-104 overflow-auto [&_[data-slot='field-group']]:gap-0 [&_[data-slot='field']]:py-2.5 [&:focus-visible]:outline-2 [&:focus-visible]:outline-solid [&:focus-visible]:outline-ring [&:focus-visible]:outline-offset-[2px]"
            aria-busy={pending}
            tabIndex={files.length ? 0 : undefined}
            onKeyDown={(e) => {
              if (pending) return;
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                onChange(files.map((f) => f.name));
              }
            }}
          >
            {rows.length ? (
              <FieldGroup>
                {rows.map((f, index) => (
                  <PrimitiveField
                    orientation="horizontal"
                    key={f?.name ?? index}
                    aria-hidden={!f || undefined}
                  >
                    {f ? (
                      <Checkbox
                        id={`${id}-${index}`}
                        checked={selected.includes(f.name)}
                        onCheckedChange={(checked) =>
                          onChange(
                            checked === true
                              ? [...selected, f.name]
                              : selected.filter((name) => name !== f.name),
                          )
                        }
                      />
                    ) : (
                      <Skeleton className="size-4" />
                    )}
                    <FieldLabel
                      htmlFor={`${id}-${index}`}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <Icon icon={faFileLines} aria-hidden="true" />
                      {f ? (
                        <span className="truncate">{f.name}</span>
                      ) : (
                        <Skeleton className="h-5 w-40 max-w-full" />
                      )}
                    </FieldLabel>
                    <small className="shrink-0 text-muted-foreground">
                      {f ? formatSize(f.size) : <Skeleton className="h-4 w-12" />}
                    </small>
                  </PrimitiveField>
                ))}
              </FieldGroup>
            ) : (
              <Empty>{emptyLabel}</Empty>
            )}
          </div>
        </FieldSet>
      </CardContent>
      {rows.length > 0 && <CardFooter className="flex-wrap gap-2">{children}</CardFooter>}
    </Card>
  );
}
export function DecksPanel() {
  const confirm = useConfirmation();
  const { api, access, state, notify, openSettings } = useApp(),
    { t } = useI18n(),
    request = useRequest<DeckList>(),
    [front, setFront] = useState<string[]>([]),
    [back, setBack] = useState<string[]>([]),
    [packageName, setPackageName] = useState(''),
    [backupNames, setBackupNames] = useState<string[] | null>(null),
    [busy, setBusy] = useState(false);
  const refresh = () => void request.load(() => api.invoke('decks.list', null), true);
  useEffect(() => {
    refresh();
  }, [api, state.decksRevision, state.config.decksDir]);
  const operate = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await run();
      notify(t('success'));
      refresh();
      setFront([]);
      setBack([]);
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  };
  const list = request.data;
  const loading = !list && (request.pending || !request.error);
  const content = list ?? { found: true, decks: [], backups: [], decksDir: '', backupsDir: '' };
  const refreshButton = (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={t('refresh')}
      disabled={request.pending || busy}
      aria-busy={request.pending}
      onClick={refresh}
    >
      <Icon icon={faArrowsRotate} size={15} spin={request.pending} aria-hidden="true" />
    </Button>
  );
  return (
    <div className="decks-panel flex min-w-0 flex-col gap-(--content-gap)">
      {!loading && !list?.found && <div className="deck-toolbar">{refreshButton}</div>}
      {state.deckAlert && (
        <Notice>
          <span>{t('deckSwitch', { name: state.deckAlert.from })}</span>
          <div className="actions flex items-center gap-2 flex-wrap [.add-match-form_&]:justify-end [.dialog-body>&:last-child]:justify-end viewport-max-767:[.profile-toolbar>&]:gap-1.5">
            {(['restore', 'ignore', 'dismiss'] as const).map((action) => (
              <Button
                key={action}
                disabled={busy || !access.method('decks.switch')}
                onClick={() =>
                  void operate(() =>
                    api.invoke('decks.switch', {
                      action,
                      packageRevision: state.deckAlert?.packageRevision,
                    }),
                  )
                }
              >
                {t(action === 'dismiss' ? 'close' : action)}
              </Button>
            ))}
          </div>
        </Notice>
      )}
      {loading && <LoadingStatus />}
      {request.error && <Notice error>{request.error}</Notice>}
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
        (list?.found || loading) && (
          <div className="deck-columns grid grid-cols-2 items-start gap-(--content-gap) [&>section]:min-w-0 workspace-max-48:grid-cols-1 viewport-max-767:grid-cols-1">
            <section>
              <DeckFiles
                id="front-decks"
                title={t('frontDecks')}
                files={content.decks}
                pending={loading}
                selected={front}
                onChange={setFront}
                actions={refreshButton}
                directory={content.decksDir}
                emptyLabel={t('noCurrentDecks')}
                onOpenDirectory={() =>
                  void operate(() => api.invoke('decks.open', { kind: 'decks' }))
                }
              >
                <Button
                  size="lg"
                  disabled={loading || busy || !front.length || !access.method('decks.backup')}
                  onClick={() => {
                    setPackageName('decks-' + new Date().toISOString().slice(0, 10));
                    setBackupNames(front);
                  }}
                >
                  <Icon icon={faLayerGroup} size={16} aria-hidden="true" />
                  {t('backupSelected')}
                </Button>
                <Button
                  size="lg"
                  disabled={
                    loading || busy || !content.decks.length || !access.method('decks.backup')
                  }
                  onClick={() => {
                    setPackageName('decks-' + new Date().toISOString().slice(0, 10));
                    setBackupNames(content.decks.map((d) => d.name));
                  }}
                >
                  {t('backupAll')}
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={busy || !front.length || !access.method('decks.delete')}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t('confirmation.deleteDecks'),
                        description: t('confirmation.deleteHint'),
                        detail: front.join('\n'),
                        confirmLabel: t('delete'),
                      })
                    )
                      void operate(() =>
                        api.invoke('decks.delete', { kind: 'decks', names: front }),
                      );
                  }}
                >
                  {t('delete')}
                </Button>
              </DeckFiles>
            </section>
            <section>
              <DeckFiles
                id="back-decks"
                title={t('backups')}
                files={content.backups}
                pending={loading}
                selected={back}
                onChange={setBack}
                actions={refreshButton}
                directory={content.backupsDir}
                emptyLabel={t('noDeckBackups')}
                onOpenDirectory={() =>
                  void operate(() => api.invoke('decks.open', { kind: 'backups' }))
                }
              >
                <Button
                  size="lg"
                  disabled={loading || busy || back.length !== 1 || !access.method('decks.deploy')}
                  variant="default"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t('deploy'),
                        description: t('confirmation.deployHint'),
                        detail: back[0],
                        confirmLabel: t('deploy'),
                        variant: 'primary',
                      })
                    )
                      void operate(() => api.invoke('decks.deploy', { name: back[0] || '' }));
                  }}
                >
                  {t('deploy')}
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={busy || !back.length || !access.method('decks.delete')}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t('confirmation.deleteBackups'),
                        description: t('confirmation.deleteHint'),
                        detail: back.join('\n'),
                        confirmLabel: t('delete'),
                      })
                    )
                      void operate(() =>
                        api.invoke('decks.delete', { kind: 'backups', names: back }),
                      );
                  }}
                >
                  {t('delete')}
                </Button>
              </DeckFiles>
            </section>
          </div>
        )
      )}
      <Dialog
        open={backupNames !== null}
        onClose={() => setBackupNames(null)}
        title={t('backupSelected')}
      >
        <Field id="backup-name" label={t('packageName')}>
          <Input
            id="backup-name"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            maxLength={200}
          />
        </Field>
        <div className="actions flex items-center gap-2 flex-wrap [.add-match-form_&]:justify-end [.dialog-body>&:last-child]:justify-end viewport-max-767:[.profile-toolbar>&]:gap-1.5">
          <Button
            disabled={busy || !packageName.trim()}
            variant="default"
            onClick={() =>
              void operate(async () => {
                await api.invoke('decks.backup', { names: backupNames || [], packageName });
                setBackupNames(null);
              })
            }
          >
            {t('save')}
          </Button>
          <Button onClick={() => setBackupNames(null)}>{t('cancel')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
