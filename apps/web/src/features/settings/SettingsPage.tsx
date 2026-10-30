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
  LoaderCircle as faSpinner,
  Video as faVideo,
  Database as faDatabase,
  RefreshCw as faArrowsRotate,
  Search as faMagnifyingGlass,
  ShieldCheck as faShieldHalved,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import { BrandLogo } from '../../components/BrandLogo';
import type { Account, DeckList, PublicConfig } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useHistoryDeletion } from '../history/useHistoryDeletion';
import { HistoryOperationResult } from '../history/HistoryOperationResult';
import { useRequest } from '../../hooks/useRequest';
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
import { SettingsSaveIndicator } from './SettingsSaveIndicator';
import { LogMonitoringIndicator } from '../../components/LogMonitoringIndicator';
import { HealthCheckPanel } from '../../components/HealthCheckPanel';

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
  ['banPollEnabled', 'banPolling', faShieldHalved],
  ['matchSyncEnabled', 'matchSync', faArrowsRotate],
  ['multiAccountBond', 'multiAccount', faUsers],
] as const;

interface DirectoryRequest {
  action: 'detect' | 'select';
  isCurrent: () => boolean;
}

export function SettingsPage() {
  const deletion = useHistoryDeletion();
  const accountRequest = useRequest<Account[]>();
  const accounts = accountRequest.data ?? [],
    accountsLoading = accountRequest.data === null && !accountRequest.error;
  const {
      api,
      state,
      settings,
      monitoring,
      flushSettings: flush,
      flushPendingSettings,
      discardSettings,
      settingsTab: tab,
      openSettings,
      closeSettings,
      openModal,
      healthCheck,
    } = useApp(),
    { t } = useI18n(),
    [returning, setReturning] = useState(false),
    [confirmLeaving, setConfirmLeaving] = useState(false),
    [defaultDecks, setDefaultDecks] = useState<Pick<DeckList, 'found' | 'decksDir'> | null>(null),
    [defaultDecksError, setDefaultDecksError] = useState(false),
    [, renderDirectoryRequest] = useState(0),
    [logFeedback, setLogFeedback] = useState<{
      key: string;
      error: boolean;
      path?: string;
      isCurrent: () => boolean;
    } | null>(null),
    [error, setError] = useState<string | null>(null);
  const mounted = useRef(true),
    directoryRequests = useRef<Partial<Record<'logs' | 'decks', DirectoryRequest>>>({});
  const accountRefresh = useRef<HTMLButtonElement>(null);
  const reloadAccounts = () => accountRequest.load(() => api.invoke('accounts.list', null), true);
  const retryAccounts = () => {
    if (accountRequest.pending || deletion.busy) return;
    accountRefresh.current?.focus({ preventScroll: true });
    accountRefresh.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant',
    });
    void reloadAccounts();
  };
  const draft = settings.draft ?? state.config;
  const confirmed = settings.confirmed ?? state.config;
  const directoryPending = (kind: 'logs' | 'decks', action: DirectoryRequest['action']) => {
    const request = directoryRequests.current[kind];
    return request?.action === action && request.isCurrent();
  };
  const detecting = directoryPending('logs', 'detect');
  const panelLabel = (panel: PublicConfig['panelOrder'][number]) =>
    t(panel === 'current' ? 'overview' : panel);
  const monitoredKey =
    monitoring.pending ||
    state.watcher.recovering ||
    state.watcher.checking ||
    state.watcher.dir !== logFeedback?.path
      ? 'logDetectMonitoringChecking'
      : state.watcher.error || monitoring.error
        ? 'logDetectMonitoringFailed'
        : !state.watcher.file
          ? 'logDetectWaiting'
          : state.watcher.live === false
            ? 'logDetectMonitoringStale'
            : 'logDetectMonitoringReady';
  const displayedLogFeedback = !logFeedback?.isCurrent()
    ? null
    : !logFeedback.path
      ? logFeedback
      : logFeedback.path !== draft.logDir
        ? null
        : logFeedback.path !== confirmed.logDir
          ? {
              key:
                settings.status === 'unconfirmed'
                  ? 'settingsSaveUnconfirmed'
                  : settings.status === 'error'
                    ? 'logDetectSaveFailed'
                    : 'logDetectFound',
              error: settings.status === 'error' || settings.status === 'unconfirmed',
            }
          : { key: monitoredKey, error: monitoredKey === 'logDetectMonitoringFailed', saved: true };
  const orderList = useRef<HTMLOListElement>(null),
    orderFocus = useRef<HTMLButtonElement | null>(null),
    orderFocusGeneration = useRef(0),
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
  useLayoutEffect(() => {
    const source = orderFocus.current;
    orderFocus.current = null;
    if (!source?.isConnected || source.closest('[hidden],[inert]')) return;
    if (document.activeElement !== document.body && document.activeElement !== source) return;
    const generation = orderFocusGeneration.current;
    source.focus({ preventScroll: true });
    source.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    void Promise.all(
      orderAnimations.current.map((animation) => animation.finished.catch(() => {})),
    ).then(() => {
      const active = document.activeElement;
      if (
        generation === orderFocusGeneration.current &&
        active instanceof HTMLElement &&
        orderList.current?.contains(active)
      )
        active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    });
  }, [draft.panelOrder]);
  const collapsed = draft.sidebarCollapsed;
  const sidebar = useSidebar();
  const setTab: typeof openSettings = (value) => {
    openSettings(value);
  };
  const selectTab: typeof openSettings = (value) => {
    setTab(value);
    if (sidebar.isMobile) sidebar.closeMobileForNavigation('settings-panel-' + value);
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
    await discardSettings();
    setConfirmLeaving(false);
    closeSettings();
  };
  useEffect(() => {
    mounted.current = true;
    document.getElementById('settings-content')?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      directoryRequests.current = {};
      void flushPendingSettings();
    };
  }, [flushPendingSettings]);
  useEffect(() => {
    if (state.accountsSnapshot) {
      accountRequest.invalidate();
      accountRequest.setData(state.accountsSnapshot);
      return;
    }
    void accountRequest.load(() => api.invoke('accounts.list', null), true);
  }, [api, state.matchesRevision, state.accountsRevision]);
  useEffect(() => {
    if (tab !== 'connection' || draft.decksDir) return;
    let active = true;
    setDefaultDecks(null);
    setDefaultDecksError(false);
    if (confirmed.decksDir) return;
    void api
      .invoke('decks.list', null)
      .then((result) => {
        if (active) setDefaultDecks({ found: result.found, decksDir: result.decksDir });
      })
      .catch(() => {
        if (active) setDefaultDecksError(true);
      });
    return () => {
      active = false;
    };
  }, [api, tab, draft.decksDir, confirmed.decksDir]);
  const set = <K extends keyof PublicConfig>(key: K, value: PublicConfig[K], delay = 0) => {
    if (key === 'logDir') {
      setLogFeedback(null);
    }
    settings.change({ [key]: value }, delay);
  };
  const beginDirectoryRequest = (kind: 'logs' | 'decks', action: DirectoryRequest['action']) => {
    if (directoryPending(kind, action)) return null;
    const unchanged = settings.capture(kind === 'logs' ? 'logDir' : 'decksDir');
    const request: DirectoryRequest = {
      action,
      isCurrent: () =>
        mounted.current && directoryRequests.current[kind] === request && unchanged(),
    };
    directoryRequests.current[kind] = request;
    renderDirectoryRequest((value) => value + 1);
    return request;
  };
  const finishDirectoryRequest = (kind: 'logs' | 'decks', request: DirectoryRequest) => {
    if (directoryRequests.current[kind] !== request) return;
    delete directoryRequests.current[kind];
    if (mounted.current) renderDirectoryRequest((value) => value + 1);
  };
  const foundLogDirectory = (path: string) => {
    set('logDir', path);
    setLogFeedback({
      key: 'logDetectFound',
      error: false,
      path,
      isCurrent: settings.capture('logDir'),
    });
  };
  const detect = async () => {
    const request = beginDirectoryRequest('logs', 'detect');
    if (!request) return;
    setLogFeedback(null);
    try {
      const dir = await api.invoke('directory.detect', null);
      if (!request.isCurrent()) return;
      if (dir) {
        if (dir === confirmed.logDir && dir === draft.logDir) {
          await monitoring.refresh();
          if (!request.isCurrent()) return;
        }
        foundLogDirectory(dir);
      } else {
        setLogFeedback({
          key: 'logDetectNotFound',
          error: true,
          isCurrent: settings.capture('logDir'),
        });
      }
    } catch {
      if (request.isCurrent())
        setLogFeedback({
          key: 'logDetectFailed',
          error: true,
          isCurrent: settings.capture('logDir'),
        });
    } finally {
      finishDirectoryRequest('logs', request);
    }
  };
  const move = (index: number, direction: number, source: HTMLButtonElement) => {
    const order = [...draft.panelOrder],
      other = index + direction;
    if (other < 0 || other >= order.length) return;
    const first = order[index],
      second = order[other];
    if (first && second) {
      orderFocus.current = source;
      orderFocusGeneration.current++;
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
    const request = beginDirectoryRequest(kind, 'select');
    if (!request) return;
    setError(null);
    if (kind === 'logs') setLogFeedback(null);
    try {
      const dir = await api.invoke('directory.select', { kind });
      if (!request.isCurrent()) return;
      if (dir) {
        if (kind === 'logs') foundLogDirectory(dir);
        else set('decksDir', dir);
      }
    } catch (e) {
      if (request.isCurrent()) setError(String(e));
    } finally {
      finishDirectoryRequest(kind, request);
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
              className="scroll-m-1"
              value={id}
              key={id}
              onClick={() => selectTab(id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') selectTab(id);
              }}
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
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <LogMonitoringIndicator />
            <SettingsSaveIndicator responsive />
          </div>
        </PageToolbar>
        {error && (
          <div className="settings-errors">
            <Notice error>{error}</Notice>
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
                      <Field
                        id="settings-log"
                        label={t('logDirectory')}
                        hint={t('logMonitoringSourceChangeHint')}
                      >
                        <InputGroup>
                          <InputGroupInput
                            id="settings-log"
                            value={draft.logDir}
                            onChange={(e) => set('logDir', e.target.value, 500)}
                            onBlur={() => void settings.flushPending()}
                            aria-describedby={
                              displayedLogFeedback ? 'settings-log-feedback' : undefined
                            }
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              aria-disabled={directoryPending('logs', 'select')}
                              aria-busy={directoryPending('logs', 'select')}
                              onClick={() => void choose('logs')}
                            >
                              <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                              {t('select')}
                            </InputGroupButton>
                            <InputGroupButton
                              aria-disabled={detecting}
                              aria-busy={detecting}
                              aria-label={t('detect')}
                              onClick={() => void detect()}
                            >
                              {detecting && (
                                <Icon
                                  icon={faSpinner}
                                  className="animate-spin"
                                  aria-hidden="true"
                                />
                              )}
                              {t('detect')}
                              {detecting && (
                                <span className="sr-only" role="status">
                                  {t('detectingLogs')}
                                </span>
                              )}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                        {displayedLogFeedback && (
                          <div id="settings-log-feedback">
                            <Notice error={displayedLogFeedback.error}>
                              <span role={displayedLogFeedback.error ? undefined : 'status'}>
                                {'saved' in displayedLogFeedback && (
                                  <span>{t('logDirectorySaved')} </span>
                                )}
                                <span>{t(displayedLogFeedback.key)}</span>
                              </span>
                            </Notice>
                          </div>
                        )}
                      </Field>
                      <Field
                        id="settings-decks"
                        label={t('decksDirectory')}
                        hint={t('decksAutomaticHint')}
                      >
                        <InputGroup>
                          <InputGroupInput
                            id="settings-decks"
                            value={draft.decksDir}
                            onChange={(e) => set('decksDir', e.target.value, 500)}
                            onBlur={() => void settings.flushPending()}
                            placeholder={t('defaultDirectory')}
                            aria-describedby={
                              !draft.decksDir ? 'settings-decks-feedback' : undefined
                            }
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              aria-disabled={directoryPending('decks', 'select')}
                              aria-busy={directoryPending('decks', 'select')}
                              onClick={() => void choose('decks')}
                            >
                              <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                              {t('select')}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                        {!draft.decksDir && (
                          <FieldDescription
                            id="settings-decks-feedback"
                            role="status"
                            className={
                              defaultDecksError || defaultDecks?.found === false
                                ? 'text-destructive'
                                : undefined
                            }
                          >
                            <span>
                              {t(
                                defaultDecksError
                                  ? 'decksAutomaticFailed'
                                  : !defaultDecks
                                    ? 'decksAutomaticChecking'
                                    : defaultDecks.found
                                      ? 'decksAutomaticFound'
                                      : 'decksAutomaticMissing',
                              )}
                            </span>
                            {defaultDecks?.decksDir && (
                              <span className="block break-all">{defaultDecks.decksDir}</span>
                            )}
                          </FieldDescription>
                        )}
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
                    <HealthCheckPanel request={healthCheck} collapsible />
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
              <RecordingSettings inline showSaveStatus={false} />
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
                                  {panelLabel(panel)}
                                </span>
                              </ItemTitle>
                            </ItemContent>
                            <ItemActions>
                              <div className="panel-order-actions">
                                <Switch
                                  id={`navigation-visible-${panel}`}
                                  aria-label={t('showInNavigation') + ' ' + panelLabel(panel)}
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
                                  className="scroll-m-1"
                                  aria-disabled={index === 0}
                                  aria-label={t('moveUp') + ' ' + panelLabel(panel)}
                                  onClick={(event) => move(index, -1, event.currentTarget)}
                                >
                                  <Icon icon={faArrowUp} size={16} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="scroll-m-1"
                                  aria-disabled={index === draft.panelOrder.length - 1}
                                  aria-label={t('moveDown') + ' ' + panelLabel(panel)}
                                  onClick={(event) => move(index, 1, event.currentTarget)}
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
                    <CardDescription>
                      {t('settingsHint.accounts')} {t('accountsRediscoveryHint')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="actions">
                      <Button
                        ref={accountRefresh}
                        id="accounts-refresh"
                        aria-disabled={accountRequest.pending || deletion.busy}
                        aria-busy={accountRequest.pending}
                        onClick={retryAccounts}
                      >
                        {t('refresh')}
                      </Button>
                      <Button onClick={() => openModal({ type: 'historyRecovery' })}>
                        {t('historyRecovery')}
                      </Button>
                    </div>
                    {accountRequest.error && (
                      <Notice error>
                        <div className="flex min-w-0 flex-1 flex-col gap-2 wrap-anywhere">
                          <p>{accountRequest.error}</p>
                          {accountRequest.data !== null && <p>{t('listReadRetained')}</p>}
                        </div>
                        <Button
                          aria-disabled={accountRequest.pending || deletion.busy}
                          onClick={retryAccounts}
                        >
                          {t('retry')}
                        </Button>
                      </Notice>
                    )}
                    {deletion.error && <Notice error>{deletion.error}</Notice>}
                    <HistoryOperationResult result={deletion.result} />
                    {accountsLoading ? (
                      <p role="status">{t('loading')}</p>
                    ) : accountRequest.data !== null &&
                      accounts.length === 0 &&
                      !accountRequest.error ? (
                      <Empty
                        icon={<Icon icon={faUsers} size={26} aria-hidden="true" />}
                        description={t('accountsEmptyHint')}
                      >
                        {t('accountsEmpty')}
                      </Empty>
                    ) : (
                      <div className="account-list">
                        {accounts.map((account) => (
                          <Item
                            variant="outline"
                            className="min-w-0 flex-nowrap"
                            data-account-id={account.id}
                            key={account.id}
                          >
                            <ItemContent>
                              <ItemTitle className="block w-full min-w-0 line-clamp-none wrap-anywhere">
                                {account.name}
                              </ItemTitle>
                              <p className="muted wrap-anywhere">
                                #{account.id} · {t('accountMatches', { count: account.matchCount })}
                              </p>
                            </ItemContent>
                            <ItemActions>
                              <Button
                                variant="destructive"
                                aria-label={t('deleteAccountAction', {
                                  name: account.name,
                                  id: account.id,
                                })}
                                disabled={deletion.busy || accountRequest.pending}
                                onClick={async () => {
                                  const result = await deletion.run('account', account.id);
                                  if (result === undefined) return;
                                  if (result)
                                    accountRequest.setData(
                                      (list) =>
                                        list?.filter((item) => item.id !== account.id) ?? null,
                                    );
                                  await accountRequest.load(
                                    () => api.invoke('accounts.list', null),
                                    true,
                                  );
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
