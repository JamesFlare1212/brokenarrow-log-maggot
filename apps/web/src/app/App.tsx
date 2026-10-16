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
  Activity,
  Archive,
  ChevronRight,
  Crosshair,
  Info,
  Layers,
  LayoutDashboard,
  Menu,
  Radar,
  Search,
  Settings,
  ShieldCheck,
  Video,
} from 'lucide-react';
import type { Panel } from '@ba/contracts';
import { useApp } from './state';
import { useI18n } from '../hooks/useI18n';
import { Badge, Button, Dialog, Loading, Notice } from '../components/ui';
import { BatraceStatus } from '../components/BatraceStatus';
import { PageToolbar, SidebarToggle } from '../components/PageToolbar';
import {
  Sidebar,
  SidebarFooter,
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
import { UpdatePanel } from '../features/settings/UpdatePanel';
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
  current: <LayoutDashboard size={19} />,
  radar: <Radar size={19} />,
  players: <Search size={19} />,
  apm: <Activity size={19} />,
  archive: <Archive size={19} />,
  replays: <Video size={19} />,
  decks: <Layers size={19} />,
  bans: <ShieldCheck size={19} />,
};

function Brand() {
  const { t } = useI18n();
  return (
    <SidebarHeading className="brand" icon={<Crosshair size={22} strokeWidth={1.7} />}>
      <strong>{t('brand')}</strong>
    </SidebarHeading>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { state, page, setPage, settings } = useApp(),
    { t } = useI18n();
  return (
    <SidebarNavigation aria-label={t('workspaceNav')}>
      {state.config.panelOrder.map((panel) => (
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
            settings.draft?.sidebarCollapsed
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
    scrollPositions = useRef(new Map<string, number>()),
    previousPage = useRef<string>(settingsTab ? `settings/${settingsTab}` : page);
  useEffect(() => {
    const remember = () => scrollPositions.current.set(previousPage.current, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, []);
  useLayoutEffect(() => {
    const route = settingsTab ? `settings/${settingsTab}` : page;
    if (previousPage.current === route) return;
    previousPage.current = route;
    const scrollTop = scrollPositions.current.get(route) || 0;
    document.documentElement.scrollTop = scrollTop;
    document.body.scrollTop = scrollTop;
    if (!settingsTab) main.current?.focus({ preventScroll: true });
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
      <Sidebar className="sidebar" collapsed={collapsed} hidden={Boolean(settingsTab)}>
        <Brand />
        <Navigation />
        <SidebarFooter className="sidebar-footer">
          <SidebarItem
            className="settings-button"
            icon={<Settings size={18} />}
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
            <SidebarToggle
              collapsed={collapsed}
              onToggle={() => settings.change({ sidebarCollapsed: !collapsed })}
            />
            <Button
              className="mobile-menu"
              aria-label={t('openNavigation')}
              aria-expanded={navigationOpen}
              onClick={() => setNavigationOpen(true)}
            >
              <Menu size={20} />
            </Button>
            <span>Broken Arrow</span>
            <ChevronRight size={14} className="muted" aria-hidden="true" />
            <strong>{t(page === 'current' ? 'overview' : page)}</strong>
          </div>
          <div className="topbar-actions">
            <BatraceStatus health={state.health} />
            <button
              className="account-button"
              aria-label={`${t('currentAccount')}: ${account}`}
              onClick={() =>
                state.session.localPlayerId
                  ? openModal({ type: 'profile', id: state.session.localPlayerId, name: account })
                  : openSettings('accounts')
              }
            >
              {account.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </PageToolbar>
        <main id="main-content" ref={main} tabIndex={-1} aria-labelledby="page-title">
          <div className="page-heading">
            <div>
              <h1 id="page-title">{title}</h1>
              <p>{t(page === 'current' ? 'overviewDescription' : `${page}Description`)}</p>
            </div>
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
          </div>
          {!state.config.logDir && page === 'current' && (
            <Notice>
              <span>{t('noDirectory')}</span>
              <Button onClick={() => openSettings('connection')}>{t('select')}</Button>
            </Notice>
          )}
          <UpdatePanel compact />
          {[...new Set([...visited, page])].map((panel) => (
            <div key={panel} className={`feature-page page-${panel}`} hidden={page !== panel}>
              {components[panel]}
            </div>
          ))}
        </main>
        <footer className="app-footer">
          <span>
            <Info size={13} aria-hidden="true" />
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
              <Activity size={14} className={healthBusy ? 'spinner' : ''} />
            </Button>
          </span>
        </footer>
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
            <Settings size={18} />
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
    </div>
  );
}
