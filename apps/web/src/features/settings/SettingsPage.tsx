import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TELEMETRY_CONSENT_VERSION } from '@ba/contracts';
import {
  faArrowUp,
  faArrowDown,
  faFolderOpen,
  faPalette,
  faSliders,
  faList,
  faPlug,
  faUsers,
  faArrowLeft,
  faCheck,
  faSpinner,
  faVideo,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import type { Account, PublicConfig } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Dialog, Field, Toggle, Notice, Empty } from '../../components/ui';
import { PageToolbar } from '../../components/PageToolbar';
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarNavigation,
} from '../../components/Sidebar';
import { AboutSettings } from './AboutSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { RecordingSettings } from '../replays/RecordingSettings';
import type { SettingsSaveStatus } from '../../hooks/useSettingsAutosave';

const tabs = [
  { id: 'general', label: 'generalSettings', icon: faSliders },
  { id: 'appearance', label: 'appearance', icon: faPalette },
  { id: 'connection', label: 'gameConnection', icon: faPlug },
  { id: 'automation', label: 'automation', icon: faSliders },
  { id: 'recording', label: 'recordingSettings', icon: faVideo },
  { id: 'navigation', label: 'navigationSettings', icon: faList },
  { id: 'accounts', label: 'accounts', icon: faUsers },
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
    [confirmLeaving, setConfirmLeaving] = useState(false),
    [healthPending, setHealthPending] = useState(false),
    [healthError, setHealthError] = useState<string | null>(null),
    [recordingStatus, setRecordingStatus] = useState<SettingsSaveStatus>('saved'),
    [detecting, setDetecting] = useState(false),
    [defaultDecksDir, setDefaultDecksDir] = useState(''),
    [logFeedback, setLogFeedback] = useState<{ key: string; error: boolean } | null>(null),
    [error, setError] = useState<string | null>(null);
  const logRevision = useRef(0),
    logRequest = useRef(0),
    healthRunning = useRef(false);
  const draft = settings.draft ?? state.config;
  const orderList = useRef<HTMLOListElement>(null),
    orderPositions = useRef(new Map<string, number>()),
    orderAnimations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const positions = orderPositions.current;
    orderPositions.current = new Map();
    if (!positions.size) return;
    orderAnimations.current.forEach((animation) => animation.cancel());
    orderAnimations.current = [];
    const list = orderList.current;
    if (!list || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const styles = getComputedStyle(list);
    const movements = Array.from(list.children, (child) => {
      const row = child as HTMLElement;
      const previous = positions.get(row.dataset.panel!);
      return {
        row,
        offset: previous === undefined ? 0 : previous - row.getBoundingClientRect().top,
      };
    });
    orderAnimations.current = movements
      .filter(({ row, offset }) => offset !== 0 && typeof row.animate === 'function')
      .map(({ row, offset }) =>
        row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], {
          duration: Number.parseFloat(styles.getPropertyValue('--motion-normal')) || 220,
          easing: styles.getPropertyValue('--ease-out').trim() || 'ease-out',
        }),
      );
  }, [draft.panelOrder]);
  useEffect(() => () => orderAnimations.current.forEach((animation) => animation.cancel()), []);
  const collapsed = draft.sidebarCollapsed;
  const flush = settings.flush;
  const saveStatus = tab === 'recording' ? recordingStatus : settings.status;
  const setTab = openSettings;
  const back = async () => {
    setReturning(true);
    if (await flush()) closeSettings();
    else {
      setReturning(false);
      setConfirmLeaving(true);
    }
  };
  const discardAndReturn = async () => {
    setReturning(true);
    await settings.discard();
    setConfirmLeaving(false);
    closeSettings();
  };
  const checkHealth = async () => {
    if (healthRunning.current) return;
    healthRunning.current = true;
    setHealthPending(true);
    setHealthError(null);
    try {
      await api.invoke('api.health', { force: true });
      notify(t('success'));
    } catch (error) {
      setHealthError(String(error));
    } finally {
      healthRunning.current = false;
      setHealthPending(false);
    }
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
  useEffect(() => {
    if (tab !== 'connection' || state.config.decksDir) return;
    let active = true;
    void api
      .invoke('decks.list', null)
      .then((result) => {
        if (active) setDefaultDecksDir(result.decksDir);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [api, tab, state.config.decksDir]);
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
      orderPositions.current = new Map(
        Array.from(orderList.current?.children ?? [], (child) => [
          (child as HTMLElement).dataset.panel!,
          child.getBoundingClientRect().top,
        ]),
      );
      order[index] = second;
      order[other] = first;
      set('panelOrder', order);
    }
  };
  const choose = async (kind: 'logs' | 'decks') => {
    setError(null);
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
      <Sidebar id="settings-sidebar" className="settings-sidebar" collapsed={collapsed}>
        <SidebarHeader
          collapsed={collapsed}
          controls="settings-sidebar"
          onToggle={() => settings.change({ sidebarCollapsed: !collapsed })}
        >
          <SidebarHeading className="settings-brand" icon={<Icon icon={faSliders} size={22} />}>
            <h1 id="settings-title">{t('settings')}</h1>
          </SidebarHeading>
        </SidebarHeader>
        <SidebarNavigation
          as="div"
          className="settings-tabs"
          role="tablist"
          aria-label={t('settings')}
        >
          {tabs.map(({ id, label, icon }, index) => (
            <SidebarItem
              key={id}
              icon={<Icon icon={icon} size={18} />}
              label={t(label)}
              selected={tab === id}
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
            />
          ))}
        </SidebarNavigation>
        <SidebarFooter>
          <SidebarItem
            className="settings-back"
            icon={
              returning ? (
                <Icon icon={faSpinner} size={18} spin />
              ) : (
                <Icon icon={faArrowLeft} size={18} />
              )
            }
            label={t('settingsBack')}
            onClick={() => void back()}
            disabled={returning}
            aria-label={t('settingsBack')}
            title={t('settingsBack')}
          />
        </SidebarFooter>
      </Sidebar>
      <main
        className="settings-main"
        id="settings-content"
        aria-label={t('settings')}
        tabIndex={-1}
      >
        <PageToolbar className="settings-page-toolbar">
          <div className="settings-breadcrumb">
            <span>{t('settings')}</span>
            <span>/</span>
            <h2>{t(currentTab.label)}</h2>
          </div>
          <div className="settings-save-state" role="status" aria-live="polite">
            {saveStatus === 'saved' ? (
              <Icon icon={faCheck} size={14} aria-hidden="true" />
            ) : saveStatus !== 'error' ? (
              <Icon icon={faSpinner} size={14} spin aria-hidden="true" />
            ) : null}
            {t(
              saveStatus === 'saved'
                ? 'settingsAutoSaved'
                : saveStatus === 'error'
                  ? 'settingsSaveFailed'
                  : 'settingsSaving',
            )}
          </div>
        </PageToolbar>
        {(settings.error || error) && (
          <div className="settings-errors">
            <Notice error>{settings.error ?? error}</Notice>
            {settings.error && <Button onClick={() => void flush()}>{t('settingsRetry')}</Button>}
            {settings.error && (
              <Button onClick={() => void settings.discard()}>{t('settingsDiscard')}</Button>
            )}
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
            {id !== 'appearance' && id !== 'recording' && (
              <div className="settings-page-heading">
                <h2>{t(label)}</h2>
                <p>{t('settingsHint.' + id)}</p>
              </div>
            )}
            {id === 'appearance' && <AppearanceSettings draft={draft} change={settings.change} />}
            {id === 'general' && (
              <>
                <section className="settings-section settings-card settings-language-row">
                  <label htmlFor="settings-language">{t('language')}</label>
                  <select
                    id="settings-language"
                    value={draft.lang}
                    onChange={(e) => set('lang', e.target.value as PublicConfig['lang'])}
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </section>
                <section
                  className="settings-section settings-card"
                  aria-labelledby="telemetry-heading"
                >
                  <h3 id="telemetry-heading">{t('telemetry')}</h3>
                  <p id="telemetry-description">{t('telemetryDescription')}</p>
                  <Toggle
                    id="setting-telemetryEnabled"
                    label={t('telemetryEnabled')}
                    aria-describedby="telemetry-description telemetry-privacy"
                    checked={draft.telemetryEnabled}
                    onChange={(value) =>
                      settings.change({
                        telemetryEnabled: value,
                        telemetryConsentConfirmed: true,
                        telemetryConsentVersion: TELEMETRY_CONSENT_VERSION,
                      })
                    }
                  />
                  <p id="telemetry-privacy">{t('telemetryPrivacy')}</p>
                </section>
                <AboutSettings />
              </>
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
                        <Icon icon={faFolderOpen} size={16} />
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
                        value={draft.decksDir || defaultDecksDir}
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
                    <div
                      className="settings-health-feedback"
                      role={healthError ? 'alert' : 'status'}
                    >
                      {healthError || (healthPending ? t('loading') : '')}
                    </div>
                  </div>
                  <Button
                    disabled={healthPending}
                    aria-busy={healthPending}
                    onClick={() => void checkHealth()}
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
            {id === 'recording' && tab === id && (
              <RecordingSettings inline onStatusChange={setRecordingStatus} />
            )}
            {id === 'navigation' && (
              <section className="settings-section">
                <h3>{t('panelOrder')}</h3>
                <ol className="panel-order" ref={orderList}>
                  {draft.panelOrder.map((panel, index) => (
                    <li
                      key={panel}
                      data-panel={panel}
                      data-hidden={draft.hiddenPanels.includes(panel)}
                    >
                      <span className="panel-order-label">
                        <small>{String(index + 1).padStart(2, '0')}</small>
                        {t(panel)}
                      </span>
                      <div className="actions panel-order-actions">
                        <Toggle
                          id={`navigation-visible-${panel}`}
                          label={t(
                            draft.hiddenPanels.includes(panel) ? 'pageHidden' : 'pageVisible',
                          )}
                          aria-label={t('showInNavigation') + ' ' + t(panel)}
                          checked={!draft.hiddenPanels.includes(panel)}
                          onChange={(visible) =>
                            set(
                              'hiddenPanels',
                              visible
                                ? draft.hiddenPanels.filter((hidden) => hidden !== panel)
                                : [...draft.hiddenPanels, panel],
                            )
                          }
                        />
                        <Button
                          disabled={index === 0}
                          aria-label={t('moveUp') + ' ' + t(panel)}
                          onClick={() => move(index, -1)}
                        >
                          <Icon icon={faArrowUp} size={16} />
                        </Button>
                        <Button
                          disabled={index === draft.panelOrder.length - 1}
                          aria-label={t('moveDown') + ' ' + t(panel)}
                          onClick={() => move(index, 1)}
                        >
                          <Icon icon={faArrowDown} size={16} />
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
                    icon={<Icon icon={faUsers} size={26} aria-hidden="true" />}
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
          </div>
        ))}
      </main>
      <Dialog
        open={confirmLeaving}
        onClose={() => setConfirmLeaving(false)}
        title={t('settingsUnsavedTitle')}
      >
        <p>{t('settingsUnsavedDescription')}</p>
        <div className="actions">
          <Button disabled={returning} onClick={() => void back()}>
            {t('settingsRetry')}
          </Button>
          <Button disabled={returning} onClick={() => setConfirmLeaving(false)}>
            {t('settingsKeepEditing')}
          </Button>
          <Button variant="danger" disabled={returning} onClick={() => void discardAndReturn()}>
            {t('settingsDiscard')}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
