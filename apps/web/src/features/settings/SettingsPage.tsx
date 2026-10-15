import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Palette,
  SlidersHorizontal,
  LayoutList,
  Cable,
  Settings2,
  Users,
  Download,
  ArrowLeft,
  Check,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { Account, PublicConfig } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Field, Toggle, Notice, Empty } from '../../components/ui';
import { UpdatePanel } from './UpdatePanel';
import { AppearanceSettings } from './AppearanceSettings';

const tabs = [
  { id: 'general', label: 'generalSettings', icon: Settings2 },
  { id: 'appearance', label: 'appearance', icon: Palette },
  { id: 'connection', label: 'gameConnection', icon: Cable },
  { id: 'automation', label: 'automation', icon: SlidersHorizontal },
  { id: 'navigation', label: 'navigationSettings', icon: LayoutList },
  { id: 'accounts', label: 'accounts', icon: Users },
  { id: 'updates', label: 'appUpdates', icon: Download },
] as const;
const flags = [
  ['autoQueryCurrentMatch', 'autoQuery'],
  ['inputHookEnabled', 'inputHook'],
  ['banPollEnabled', 'banPolling'],
  ['matchSyncEnabled', 'matchSync'],
  ['multiAccountBond', 'multiAccount'],
] as const;

export function SettingsPage() {
  const { api, state, settings, settingsTab: tab, openSettings, closeSettings, notify } = useApp(),
    { t } = useI18n(),
    [accounts, setAccounts] = useState<Account[]>([]),
    [accountsLoading, setAccountsLoading] = useState(true),
    [returning, setReturning] = useState(false),
    [detecting, setDetecting] = useState(false),
    [logFeedback, setLogFeedback] = useState<{ key: string; error: boolean } | null>(null),
    [error, setError] = useState<string | null>(null);
  const logRevision = useRef(0),
    logRequest = useRef(0);
  const draft = settings.draft ?? state.config;
  const collapsed = draft.sidebarCollapsed;
  const flush = settings.flush;
  const setTab = openSettings;
  const back = async () => {
    setReturning(true);
    if (await flush()) closeSettings();
    else setReturning(false);
  };
  useEffect(() => {
    document.getElementById('settings-content')?.focus({ preventScroll: true });
    return () => {
      logRequest.current++;
      void flush();
    };
  }, [flush]);
  useEffect(() => {
    let active = true;
    void api
      .invoke('accounts.list', null)
      .then((value) => {
        if (active) setAccounts(value);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setAccountsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);
  const set = <K extends keyof PublicConfig>(key: K, value: PublicConfig[K], delay = 0) => {
    if (key === 'logDir') {
      logRevision.current++;
      setLogFeedback(null);
    }
    settings.change({ [key]: value }, delay);
  };
  const detect = async () => {
    const request = ++logRequest.current,
      revision = logRevision.current;
    setDetecting(true);
    setLogFeedback(null);
    try {
      const dir = await api.invoke('directory.detect', null);
      if (request !== logRequest.current || revision !== logRevision.current) return;
      if (dir) set('logDir', dir);
      setLogFeedback({ key: dir ? 'logDetectFound' : 'logDetectNotFound', error: !dir });
    } catch {
      if (request === logRequest.current && revision === logRevision.current)
        setLogFeedback({ key: 'logDetectFailed', error: true });
    } finally {
      if (request === logRequest.current) setDetecting(false);
    }
  };
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
  const currentTab = tabs.find((item) => item.id === tab)!;
  return (
    <section
      className={`settings-page ${collapsed ? 'settings-page-collapsed' : ''}`}
      aria-labelledby="settings-title"
    >
      <aside className="settings-sidebar">
        <div className="settings-brand">
          <Settings2 size={22} aria-hidden="true" />
          <h1 id="settings-title">{t('settings')}</h1>
        </div>
        <div className="settings-tabs" role="tablist" aria-label={t('settings')}>
          {tabs.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={'settings-tab-' + id}
              aria-controls={'settings-panel-' + id}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              className="settings-tab"
              title={collapsed ? t(label) : undefined}
              aria-label={t(label)}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
                  next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
                  next = (index - 1 + tabs.length) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                const target = tabs[next]!;
                setTab(target.id);
                document.getElementById('settings-tab-' + target.id)?.focus();
              }}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
        <Button
          className="settings-back button-borderless"
          onClick={() => void back()}
          disabled={returning}
          aria-label={t('settingsBack')}
          title={t('settingsBack')}
        >
          {returning ? <LoaderCircle size={17} className="spinner" /> : <ArrowLeft size={17} />}
          <span>{t('settingsBack')}</span>
        </Button>
      </aside>
      <main
        className="settings-main"
        id="settings-content"
        aria-label={t('settings')}
        tabIndex={-1}
      >
        <div className="settings-page-toolbar">
          <Button
            className="sidebar-collapse-toggle button-borderless"
            aria-label={t(collapsed ? 'expandSidebar' : 'collapseSidebar')}
            aria-expanded={!collapsed}
            onClick={() => settings.change({ sidebarCollapsed: !collapsed })}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </Button>
          <div className="settings-breadcrumb">
            <span>{t('settings')}</span>
            <span>/</span>
            <h2>{t(currentTab.label)}</h2>
          </div>
          <div className="settings-save-state" role="status" aria-live="polite">
            {settings.status === 'saved' ? (
              <Check size={14} aria-hidden="true" />
            ) : settings.status !== 'error' ? (
              <LoaderCircle size={14} className="spinner" aria-hidden="true" />
            ) : null}
            {t(
              settings.status === 'saved'
                ? 'settingsAutoSaved'
                : settings.status === 'error'
                  ? 'settingsSaveFailed'
                  : 'settingsSaving',
            )}
          </div>
        </div>
        {(settings.error || error) && (
          <div className="settings-errors">
            <Notice error>{settings.error ?? error}</Notice>
            {settings.error && <Button onClick={() => void flush()}>{t('settingsRetry')}</Button>}
          </div>
        )}
        {tabs.map(({ id, label }) => (
          <div
            key={id}
            role="tabpanel"
            id={'settings-panel-' + id}
            aria-labelledby={'settings-tab-' + id}
            hidden={tab !== id}
            tabIndex={0}
            className="settings-content"
          >
            {id !== 'appearance' && (
              <div className="settings-page-heading">
                <h2>{t(label)}</h2>
                <p>{t('settingsHint.' + id)}</p>
              </div>
            )}
            {id === 'appearance' && <AppearanceSettings draft={draft} change={settings.change} />}
            {id === 'general' && (
              <section className="settings-section settings-card">
                <Field id="settings-language" label={t('language')} hint={t('languageHint')}>
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
              </section>
            )}
            {id === 'connection' && (
              <>
                <section className="settings-section settings-card">
                  <Field id="settings-log" label={t('logDirectory')}>
                    <div className="input-action">
                      <input
                        id="settings-log"
                        value={draft.logDir}
                        onChange={(e) => set('logDir', e.target.value, 500)}
                        onBlur={() => void flush()}
                        aria-describedby={logFeedback ? 'settings-log-feedback' : undefined}
                      />
                      <Button onClick={() => void choose('logs')}>
                        <FolderOpen size={16} />
                        {t('select')}
                      </Button>
                      <Button
                        disabled={detecting}
                        aria-busy={detecting}
                        onClick={() => void detect()}
                      >
                        {t(detecting ? 'detectingLogs' : 'detect')}
                      </Button>
                    </div>
                    {logFeedback && (
                      <div id="settings-log-feedback">
                        <Notice error={logFeedback.error}>
                          <span role={logFeedback.error ? undefined : 'status'}>
                            {t(logFeedback.key)}
                          </span>
                        </Notice>
                      </div>
                    )}
                  </Field>
                  <Field id="settings-decks" label={t('decksDirectory')}>
                    <div className="input-action">
                      <input
                        id="settings-decks"
                        value={draft.decksDir}
                        onChange={(e) => set('decksDir', e.target.value, 500)}
                        onBlur={() => void flush()}
                        placeholder={t('defaultDirectory')}
                      />
                      <Button onClick={() => void choose('decks')}>{t('select')}</Button>
                    </div>
                  </Field>
                </section>
                <div className="settings-health settings-card">
                  <div>
                    <h3>{t('health')}</h3>
                    <p>{t('healthHint')}</p>
                  </div>
                  <Button
                    onClick={() =>
                      void api
                        .invoke('api.health', { force: true })
                        .then(() => notify(t('success')))
                        .catch((e) => setError(String(e)))
                    }
                  >
                    {t('healthCheck')}
                  </Button>
                </div>
              </>
            )}
            {id === 'automation' && (
              <section className="settings-section settings-card settings-flags">
                {flags.map(([key, label]) => (
                  <Toggle
                    key={key}
                    id={'setting-' + key}
                    label={t(label)}
                    checked={draft[key]}
                    onChange={(value) => set(key, value)}
                  />
                ))}
              </section>
            )}
            {id === 'navigation' && (
              <section className="settings-section">
                <h3>{t('panelOrder')}</h3>
                <ol className="panel-order">
                  {draft.panelOrder.map((panel, index) => (
                    <li key={panel}>
                      <span className="panel-order-label">
                        <small>{String(index + 1).padStart(2, '0')}</small>
                        {t(panel)}
                      </span>
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
              </section>
            )}
            {id === 'accounts' && (
              <section className="settings-section" aria-busy={accountsLoading}>
                {accountsLoading ? (
                  <p role="status">{t('loading')}</p>
                ) : accounts.length === 0 ? (
                  <Empty
                    icon={<Users size={26} aria-hidden="true" />}
                    description={t('accountsEmptyHint')}
                  >
                    {t('accountsEmpty')}
                  </Empty>
                ) : (
                  <div className="account-list settings-card">
                    {accounts.map((account) => (
                      <div className="account-row" key={account.id}>
                        <span>
                          {account.name}
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
                )}
              </section>
            )}
            {id === 'updates' && (
              <>
                <UpdatePanel />
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
              </>
            )}
          </div>
        ))}
      </main>
    </section>
  );
}
