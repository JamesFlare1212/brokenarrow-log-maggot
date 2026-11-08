import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  FieldGroup,
  FieldContent,
  FieldDescription,
  Field as FormField,
  FieldLabel,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group';
import { Item, ItemContent, ItemTitle, ItemActions } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { panelLabelKey } from '@/lib/navigation';
import { LoadingStatus } from '../../components/LoadingState';
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
  Activity,
  ChevronDown,
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
  ['banPollEnabled', 'banPolling', faShieldHalved],
  ['matchSyncEnabled', 'matchSync', faArrowsRotate],
  ['multiAccountBond', 'multiAccount', faUsers],
] as const;

export function SettingsPage() {
  const confirm = useConfirmation();
  const {
      api,
      state,
      page,
      settings,
      settingsTab: tab,
      openSettings,
      closeSettings,
      notify,
    } = useApp(),
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
    orderFocus = useRef<HTMLButtonElement | null>(null),
    orderPositions = useRef(new Map<string, number>()),
    orderAnimations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const button = orderFocus.current;
    orderFocus.current = null;
    if (button?.isConnected && !button.disabled) button.focus({ preventScroll: true });
  }, [draft.panelOrder]);
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
  const saveStatuses = tab === 'recording' ? [settings.status, recordingStatus] : [settings.status];
  const saveStatus = saveStatuses.includes('error')
    ? 'error'
    : saveStatuses.includes('saving')
      ? 'saving'
      : saveStatuses.includes('pending')
        ? 'pending'
        : 'saved';
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
  const move = (index: number, direction: number, button: HTMLButtonElement) => {
    const order = [...draft.panelOrder],
      other = index + direction;
    if (other < 0 || other >= order.length) return;
    const first = order[index],
      second = order[other];
    if (first && second) {
      const focusDirection = other === 0 ? 1 : other === order.length - 1 ? -1 : direction;
      orderFocus.current =
        button
          .closest('.panel-order-actions')
          ?.querySelector<HTMLButtonElement>(`[data-order-direction="${focusDirection}"]`) ?? null;
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
      className="settings-page flex flex-1 min-w-0 min-h-0 flex-row gap-0"
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
        <TabsList
          variant="navigation"
          className="settings-tabs flex flex-1 w-full h-auto flex-col items-stretch justify-start gap-1 py-3 px-2 min-h-0 overflow-y-auto [&>[data-slot='tabs-trigger']]:flex-none [&>[data-slot='tabs-trigger']]:justify-start [[data-collapsible='icon']_&>[data-slot='tabs-trigger']]:w-10 [[data-collapsible='icon']_&>[data-slot='tabs-trigger']]:self-center [[data-collapsible='icon']_&>[data-slot='tabs-trigger']]:justify-center [[data-collapsible='icon']_&>[data-slot='tabs-trigger']]:px-0"
          aria-label={t('settings')}
        >
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
        className="settings-main flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden @container/settings"
        id="settings-content"
        aria-label={t('settings')}
        tabIndex={-1}
      >
        <PageToolbar className="settings-page-toolbar">
          <div className="settings-breadcrumb flex min-w-0 items-center gap-2 viewport-max-479:gap-1.5">
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
            <Breadcrumb className="min-w-0" aria-label={t('breadcrumb')}>
              <BreadcrumbList className="flex-nowrap">
                <BreadcrumbItem className="shrink-0 settings-max-36:hidden">
                  <BreadcrumbLink
                    href={'#' + page}
                    aria-disabled={returning || undefined}
                    tabIndex={returning ? -1 : undefined}
                    className="aria-disabled:opacity-50"
                    onClick={(event) => {
                      event.preventDefault();
                      if (!returning) void back();
                    }}
                  >
                    {t(panelLabelKey(page))}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="shrink-0 settings-max-36:hidden" />
                <BreadcrumbItem className="shrink-0 viewport-max-479:hidden">
                  <BreadcrumbLink
                    href="#settings/appearance"
                    onClick={(event) => {
                      event.preventDefault();
                      setTab('appearance');
                    }}
                  >
                    {t('settings')}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="shrink-0 viewport-max-479:hidden" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="settings-current-label truncate">
                    {t(currentTab.label)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div
            className="settings-save-state flex shrink-0 items-center gap-2 text-muted-foreground text-[0.75rem] md:whitespace-nowrap [.recording-settings>&]:col-span-full viewport-max-767:max-w-32 viewport-max-479:max-w-24"
            role="status"
            aria-live="polite"
          >
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
          <div className="settings-errors flex flex-wrap gap-2 py-4 px-6">
            <Notice error>{settings.error ?? error}</Notice>
            {settings.error && <Button onClick={() => void flush()}>{t('settingsRetry')}</Button>}
            {settings.error && (
              <Button onClick={() => void settings.discard()}>{t('settingsDiscard')}</Button>
            )}
          </div>
        )}
        {tabs.map(({ id, label }) => (
          <TabsContent
            value={id}
            forceMount
            key={id}
            id={'settings-panel-' + id}
            aria-labelledby={'settings-tab-' + id}
            hidden={tab !== id}
            tabIndex={0}
            className="settings-content flex-1 min-h-0 overflow-auto p-6 [scrollbar-gutter:stable] [scroll-padding-block:1.5rem] overscroll-contain [&>*]:w-full [&>*]:max-w-256 [&>*]:mx-auto [&>*+*]:mt-(--content-gap) viewport-max-767:p-5"
          >
            <header className="settings-page-heading [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h2]:tracking-[-0.025em] [&_h2]:leading-[1.3] [&_h2]:text-balance [&_p]:max-w-[65ch] [&_p]:mt-1.5 [&_p]:text-muted-foreground [&_p]:text-[0.875rem] [&_p]:leading-[1.5] mb-6">
              <h2>{t(label)}</h2>
              <p>{t(`settingsHint.${id}`)}</p>
            </header>
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
                <Card
                  className="settings-privacy-card @container/privacy"
                  role="region"
                  aria-labelledby="analytics-heading"
                >
                  <CardHeader className="flex flex-col gap-4 @min-[32rem]/privacy:flex-row @min-[32rem]/privacy:items-center">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <CardTitle id="analytics-heading">{t('analytics')}</CardTitle>
                      <CardDescription id="analytics-description" className="wrap-anywhere">
                        {t('analyticsSummary')}
                      </CardDescription>
                    </div>
                    <CardAction className="w-full self-stretch @min-[32rem]/privacy:w-32 @min-[32rem]/privacy:shrink-0 @min-[32rem]/privacy:self-center">
                      <Toggle
                        id="setting-analyticsEnabled"
                        label={t('analyticsEnabledShort')}
                        aria-label={t('analyticsEnabledShort') + ' · ' + t('analyticsEnabled')}
                        aria-describedby="analytics-description analytics-privacy"
                        checked={draft.analyticsEnabled}
                        onChange={(value) =>
                          settings.change({
                            analyticsEnabled: value,
                            analyticsChoiceSaved: true,
                          })
                        }
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <FieldDescription id="analytics-privacy">
                      {t('analyticsPrivacySummary')}
                    </FieldDescription>
                    <Collapsible className="group/privacy-details">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="w-fit justify-start px-0">
                          {t('analyticsDetails')}
                          <ChevronDown
                            data-icon="inline-end"
                            aria-hidden="true"
                            className="transition-transform group-data-[state=open]/privacy-details:rotate-180 motion-reduce:transition-none"
                          />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="flex flex-col gap-3 pt-3 text-sm text-muted-foreground wrap-anywhere">
                        <p>{t('analyticsDescription')}</p>
                        <p>{t('analyticsPrivacy')}</p>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardContent>
                </Card>
                <AboutSettings />
              </>
            )}
            {id === 'connection' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('localFolders')}</CardTitle>
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
                          <InputGroupAddon align={sidebar.isMobile ? 'block-end' : 'inline-end'}>
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
                <Card
                  className="settings-health-card @container/health-check"
                  role="region"
                  aria-labelledby="settings-health-title"
                >
                  <CardHeader className="flex flex-col gap-4 @min-[30rem]/health-check:flex-row @min-[30rem]/health-check:items-center">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <CardTitle id="settings-health-title">{t('health')}</CardTitle>
                      <CardDescription>{t('healthHint')}</CardDescription>
                    </div>
                    <CardAction className="w-full self-stretch @min-[30rem]/health-check:w-auto @min-[30rem]/health-check:shrink-0 @min-[30rem]/health-check:self-center">
                      <Button
                        className="w-full"
                        disabled={healthPending}
                        aria-busy={healthPending}
                        onClick={() => void checkHealth()}
                      >
                        {healthPending ? (
                          <Spinner data-icon="inline-start" aria-hidden="true" />
                        ) : (
                          <Activity data-icon="inline-start" aria-hidden="true" />
                        )}
                        {t('healthCheck')}
                      </Button>
                    </CardAction>
                    <span className="sr-only" role="status">
                      {healthPending ? t('loading') : ''}
                    </span>
                  </CardHeader>
                  {healthError && (
                    <CardContent className="settings-health-feedback">
                      <Notice error>
                        <span>{healthError}</span>
                      </Notice>
                    </CardContent>
                  )}
                </Card>
              </>
            )}
            {id === 'automation' && (
              <section
                className="settings-automation flex flex-col gap-3 [.settings-content>&]:max-w-192"
                aria-label={t('automation')}
              >
                <Card className="@container/automation-options">
                  <CardHeader className="sr-only">
                    <CardTitle>{t('automation')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup className="automation-options grid auto-rows-fr gap-0">
                      {flags.map(([key, label, icon], index) => (
                        <div key={key} className="automation-option flex min-w-0 flex-col">
                          <FormField
                            orientation="horizontal"
                            className="min-h-16 flex-1 gap-4 py-2.5 has-[>[data-slot=field-content]]:items-center @max-[24rem]/automation-options:grid @max-[24rem]/automation-options:grid-cols-[auto_minmax(0,_1fr)_auto] @max-[24rem]/automation-options:grid-rows-[auto_auto] @max-[24rem]/automation-options:content-center @max-[24rem]/automation-options:gap-y-0.5"
                          >
                            <Icon
                              icon={icon}
                              size={18}
                              className="shrink-0 text-muted-foreground @max-[24rem]/automation-options:col-start-1 @max-[24rem]/automation-options:row-start-1"
                              aria-hidden="true"
                            />
                            <FieldContent className="min-w-0 @max-[24rem]/automation-options:contents">
                              <FieldLabel
                                htmlFor={'setting-' + key}
                                className="max-w-full cursor-pointer @max-[24rem]/automation-options:col-start-2 @max-[24rem]/automation-options:row-start-1"
                              >
                                {t(label)}
                              </FieldLabel>
                              <FieldDescription
                                id={'setting-' + key + '-description'}
                                className="@max-[24rem]/automation-options:col-start-2 @max-[24rem]/automation-options:col-end-4 @max-[24rem]/automation-options:row-start-2"
                              >
                                {t(label + 'Hint')}
                              </FieldDescription>
                            </FieldContent>
                            <Switch
                              id={'setting-' + key}
                              className="@max-[24rem]/automation-options:col-start-3 @max-[24rem]/automation-options:row-start-1"
                              aria-describedby={'setting-' + key + '-description'}
                              checked={draft[key]}
                              onCheckedChange={(value) => set(key, value)}
                            />
                          </FormField>
                          {index < flags.length - 1 && (
                            <Separator className="ml-8.5 data-[orientation=horizontal]:w-[calc(100%_-_2.125rem)]" />
                          )}
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
                className="settings-section flex min-w-0 flex-col gap-(--content-gap) settings-navigation [.settings-content>&]:max-w-192"
                aria-labelledby="navigation-order-heading"
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <CardTitle id="navigation-order-heading" className="min-w-0">
                      {t('panelOrder')}
                    </CardTitle>
                    <CardAction
                      className="flex shrink-0 items-center gap-3 self-center"
                      aria-hidden="true"
                    >
                      <span className="w-8 text-center text-xs text-muted-foreground">
                        {t('navigationVisibleLabel')}
                      </span>
                      <span className="w-14.5 text-center text-xs text-muted-foreground">
                        {t('navigationOrderLabel')}
                      </span>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <ol className="panel-order flex flex-col gap-0" ref={orderList}>
                      {draft.panelOrder.map((panel, index) => (
                        <li
                          key={panel}
                          data-panel={panel}
                          data-hidden={draft.hiddenPanels.includes(panel)}
                        >
                          <Item
                            className="panel-order-row min-h-12.5 flex-nowrap gap-3 px-0 py-1"
                            size="sm"
                          >
                            <ItemContent className="min-w-0">
                              <ItemTitle className="block w-full line-clamp-none">
                                <span className="panel-order-label grid min-w-0 grid-cols-[1.25rem_minmax(0,_1fr)] items-center gap-3">
                                  <small
                                    className="text-xs text-muted-foreground tabular-nums"
                                    aria-hidden="true"
                                  >
                                    {String(index + 1).padStart(2, '0')}
                                  </small>
                                  <span
                                    className={cn(
                                      'wrap-anywhere',
                                      draft.hiddenPanels.includes(panel) && 'text-muted-foreground',
                                    )}
                                  >
                                    {t(panelLabelKey(panel))}
                                  </span>
                                </span>
                              </ItemTitle>
                            </ItemContent>
                            <ItemActions>
                              <div className="panel-order-actions flex shrink-0 items-center gap-3">
                                <Switch
                                  id={`navigation-visible-${panel}`}
                                  aria-label={t('showInNavigation') + ' ' + t(panelLabelKey(panel))}
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
                                <div className="flex items-center gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={index === 0}
                                    data-order-direction={-1}
                                    aria-label={t('moveUp') + ' ' + t(panelLabelKey(panel))}
                                    onClick={(event) => move(index, -1, event.currentTarget)}
                                  >
                                    <Icon icon={faArrowUp} size={16} />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={index === draft.panelOrder.length - 1}
                                    data-order-direction={1}
                                    aria-label={t('moveDown') + ' ' + t(panelLabelKey(panel))}
                                    onClick={(event) => move(index, 1, event.currentTarget)}
                                  >
                                    <Icon icon={faArrowDown} size={16} />
                                  </Button>
                                </div>
                              </div>
                            </ItemActions>
                          </Item>
                          {index < draft.panelOrder.length - 1 && (
                            <Separator className="ml-8 data-[orientation=horizontal]:w-[calc(100%_-_2rem)]" />
                          )}
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              </section>
            )}
            {id === 'accounts' && (
              <section
                className="settings-section flex min-w-0 flex-col gap-(--content-gap)"
                aria-busy={accountsLoading}
              >
                <Card>
                  <CardHeader>
                    <CardTitle>{t('recognizedAccounts')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {accountsLoading ? (
                      <>
                        <LoadingStatus />
                        <div className="account-list flex flex-col gap-3" aria-hidden="true">
                          <Item variant="outline">
                            <ItemContent>
                              <Skeleton className="h-5 w-32" />
                              <Skeleton className="h-5 w-48 max-w-full" />
                            </ItemContent>
                            <ItemActions>
                              <Skeleton className="h-8 w-16" />
                            </ItemActions>
                          </Item>
                        </div>
                      </>
                    ) : accounts.length === 0 ? (
                      <Empty
                        icon={<Icon icon={faUsers} size={26} aria-hidden="true" />}
                        description={t('accountsEmptyHint')}
                      >
                        {t('accountsEmpty')}
                      </Empty>
                    ) : (
                      <div className="account-list flex flex-col gap-3">
                        {accounts.map((account) => (
                          <Item variant="outline" key={account.id}>
                            <ItemContent>
                              <ItemTitle>{account.name}</ItemTitle>
                              <p className="muted text-muted-foreground">
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
        <div className="actions flex items-center gap-2 flex-wrap [.add-match-form_&]:justify-end [.dialog-body>&:last-child]:justify-end viewport-max-767:[.profile-toolbar>&]:gap-1.5">
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
