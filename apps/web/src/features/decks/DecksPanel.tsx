import { useEffect, useState, type ReactNode } from 'react';
import {
  faLayerGroup,
  faFileLines,
  faFolderOpen,
  faArrowsRotate,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import type { DeckList, DeckFile } from '@ba/contracts';
import { formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Dialog, Field, Notice, Loading, Empty } from '../../components/ui';
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
  return (
    <>
      <div className="deck-list-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        {actions}
      </div>
      <fieldset
        className="field deck-fieldset"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint`}
      >
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
            files.map((f) => (
              <label className="deck-file" key={f.name}>
                <input
                  type="checkbox"
                  checked={selected.includes(f.name)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, f.name]
                        : selected.filter((name) => name !== f.name),
                    )
                  }
                />
                <Icon icon={faFileLines} size={17} className="muted" aria-hidden="true" />
                <span>{f.name}</span>
                <small>{formatSize(f.size)}</small>
              </label>
            ))
          ) : (
            <Empty>{t('empty')}</Empty>
          )}
        </div>
        <Button
          onClick={() => onChange(selected.length === files.length ? [] : files.map((f) => f.name))}
          disabled={!files.length}
        >
          {t(selected.length === files.length && files.length ? 'clearSelection' : 'selectAll')}
          <small className="muted">
            {selected.length} / {files.length}
          </small>
        </Button>
        <small id={`${id}-hint`}>{t('deckSelectionHint')}</small>
      </fieldset>
    </>
  );
}
export function DecksPanel() {
  const { api, state, notify } = useApp(),
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
    </div>
  );
}
