import { Input } from '@/components/ui/input';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Layers as faLayerGroup,
  FileText as faFileLines,
  FolderOpen as faFolderOpen,
  RefreshCw as faArrowsRotate,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { DeckList, DeckFile } from '@ba/contracts';
import { formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Dialog, Field, Notice, Loading, Empty } from '../../components/ui';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/card';
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
}: {
  id: string;
  title: string;
  files: DeckFile[];
  selected: string[];
  onChange: (names: string[]) => void;
  actions?: ReactNode;
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
        <CardAction>{actions}</CardAction>
      </CardHeader>
      <CardContent>
        <FieldSet className="field deck-fieldset">
          <FieldLegend className="sr-only">{title}</FieldLegend>
          <div
            id={id}
            className="deck-file-list"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                onChange(files.map((f) => f.name));
              }
            }}
          >
            {files.length ? (
              <FieldGroup>
                {files.map((f, index) => (
                  <PrimitiveField orientation="horizontal" key={f.name}>
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
                    <FieldLabel
                      htmlFor={`${id}-${index}`}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <Icon icon={faFileLines} aria-hidden="true" />
                      <span className="truncate">{f.name}</span>
                    </FieldLabel>
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
              disabled={!files.length}
            />
            <FieldLabel htmlFor={`${id}-all`}>{t('selectAll')}</FieldLabel>
            <small className="muted">
              {selectedCount} / {files.length}
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
  const refreshButton = (
    <Button disabled={request.pending || busy} aria-busy={request.pending} onClick={refresh}>
      <Icon icon={faArrowsRotate} size={15} spin={request.pending} aria-hidden="true" />
      {t('refresh')}
    </Button>
  );
  return (
    <div className="decks-panel">
      {!list?.found && <div className="deck-toolbar">{refreshButton}</div>}
      {state.deckAlert && (
        <Notice>
          <span>{t('deckSwitch', { name: state.deckAlert.from })}</span>
          <div className="actions">
            {(['restore', 'ignore', 'dismiss'] as const).map((action) => (
              <Button
                key={action}
                disabled={busy}
                onClick={() => void operate(() => api.invoke('decks.switch', { action }))}
              >
                {t(action === 'dismiss' ? 'close' : action)}
              </Button>
            ))}
          </div>
        </Notice>
      )}
      {request.pending && !list && <Loading />}
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
        list && (
          <div className="deck-columns">
            <section>
              <DeckFiles
                id="front-decks"
                title={t('frontDecks')}
                files={list.decks}
                selected={front}
                onChange={setFront}
                actions={refreshButton}
              />
              <small className="path">{list.decksDir}</small>
              <div className="actions">
                <Button
                  disabled={busy || !front.length}
                  onClick={() => {
                    setPackageName('decks-' + new Date().toISOString().slice(0, 10));
                    setBackupNames(front);
                  }}
                >
                  <Icon icon={faLayerGroup} size={16} aria-hidden="true" />
                  {t('backupSelected')}
                </Button>
                <Button
                  disabled={busy || !list.decks.length}
                  onClick={() => {
                    setPackageName('decks-' + new Date().toISOString().slice(0, 10));
                    setBackupNames(list.decks.map((d) => d.name));
                  }}
                >
                  {t('backupAll')}
                </Button>
                <Button
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
              </div>
            </section>
            <section>
              <DeckFiles
                id="back-decks"
                title={t('backups')}
                files={list.backups}
                selected={back}
                onChange={setBack}
                actions={refreshButton}
              />
              <small className="path">{list.backupsDir}</small>
              <div className="actions">
                <Button
                  disabled={busy || back.length !== 1}
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
              </div>
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
        <div className="actions">
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
