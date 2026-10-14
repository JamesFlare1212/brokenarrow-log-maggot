import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { Account, PublicConfig } from '@ba/contracts';
import { THEMES } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Dialog, Button, Field, Toggle, Notice } from '../../components/ui';
const flags = [
  ['autoQueryCurrentMatch', 'autoQuery'],
  ['inputHookEnabled', 'inputHook'],
  ['banPollEnabled', 'banPolling'],
  ['matchSyncEnabled', 'matchSync'],
  ['banCardVisible', 'banVisible'],
  ['multiAccountBond', 'multiAccount'],
] as const;
export function SettingsDialog() {
  const { api, state, patchConfig, closeModal, notify } = useApp(),
    { t } = useI18n(),
    [draft, setDraft] = useState<PublicConfig>(() => structuredClone(state.config)),
    [accounts, setAccounts] = useState<Account[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api
      .invoke('accounts.list', null)
      .then(setAccounts)
      .catch((e) => setError(String(e)));
  }, [api]);
  useEffect(() => {
    document.documentElement.dataset.theme = draft.theme;
    return () => {
      document.documentElement.dataset.theme = state.config.theme;
    };
  }, [draft.theme, state.config.theme]);
  const set = <K extends keyof PublicConfig>(key: K, value: PublicConfig[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const move = (index: number, direction: number) => {
    const order = [...draft.panelOrder],
      other = index + direction;
    if (other < 0 || other >= order.length) return;
    const first = order[index],
      second = order[other];
    if (first && second) {
      order[index] = second;
      order[other] = first;
      set('panelOrder', order);
    }
  };
  const choose = async (kind: 'logs' | 'decks') => {
    try {
      const dir = await api.invoke('directory.select', { kind });
      if (dir) set(kind === 'logs' ? 'logDir' : 'decksDir', dir);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Dialog open onClose={closeModal} title={t('settings')} className="dialog-wide">
      <div className="settings-grid">
        <Field id="settings-log" label={t('logDirectory')}>
          <div className="input-action">
            <input
              id="settings-log"
              value={draft.logDir}
              onChange={(e) => set('logDir', e.target.value)}
            />
            <Button onClick={() => void choose('logs')}>{t('select')}</Button>
            <Button
              onClick={() =>
                void api
                  .invoke('directory.detect', null)
                  .then((dir) => set('logDir', dir))
                  .catch((e) => setError(String(e)))
              }
            >
              {t('detect')}
            </Button>
          </div>
        </Field>
        <Field id="settings-decks" label={t('decksDirectory')}>
          <div className="input-action">
            <input
              id="settings-decks"
              value={draft.decksDir}
              onChange={(e) => set('decksDir', e.target.value)}
              placeholder={t('defaultDirectory')}
            />
            <Button onClick={() => void choose('decks')}>{t('select')}</Button>
          </div>
        </Field>
        <div className="settings-flags">
          {flags.map(([key, label]) => (
            <Toggle
              key={key}
              id={'setting-' + key}
              label={t(label)}
              checked={draft[key]}
              onChange={(value) => set(key, value)}
            />
          ))}
        </div>
        <h3>{t('theme')}</h3>
        <div className="theme-options">
          {THEMES.map((theme) => (
            <Button
              key={theme}
              className="theme-option"
              data-theme={theme}
              aria-pressed={draft.theme === theme}
              onClick={() => set('theme', theme)}
            >
              <i aria-hidden="true" />
              {theme}
            </Button>
          ))}
        </div>
        <Field id="settings-language" label={t('language')}>
          <select
            id="settings-language"
            value={draft.lang}
            onChange={(e) => set('lang', e.target.value as PublicConfig['lang'])}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ru">Русский</option>
          </select>
        </Field>
        <h3>{t('panelOrder')}</h3>
        <ol className="panel-order">
          {draft.panelOrder.map((panel, index) => (
            <li key={panel}>
              <span>{t(panel)}</span>
              <div className="actions">
                <Button
                  disabled={index === 0}
                  aria-label={t('moveUp') + ' ' + t(panel)}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} />
                </Button>
                <Button
                  disabled={index === draft.panelOrder.length - 1}
                  aria-label={t('moveDown') + ' ' + t(panel)}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} />
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <h3>{t('accounts')}</h3>
        <div className="account-list">
          {accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <span>
                {account.name}{' '}
                <small>
                  #{account.id} · {account.matchCount}
                </small>
              </span>
              <Button
                variant="danger"
                onClick={() => {
                  if (!window.confirm(t('deleteConfirm'))) return;
                  void api
                    .invoke('accounts.delete', { id: account.id })
                    .then(() => api.invoke('accounts.list', null))
                    .then(setAccounts)
                    .catch((e) => setError(String(e)));
                }}
              >
                {t('delete')}
              </Button>
            </div>
          ))}
        </div>
        <div className="actions">
          <Button
            onClick={() =>
              void api
                .invoke('api.health', { force: true })
                .then(() => notify(t('success')))
                .catch((e) => setError(String(e)))
            }
          >
            {t('health')}
          </Button>
        </div>
        {state.migration.warnings.length > 0 && (
          <Notice error>
            <strong>{t('migrationWarnings')}</strong>
            <ul>
              {state.migration.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Notice>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="dialog-footer">
          <Button onClick={closeModal} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void patchConfig(draft)
                .then(() => {
                  notify(t('success'));
                  closeModal();
                })
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {t('save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
