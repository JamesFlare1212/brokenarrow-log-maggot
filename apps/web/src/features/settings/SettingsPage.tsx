import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FieldGroup,
  FieldDescription,
  Field as FormField,
  FieldLabel,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group';
import { Item, ItemContent, ItemTitle, ItemActions } from '@/components/ui/item';
import { SidebarInset, useSidebar } from '@/components/ui/sidebar';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp as faArrowUp,
  ArrowDown as faArrowDown,
  FolderOpen as faFolderOpen,
  Palette as faPalette,
  SlidersHorizontal as faSliders,
  List as faList,
  Plug as faPlug,
  Users as faUsers,
  ArrowLeft as faArrowLeft,
  Check as faCheck,
  LoaderCircle as faSpinner,
  Video as faVideo,
  Database as faDatabase,
  RefreshCw as faArrowsRotate,
  Search as faMagnifyingGlass,
  Activity as faWaveSquare,
  ShieldCheck as faShieldHalved,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import { BrandLogo } from '../../components/BrandLogo';
import type { Account, PublicConfig } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { Button, Dialog, Field, Toggle, Notice, Empty } from '../../components/ui';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageToolbar } from '../../components/PageToolbar';
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarToggle,
} from '../../components/Sidebar';
import { AboutSettings } from './AboutSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { CacheSettings } from './CacheSettings';
import { UpdateButton } from './UpdateButton';
import { RecordingSettings } from '../replays/RecordingSettings';
import type { SettingsSaveStatus } from '../../hooks/useSettingsAutosave';

const tabs = [
  { id: 'general', label: 'generalSettings', icon: faSliders },
  { id: 'appearance', label: 'appearance', icon: faPalette },
  { id: 'connection', label: 'gameConnection', icon: faPlug },
  { id: 'automation', label: 'automation', icon: faSliders },
  { id: 'cache', label: 'cache', icon: faDatabase },
  { id: 'recording', label: 'recordingSettings', icon: faVideo },
  { id: 'navigation', label: 'navigationSettings', icon: faList },
  { id: 'accounts', label: 'accounts', icon: faUsers },
] as const;
const flags = [
  ['autoQueryCurrentMatch', 'autoQuery', faMagnifyingGlass],
  ['inputHookEnabled', 'inputHook', faWaveSquare],
  ['banPollEnabled', 'banPolling', faShieldHalved],
  ['matchSyncEnabled', 'matchSync', faArrowsRotate],
  ['multiAccountBond', 'multiAccount', faUsers],
] as const;

export function SettingsPage() {
  const confirm = useConfirmation();
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
  const sidebar = useSidebar();
  const setTab: typeof openSettings = (value) => {
    openSettings(value);
    sidebar.setOpenMobile(false);
  };
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
    <Tabs
      orientation="vertical"
      value={tab ?? 'appearance'}
      onValueChange={(value) => setTab(value as typeof currentTab.id)}
      className="settings-page"
      aria-labelledby="settings-title"
    >
      <Sidebar id="settings-sidebar" className="settings-sidebar" label={t('settings')}>
        <SidebarHeader>
          <SidebarHeading className="settings-brand" icon={<BrandLogo />}>
            <h1 id="settings-title" className="text-base font-semibold">
              {t('settings')}
            </h1>
            <span className="truncate text-xs text-muted-foreground">{t('brand')}</span>
          </SidebarHeading>
        </SidebarHeader>
        <TabsList variant="navigation" className="settings-tabs" aria-label={t('settings')}>
          {tabs.map(({ id, label, icon: TabIcon }) => (
            <TabsTrigger
              value={id}
              key={id}
              onClick={() => setTab(id)}
              id={'settings-tab-' + id}
              aria-controls={'settings-panel-' + id}
              aria-label={t(label)}
              title={collapsed ? t(label) : undefined}
            >
              <TabIcon aria-hidden="true" />
              <span className="group-data-[collapsible=icon]:hidden">{t(label)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
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
          <UpdateButton />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset
        className="settings-main"
        id="settings-content"
        aria-label={t('settings')}
        tabIndex={-1}
      >
        <PageToolbar className="settings-page-toolbar">
          <div className="settings-breadcrumb">
            {sidebar.isMobile && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('settingsBack')}
                disabled={returning}
                onClick={() => void back()}
              >
                <Icon icon={faArrowLeft} />
              </Button>
            )}
            <SidebarToggle controls="settings-sidebar" />
            <Separator
              orientation="vertical"
              className="mx-2 data-vertical:h-4 data-vertical:self-center"
            />
            <span className="hidden text-muted-foreground sm:inline">{t('settings')}</span>
            <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
              /
            </span>
            <h2 className="truncate">{t(currentTab.label)}</h2>
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
        {tabs.map(({ id }) => (
          <TabsContent
            value={id}
            forceMount
            key={id}
            id={'settings-panel-' + id}
            aria-labelledby={'settings-tab-' + id}
            hidden={tab !== id}
            tabIndex={0}
            className="settings-content"
          >
            {id === 'appearance' && <AppearanceSettings draft={draft} change={settings.change} />}
            {id === 'cache' && tab === 'cache' && <CacheSettings />}
            {id === 'general' && (
              <>
                <Card>
                  <CardHeader className="sr-only">
                    <CardTitle>{t('language')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Field id="settings-language" label={t('language')} orientation="horizontal">
                      <NativeSelect
                        className="w-44"
                        id="settings-language"
                        value={draft.lang}
                        onChange={(e) => set('lang', e.target.value as PublicConfig['lang'])}
                      >
                        <NativeSelectOption value="zh">中文</NativeSelectOption>
                        <NativeSelectOption value="en">English</NativeSelectOption>
                      </NativeSelect>
                    </Field>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle id="analytics-heading">{t('analytics')}</CardTitle>
                    <CardDescription id="analytics-description">
                      {t('analyticsDescription')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <Toggle
                        id="setting-analyticsEnabled"
                        label={t('analyticsEnabled')}
                        aria-describedby="analytics-description analytics-privacy"
                        checked={draft.analyticsEnabled}
                        onChange={(value) =>
                          settings.change({
                            analyticsEnabled: value,
                            analyticsChoiceSaved: true,
                          })
                        }
                      />
                      <FieldDescription id="analytics-privacy">
                        {t('analyticsPrivacy')}
                      </FieldDescription>
                    </FieldGroup>
                  </CardContent>
                </Card>
                <AboutSettings />
              </>
            )}
            {id === 'connection' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('gameConnection')}</CardTitle>
                    <CardDescription>{t('settingsHint.connection')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <Field id="settings-log" label={t('logDirectory')}>
                        <InputGroup>
                          <InputGroupInput
                            id="settings-log"
                            value={draft.logDir}
                            onChange={(e) => set('logDir', e.target.value, 500)}
                            onBlur={() => void flush()}
                            aria-describedby={logFeedback ? 'settings-log-feedback' : undefined}
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton onClick={() => void choose('logs')}>
                              <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                              {t('select')}
                            </InputGroupButton>
                            <InputGroupButton
                              disabled={detecting}
                              aria-busy={detecting}
                              onClick={() => void detect()}
                            >
                              {t(detecting ? 'detectingLogs' : 'detect')}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
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
                        <InputGroup>
                          <InputGroupInput
                            id="settings-decks"
                            value={draft.decksDir || defaultDecksDir}
                            onChange={(e) => set('decksDir', e.target.value, 500)}
                            onBlur={() => void flush()}
                            placeholder={t('defaultDirectory')}
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton onClick={() => void choose('decks')}>
                              <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                              {t('select')}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('health')}</CardTitle>
                    <CardDescription>{t('healthHint')}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="settings-health-summary">
                      <span className="settings-feature-icon" aria-hidden="true">
                        <Icon icon={faWaveSquare} size={18} />
                      </span>
                      <div className="settings-health-copy">
                        <div
                          className="settings-health-feedback"
                          role={healthError ? 'alert' : 'status'}
                        >
                          {healthError || (healthPending ? t('loading') : '')}
                        </div>
                      </div>
                    </div>
                    <Button
                      disabled={healthPending}
                      aria-busy={healthPending}
                      onClick={() => void checkHealth()}
                    >
                      <Icon icon={faWaveSquare} size={16} spin={healthPending} aria-hidden="true" />
                      {t('healthCheck')}
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
            {id === 'automation' && (
              <section className="settings-automation" aria-label={t('automation')}>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('automation')}</CardTitle>
                    <CardDescription>{t('settingsHint.automation')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup className="automation-options">
                      {flags.map(([key, label, icon], index) => (
                        <div key={key} className="automation-option">
                          <FormField orientation="horizontal">
                            <FieldLabel htmlFor={'setting-' + key}>
                              <Icon icon={icon} aria-hidden="true" />
                              {t(label)}
                            </FieldLabel>
                            <Switch
                              id={'setting-' + key}
                              checked={draft[key]}
                              onCheckedChange={(value) => set(key, value)}
                            />
                          </FormField>
                          {index < flags.length - 1 && <Separator />}
                        </div>
                      ))}
                    </FieldGroup>
                  </CardContent>
                </Card>
              </section>
            )}
            {id === 'recording' && tab === id && (
              <RecordingSettings inline onStatusChange={setRecordingStatus} />
            )}
            {id === 'navigation' && (
              <section
                className="settings-section settings-navigation"
                aria-labelledby="navigation-order-heading"
              >
                <Card>
                  <CardHeader>
                    <CardTitle id="navigation-order-heading">{t('panelOrder')}</CardTitle>
                    <CardDescription>{t('settingsHint.navigation')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ol className="panel-order" ref={orderList}>
                      {draft.panelOrder.map((panel, index) => (
                        <li
                          key={panel}
                          data-panel={panel}
                          data-hidden={draft.hiddenPanels.includes(panel)}
                        >
                          <Item className="panel-order-row" size="sm">
                            <ItemContent>
                              <ItemTitle>
                                <span className="panel-order-label">
                                  <small>{String(index + 1).padStart(2, '0')}</small>
                                  {t(panel)}
                                </span>
                              </ItemTitle>
                            </ItemContent>
                            <ItemActions>
                              <div className="panel-order-actions">
                                <Switch
                                  id={`navigation-visible-${panel}`}
                                  aria-label={t('showInNavigation') + ' ' + t(panel)}
                                  checked={!draft.hiddenPanels.includes(panel)}
                                  onCheckedChange={(visible) =>
                                    set(
                                      'hiddenPanels',
                                      visible
                                        ? draft.hiddenPanels.filter((hidden) => hidden !== panel)
                                        : [...draft.hiddenPanels, panel],
                                    )
                                  }
                                />
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={index === 0}
                                  aria-label={t('moveUp') + ' ' + t(panel)}
                                  onClick={() => move(index, -1)}
                                >
                                  <Icon icon={faArrowUp} size={16} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={index === draft.panelOrder.length - 1}
                                  aria-label={t('moveDown') + ' ' + t(panel)}
                                  onClick={() => move(index, 1)}
                                >
                                  <Icon icon={faArrowDown} size={16} />
                                </Button>
                              </div>
                            </ItemActions>
                          </Item>
                          {index < draft.panelOrder.length - 1 && <Separator />}
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              </section>
            )}
            {id === 'accounts' && (
              <section className="settings-section" aria-busy={accountsLoading}>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('recognizedAccounts')}</CardTitle>
                    <CardDescription>{t('settingsHint.accounts')}</CardDescription>
                  </CardHeader>
                  <CardContent>
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
                      <div className="account-list">
                        {accounts.map((account) => (
                          <Item variant="outline" key={account.id}>
                            <ItemContent>
                              <ItemTitle>{account.name}</ItemTitle>
                              <p className="muted">
                                #{account.id} · {t('accountMatches', { count: account.matchCount })}
                              </p>
                            </ItemContent>
                            <ItemActions>
                              <Button
                                variant="destructive"
                                onClick={async () => {
                                  if (
                                    !(await confirm({
                                      title: t('confirmation.deleteAccount'),
                                      description: t('confirmation.deleteAccountHint'),
                                      detail: `${account.name} · #${account.id}`,
                                      confirmLabel: t('delete'),
                                    }))
                                  )
                                    return;
                                  void api
                                    .invoke('accounts.delete', { id: account.id })
                                    .then(() => api.invoke('accounts.list', null))
                                    .then(setAccounts)
                                    .catch((e) => setError(String(e)));
                                }}
                              >
                                {t('delete')}
                              </Button>
                            </ItemActions>
                          </Item>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}
          </TabsContent>
        ))}
      </SidebarInset>
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
          <Button
            variant="destructive"
            disabled={returning}
            onClick={() => void discardAndReturn()}
          >
            {t('settingsDiscard')}
          </Button>
        </div>
      </Dialog>
    </Tabs>
  );
}
