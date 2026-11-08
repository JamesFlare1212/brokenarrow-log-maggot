import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Archive as faBoxArchive,
  Layers as faLayerGroup,
  LayoutDashboard as faTableCellsLarge,
  Radar as faSatelliteDish,
  Search as faMagnifyingGlass,
  Settings as faGear,
  ShieldCheck as faShieldHalved,
  Video as faVideo,
} from 'lucide-react';
import { Icon } from '../components/Icon';
import { BrandLogo } from '../components/BrandLogo';
import { TooltipButton } from '../components/Tooltip';
import type { Panel } from '@ba/contracts';
import { useApp } from './state';
import { useI18n } from '../hooks/useI18n';
import { Badge, Button, Loading, Notice } from '../components/ui';
import { BatraceStatus } from '../components/BatraceStatus';
import { PageToolbar } from '../components/PageToolbar';
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarNavigation,
  SidebarToggle,
  SidebarProvider,
} from '../components/Sidebar';
import { Dashboard } from '../features/overview/Dashboard';
import { SessionPanel } from '../features/session/SessionPanel';
import { PlayersPanel } from '../features/players/PlayersPanel';
import { MatchArchive } from '../features/matches/MatchArchive';
import { BansPanel, BanAlertDialog } from '../features/bans/BansPanel';
import { DecksPanel } from '../features/decks/DecksPanel';
import { ReplaysPanel } from '../features/replays/ReplaysPanel';
import { UpdateButton } from '../features/settings/UpdateButton';
import { AnalyticsConsentDialog } from '../features/settings/AnalyticsConsentDialog';
import { hasAnalyticsChoice } from '@ba/contracts';
import { cn } from '@/lib/utils';
import { panelLabelKey } from '@/lib/navigation';
import { SidebarInset } from '@/components/ui/sidebar';
import { WorkspaceBreadcrumb } from '../components/WorkspaceBreadcrumb';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
const ProfileDialog = lazy(() =>
  import('../features/players/ProfileDialog').then((module) => ({ default: module.ProfileDialog })),
);
const MatchDialog = lazy(() =>
  import('../features/matches/MatchDialog').then((module) => ({ default: module.MatchDialog })),
);
const RecordingSettings = lazy(() =>
  import('../features/replays/RecordingSettings').then((module) => ({
    default: module.RecordingSettings,
  })),
);
const ReplayDialog = lazy(() =>
  import('../features/replays/ReplayDialog').then((module) => ({ default: module.ReplayDialog })),
);
const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);

const icons: Record<Panel, ReactNode> = {
  current: <Icon icon={faTableCellsLarge} size={19} />,
  radar: <Icon icon={faSatelliteDish} size={19} />,
  players: <Icon icon={faMagnifyingGlass} size={19} />,
  archive: <Icon icon={faBoxArchive} size={19} />,
  replays: <Icon icon={faVideo} size={19} />,
  decks: <Icon icon={faLayerGroup} size={19} />,
  bans: <Icon icon={faShieldHalved} size={19} />,
};

function Brand() {
  const { t } = useI18n();
  return (
    <SidebarHeading className="brand" icon={<BrandLogo />}>
      <strong className="truncate text-base font-semibold">{t('brand')}</strong>
      <span className="text-xs text-muted-foreground">Broken Arrow</span>
    </SidebarHeading>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { state, page, setPage, settings } = useApp(),
    { t } = useI18n();
  return (
    <SidebarNavigation aria-label={t('workspaceNav')} heading={t('workspaceNav')}>
      {state.config.panelOrder
        .filter((panel) => !state.config.hiddenPanels.includes(panel))
        .map((panel) => (
          <SidebarItem
            key={panel}
            className="nav-item"
            icon={icons[panel]}
            label={t(panelLabelKey(panel))}
            selected={page === panel}
            onClick={() => {
              setPage(panel);
              onNavigate?.();
            }}
            aria-current={page === panel ? 'page' : undefined}
            aria-label={t(panelLabelKey(panel))}
            title={
              (settings.draft?.sidebarCollapsed ?? state.config.sidebarCollapsed)
                ? t(panelLabelKey(panel))
                : undefined
            }
          />
        ))}
    </SidebarNavigation>
  );
}

function ModalRouter() {
  const { modal } = useApp();
  if (!modal) return null;
  switch (modal.type) {
    case 'profile':
      return <ProfileDialog key={modal.id} id={modal.id} name={modal.name} />;
    case 'match':
      return <MatchDialog key={modal.fid} fid={modal.fid} />;
    case 'recordingSettings':
      return <RecordingSettings enable={modal.enable} />;
    case 'replay':
      return <ReplayDialog key={modal.id} id={modal.id} title={modal.title} />;
    case 'banAlert':
      return <BanAlertDialog players={modal.players} />;
  }
}

export function App() {
  const { state, api, page, settingsTab, settings, openSettings, openModal } = useApp(),
    { t } = useI18n();
  const [visited, setVisited] = useState<Panel[]>([page]);
  useEffect(() => {
    if (
      window.assistant === api &&
      state.config.analyticsEnabled &&
      hasAnalyticsChoice(state.config)
    )
      void api
        .invoke('diagnostics.report', { type: 'feature', feature: settingsTab ? 'settings' : page })
        .catch(() => {});
  }, [api, page, settingsTab, state.config.analyticsEnabled, state.config.analyticsChoiceSaved]);
  const main = useRef<HTMLDivElement>(null),
    workspaceScroll = useRef<HTMLDivElement>(null),
    scrollPositions = useRef(new Map<string, number>()),
    previousPage = useRef<string>(settingsTab ? `settings/${settingsTab}` : page);
  useLayoutEffect(() => {
    const route = settingsTab ? `settings/${settingsTab}` : page;
    if (previousPage.current === route) return;
    previousPage.current = route;
    if (!settingsTab) {
      if (workspaceScroll.current)
        workspaceScroll.current.scrollTop = scrollPositions.current.get(route) || 0;
      main.current?.focus({ preventScroll: true });
    }
  }, [page, settingsTab]);
  useEffect(() => {
    setVisited((pages) => (pages.includes(page) ? pages : [...pages, page]));
  }, [page]);
  const components: Record<Panel, ReactNode> = {
    current: <Dashboard />,
    radar: <SessionPanel standalone />,
    players: <PlayersPanel />,
    archive: <MatchArchive />,
    replays: <ReplaysPanel />,
    decks: <DecksPanel />,
    bans: <BansPanel />,
  };
  const status =
    state.watcher.error ||
    t(
      state.watcher.recovering
        ? 'recovering'
        : state.watcher.listening
          ? 'listening'
          : 'notListening',
    );
  const isListening = state.watcher.listening && !state.watcher.error;
  const title = t(page === 'current' ? 'commandCenter' : page);
  const account = state.session.localName || t('noAccount');
  const collapsed = settings.draft?.sidebarCollapsed ?? state.config.sidebarCollapsed;
  return (
    <SidebarProvider
      width={settings.draft?.sidebarWidth ?? state.config.sidebarWidth}
      onWidthChange={(sidebarWidth) => settings.change({ sidebarWidth })}
      open={!collapsed}
      onOpenChange={(open) => settings.change({ sidebarCollapsed: !open })}
      className={cn(
        "app-shell h-[100svh] min-h-0 overflow-hidden [&_[data-slot='sidebar-inset']]:m-0 [&_[data-slot='sidebar-inset']]:rounded-none! [&_[data-slot='sidebar-inset']]:shadow-none [&_[data-slot='sidebar-container']]:py-0 min-[768px]:[&:has([data-slot='sidebar'][data-state='expanded'])_[data-slot='sidebar-inset']]:[border-start-start-radius:16px]! min-[768px]:[&:has([data-slot='sidebar'][data-state='expanded'])_[data-slot='sidebar-inset']]:[border-end-start-radius:16px]!",
        settingsTab && 'app-shell-settings',
      )}
      data-ready="true"
    >
      <a
        className="skip-link fixed top-4 left-4 z-[100] p-3 rounded-(--radius) bg-primary text-primary-foreground -translate-y-[200%] [&:focus]:translate-y-0"
        href={settingsTab ? '#settings-content' : '#main-content'}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById(settingsTab ? 'settings-content' : 'main-content')?.focus();
        }}
      >
        {t('skipContent')}
      </a>
      <Sidebar id="workspace-sidebar" className="sidebar" hidden={Boolean(settingsTab)}>
        <SidebarHeader>
          <Brand />
        </SidebarHeader>
        <Navigation />
        <SidebarFooter className="sidebar-footer">
          <SidebarItem
            className="settings-button"
            icon={<Icon icon={faGear} size={18} />}
            label={t('settings')}
            aria-label={t('settings')}
            title={t('settings')}
            onClick={() => openSettings()}
          />
          <UpdateButton />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset
        className="workspace flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden @container/workspace"
        hidden={Boolean(settingsTab)}
      >
        <PageToolbar className="topbar">
          <div className="topbar-location flex items-center gap-2 min-w-0 [&_[data-slot='breadcrumb-list']]:flex-nowrap [&_[data-slot='breadcrumb-item']:last-child]:min-w-0 [&_[data-slot='breadcrumb-page']]:overflow-hidden [&_[data-slot='breadcrumb-page']]:text-ellipsis [&_[data-slot='breadcrumb-page']]:whitespace-nowrap">
            <SidebarToggle controls="workspace-sidebar" />
            <Separator
              orientation="vertical"
              className="mx-2 data-vertical:h-4 data-vertical:self-center"
            />
            <WorkspaceBreadcrumb />
          </div>
          <div className="topbar-actions flex items-center gap-2 shrink-0">
            <div className="topbar-health flex items-center gap-2 viewport-max-767:hidden workspace-max-48:hidden">
              <BatraceStatus
                health={state.health}
                onCheck={() => api.invoke('api.health', { force: true })}
              />
            </div>
            <TooltipButton
              variant="ghost"
              size="icon"
              aria-label={`${t('currentAccount')}: ${account}`}
              onClick={() =>
                state.session.localPlayerId
                  ? openModal({ type: 'profile', id: state.session.localPlayerId, name: account })
                  : openSettings('accounts')
              }
            >
              <Avatar size="sm">
                <AvatarFallback>{account.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            </TooltipButton>
          </div>
        </PageToolbar>
        <div
          className={cn(
            'workspace-scroll flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable] [scroll-padding-block:1.5rem] overscroll-contain',
            (page === 'archive' || page === 'bans') &&
              'workspace-scroll-results flex flex-col overflow-hidden [scrollbar-gutter:auto]',
          )}
          ref={workspaceScroll}
          onScroll={(event) => {
            if (!settingsTab) scrollPositions.current.set(page, event.currentTarget.scrollTop);
          }}
        >
          <div
            id="main-content"
            className={cn(
              'flex flex-col gap-(--content-gap) w-full max-w-360 mx-auto p-6 outline-none [&:has(>_.page-archive:not([hidden])>.match-detail-page)]:max-w-none [&:has(>_.page-archive:not([hidden])>.match-detail-page)]:p-0 viewport-max-767:p-5',
              page === 'archive' || page === 'bans'
                ? 'results-page [.workspace-scroll-results_&]:h-auto [.workspace-scroll-results_&]:min-h-0 [.workspace-scroll-results_&]:flex-1 h-full'
                : undefined,
            )}
            ref={main}
            tabIndex={-1}
            aria-labelledby="page-title"
          >
            <header className="page-heading flex items-start justify-between gap-4 shrink-0 [&_h1]:text-[1.5rem] [&_h1]:font-semibold [&_h1]:tracking-[-0.025em] [&_h1]:leading-[1.3] [&_h1]:text-balance [&_p]:max-w-[65ch] [&_p]:mt-1.5 [&_p]:text-muted-foreground [&_p]:text-[0.875rem] [&_p]:leading-[1.5] viewport-max-767:gap-2 viewport-max-479:flex-wrap workspace-heading grid grid-cols-[minmax(0,_1fr)_auto] [#main-content:has(>_.page-archive:not([hidden])>.match-detail-page)>&]:hidden">
              <div className="min-w-0">
                <h1 id="page-title">{title}</h1>
                <p>{t(`pageHint.${page}`)}</p>
              </div>
              <div
                className="page-heading-status flex flex-wrap items-center gap-2 pt-1.5 max-w-[min(100%,_22rem)] [&_[data-slot='badge']]:whitespace-normal [&_[data-slot='badge']]:wrap-anywhere viewport-max-767:shrink-0 viewport-max-479:pt-1 viewport-max-479:[&_[data-slot='badge']]:max-w-full"
                role="status"
                data-log-status
              >
                <Badge tone={isListening ? 'success' : state.watcher.error ? 'danger' : 'muted'}>
                  {status}
                </Badge>
              </div>
            </header>
            {!state.config.logDir && page === 'current' && (
              <Notice>
                <span>{t('noDirectory')}</span>
                <Button onClick={() => openSettings('connection')}>{t('select')}</Button>
              </Notice>
            )}
            {[...new Set([...visited, page])].map((panel) => (
              <div
                key={panel}
                className={`feature-page flex flex-col min-w-0 [.results-page>&]:flex-1 [.results-page>&]:min-h-0 page-${panel}`}
                hidden={page !== panel}
              >
                {components[panel]}
              </div>
            ))}
          </div>
        </div>
      </SidebarInset>
      {settingsTab && (
        <Suspense fallback={<Loading />}>
          <SettingsPage />
        </Suspense>
      )}
      <Suspense
        fallback={
          <span className="sr-only" role="status">
            {t('loading')}
          </span>
        }
      >
        {hasAnalyticsChoice(state.config) && <ModalRouter />}
      </Suspense>
      <AnalyticsConsentDialog />
      {settings.error && !settingsTab && (
        <div className="settings-save-alert fixed bottom-4 right-4 max-w-100">
          <Notice error>
            <strong>{t('settingsSaveFailed')}</strong>
            <p>{settings.error}</p>
            <div className="actions flex items-center gap-2 flex-wrap [.add-match-form_&]:justify-end [.dialog-body>&:last-child]:justify-end viewport-max-767:[.profile-toolbar>&]:gap-1.5">
              <Button onClick={() => void settings.flush()}>{t('settingsRetry')}</Button>
              <Button onClick={() => void settings.discard()}>{t('settingsDiscard')}</Button>
            </div>
          </Notice>
        </div>
      )}
    </SidebarProvider>
  );
}
