import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import type { DeckList, DeckFile } from '@ba/contracts';
import { formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Card, Dialog, Field, Notice, Loading, Empty } from '../../components/ui';
function DeckFiles({
  id,
  title,
  files,
  selected,
  onChange,
}: {
  id: string;
  title: string;
  files: DeckFile[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const { t } = useI18n();
  return (
    <Field id={id} label={title}>
      <select
        id={id}
        multiple
        size={8}
        value={selected}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            onChange(files.map((f) => f.name));
          }
        }}
      >
        {files.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name} · {formatSize(f.size)}
          </option>
        ))}
      </select>
      <Button onClick={() => onChange(files.map((f) => f.name))} disabled={!files.length}>
        {t('selectAll')}
      </Button>
    </Field>
  );
}
export function DecksPanel() {
  const { api, state, notify, patchConfig } = useApp(),
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
  const list = request.data,
    collapsed = state.config.collapsedPanels.includes('decks');
  return (
    <Card
      title={t('decks')}
      icon={<Layers size={19} />}
      collapsed={collapsed}
      onToggle={() =>
        void patchConfig({
          collapsedPanels: collapsed
            ? state.config.collapsedPanels.filter((p) => p !== 'decks')
            : [...state.config.collapsedPanels, 'decks'],
        })
      }
      actions={
        <Button disabled={request.pending || busy} onClick={refresh}>
          {t('refresh')}
        </Button>
      }
    >
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
        <Empty>{t('deckMissing')}</Empty>
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
                  {t('folder')}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy || !front.length}
                  onClick={() => {
                    if (window.confirm(t('deleteConfirm')))
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
              />
              <small className="path">{list.backupsDir}</small>
              <div className="actions">
                <Button
                  disabled={busy || back.length !== 1}
                  variant="primary"
                  onClick={() => {
                    if (window.confirm(t('deploy') + '?'))
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
                  variant="danger"
                  disabled={busy || !back.length}
                  onClick={() => {
                    if (window.confirm(t('deleteConfirm')))
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
          <input
            id="backup-name"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            maxLength={200}
          />
        </Field>
        <div className="actions">
          <Button
            disabled={busy || !packageName.trim()}
            variant="primary"
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
    </Card>
  );
}
