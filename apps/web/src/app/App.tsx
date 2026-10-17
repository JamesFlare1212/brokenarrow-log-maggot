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
  faWaveSquare,
  faBoxArchive,
  faChevronRight,
  faCrosshairs,
  faCircleInfo,
  faLayerGroup,
  faTableCellsLarge,
  faBars,
  faSatelliteDish,
  faMagnifyingGlass,
  faGear,
  faShieldHalved,
  faVideo,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../components/Icon';
import { TooltipButton } from '../components/Tooltip';
import type { Panel } from '@ba/contracts';
import { useApp } from './state';
import { useI18n } from '../hooks/useI18n';
import { Badge, Button, Dialog, Loading, Notice } from '../components/ui';
import { BatraceStatus } from '../components/BatraceStatus';
import { PageToolbar } from '../components/PageToolbar';
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarNavigation,
} from '../components/Sidebar';
import { Dashboard } from '../features/overview/Dashboard';
import { SessionPanel } from '../features/session/SessionPanel';
import { PlayersPanel } from '../features/players/PlayersPanel';
import { MatchArchive } from '../features/matches/MatchArchive';
import { BansPanel, BanAlertDialog } from '../features/bans/BansPanel';
import { DecksPanel } from '../features/decks/DecksPanel';
import { ApmPanel } from '../features/apm/ApmPanel';
import { ReplaysPanel } from '../features/replays/ReplaysPanel';
import { UpdateButton } from '../features/settings/UpdateButton';
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
  apm: <Icon icon={faWaveSquare} size={19} />,
  archive: <Icon icon={faBoxArchive} size={19} />,
  replays: <Icon icon={faVideo} size={19} />,
  decks: <Icon icon={faLayerGroup} size={19} />,
  bans: <Icon icon={faShieldHalved} size={19} />,
};

function Brand() {
  const { t } = useI18n();
  return (
    <SidebarHeading className="brand" icon={<Icon icon={faCrosshairs} size={22} />}>
      <strong>{t('brand')}</strong>
    </SidebarHeading>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { state, page, setPage, settings } = useApp(),
    { t } = useI18n();
  return (
    <SidebarNavigation aria-label={t('workspaceNav')}>
      {state.config.panelOrder
        .filter((panel) => !state.config.hiddenPanels.includes(panel))
        .map((panel) => (
          <SidebarItem
            key={panel}
            className="nav-item"
            icon={icons[panel]}
            label={t(panel === 'current' ? 'overview' : panel)}
            selected={page === panel}
            onClick={() => {
              setPage(panel);
              onNavigate?.();
            }}
            aria-current={page === panel ? 'page' : undefined}
            aria-label={t(panel === 'current' ? 'overview' : panel)}
            title={
              (settings.draft?.sidebarCollapsed ?? state.config.sidebarCollapsed)
                ? t(panel === 'current' ? 'overview' : panel)
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
  const { state, api, page, settingsTab, settings, openSettings, openModal, notify } = useApp(),
    { t } = useI18n();
  const [healthBusy, setHealthBusy] = useState(false),
    [navigationOpen, setNavigationOpen] = useState(false);
  const [visited, setVisited] = useState<Panel[]>([page]);
  const main = useRef<HTMLElement>(null),
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
    radar: <SessionPanel />,
    players: <PlayersPanel />,
    archive: <MatchArchive />,
    replays: <ReplaysPanel />,
    decks: <DecksPanel />,
    bans: <BansPanel />,
    apm: <ApmPanel />,
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
  const showHistoricalFooter = ['current', 'radar', 'players'].includes(page);
  const collapsed = settings.draft?.sidebarCollapsed ?? state.config.sidebarCollapsed;
  return (
    <div
      className={`app-shell ${settingsTab ? 'app-shell-settings' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}
      data-ready="true"
    >
      <a
        className="skip-link"
        href={settingsTab ? '#settings-content' : '#main-content'}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById(settingsTab ? 'settings-content' : 'main-content')?.focus();
        }}
      >
        {t('skipContent')}
      </a>
      <Sidebar
        id="workspace-sidebar"
        className="sidebar"
        collapsed={collapsed}
        hidden={Boolean(settingsTab)}
      >
        <SidebarHeader
          collapsed={collapsed}
          controls="workspace-sidebar"
          onToggle={() => settings.change({ sidebarCollapsed: !collapsed })}
        >
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
      <div className="workspace" hidden={Boolean(settingsTab)}>
        <PageToolbar className="topbar">
          <div className="topbar-location">
            <Button
              className="mobile-menu"
              aria-label={t('openNavigation')}
              aria-expanded={navigationOpen}
              onClick={() => setNavigationOpen(true)}
            >
              <Icon icon={faBars} size={20} />
            </Button>
            <span>Broken Arrow</span>
            <Icon icon={faChevronRight} size={14} className="muted" aria-hidden="true" />
            <strong>{t(page === 'current' ? 'overview' : page)}</strong>
          </div>
          <div className="topbar-actions">
            <BatraceStatus health={state.health} />
            <TooltipButton
              className="account-button"
              aria-label={`${t('currentAccount')}: ${account}`}
              onClick={() =>
                state.session.localPlayerId
                  ? openModal({ type: 'profile', id: state.session.localPlayerId, name: account })
                  : openSettings('accounts')
              }
            >
              {account.slice(0, 1).toUpperCase()}
            </TooltipButton>
          </div>
        </PageToolbar>
        <div
          className="workspace-scroll"
          ref={workspaceScroll}
          onScroll={(event) => {
            if (!settingsTab) scrollPositions.current.set(page, event.currentTarget.scrollTop);
          }}
        >
          <main id="main-content" ref={main} tabIndex={-1} aria-labelledby="page-title">
            <div className="page-heading">
              <div>
                <h1 id="page-title">{title}</h1>
                <p>{t(page === 'current' ? 'overviewDescription' : `${page}Description`)}</p>
              </div>
              {page !== 'replays' && (
                <div className="page-heading-status">
                  <span
                    className={`status-dot ${isListening ? 'status-success' : ''}`}
                    aria-hidden="true"
                  />
                  <span title={state.watcher.file || undefined}>{status}</span>
                  {new URLSearchParams(location.search).has('real') && (
                    <Badge tone="warning">{t('realDataOffline')}</Badge>
                  )}
                </div>
              )}
            </div>
            {!state.config.logDir && page === 'current' && (
              <Notice>
                <span>{t('noDirectory')}</span>
                <Button onClick={() => openSettings('connection')}>{t('select')}</Button>
              </Notice>
            )}
            {[...new Set([...visited, page])].map((panel) => (
              <div key={panel} className={`feature-page page-${panel}`} hidden={page !== panel}>
                {components[panel]}
              </div>
            ))}
          </main>
          {showHistoricalFooter && (
            <footer className="app-footer">
              <span>
                <Icon icon={faCircleInfo} size={13} aria-hidden="true" />
                {t('historical')}
              </span>
              <span>
                <Button
                  className="health-button"
                  disabled={healthBusy}
                  aria-label={t('health')}
                  onClick={() => {
                    setHealthBusy(true);
                    void api
                      .invoke('api.health', { force: true })
                      .then(() => notify(t('success')))
                      .catch((e) => notify(String(e), true))
                      .finally(() => setHealthBusy(false));
                  }}
                >
                  <Icon icon={faWaveSquare} size={14} spin={healthBusy} />
                </Button>
              </span>
            </footer>
          )}
        </div>
      </div>
      {navigationOpen && (
        <Dialog
          open
          title={t('workspaceNav')}
          onClose={() => setNavigationOpen(false)}
          className="navigation-dialog"
        >
          <Brand />
          <Navigation onNavigate={() => setNavigationOpen(false)} />
          <Button
            className="button-borderless"
            onClick={() => {
              setNavigationOpen(false);
              openSettings();
            }}
          >
            <Icon icon={faGear} size={18} />
            {t('settings')}
          </Button>
        </Dialog>
      )}
      {settingsTab && (
        <Suspense fallback={<Loading />}>
          <SettingsPage />
        </Suspense>
      )}
      <Suspense
        fallback={
          <div className="modal-loading">
            <Loading />
          </div>
        }
      >
        <ModalRouter />
      </Suspense>
      {settings.error && !settingsTab && (
        <div className="settings-save-alert" role="alert">
          <strong>{t('settingsSaveFailed')}</strong>
          <p>{settings.error}</p>
          <div className="actions">
            <Button onClick={() => void settings.flush()}>{t('settingsRetry')}</Button>
            <Button onClick={() => void settings.discard()}>{t('settingsDiscard')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
