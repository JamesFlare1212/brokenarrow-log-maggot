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
  ArrowUpRight,
  ChevronRight,
  Crosshair,
  Globe2,
  HardDrive,
  Info,
  Layers,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Video,
} from 'lucide-react';
import type { Panel } from '@ba/contracts';
import { useApp } from './state';
import { useI18n } from '../hooks/useI18n';
import { Badge, Button, Card, Dialog, Loading, Notice } from '../components/ui';
import { Dashboard } from '../features/overview/Dashboard';
import { PlayersPanel } from '../features/players/PlayersPanel';
import { MatchArchive } from '../features/matches/MatchArchive';
import { BansPanel, BanAlertDialog } from '../features/bans/BansPanel';
import { DecksPanel } from '../features/decks/DecksPanel';
import { ApmPanel } from '../features/apm/ApmPanel';
import { ReplaysPanel } from '../features/replays/ReplaysPanel';
import { UpdatePanel } from '../features/settings/UpdatePanel';
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
const SettingsDialog = lazy(() =>
  import('../features/settings/SettingsDialog').then((module) => ({
    default: module.SettingsDialog,
  })),
);

const icons: Record<Panel, ReactNode> = {
  current: <LayoutDashboard size={19} />,
  players: <Search size={19} />,
  apm: <Activity size={19} />,
  archive: <Archive size={19} />,
  replays: <Video size={19} />,
  decks: <Layers size={19} />,
  bans: <ShieldCheck size={19} />,
  about: <Info size={19} />,
};

function Brand() {
  const { t } = useI18n();
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Crosshair size={24} strokeWidth={1.7} />
      </span>
      <div>
        <strong>{t('brand')}</strong>
        <small>BROKEN ARROW</small>
      </div>
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { state, page, setPage } = useApp(),
    { t } = useI18n();
  return (
    <nav aria-label={t('workspaceNav')}>
      {state.config.panelOrder.map((panel) => (
        <button
          key={panel}
          className={`nav-item ${page === panel ? 'active' : ''}`}
          onClick={() => {
            setPage(panel);
            onNavigate?.();
          }}
          aria-current={page === panel ? 'page' : undefined}
        >
          <span aria-hidden="true">{icons[panel]}</span>
          <span>{t(panel === 'current' ? 'overview' : panel)}</span>
        </button>
      ))}
    </nav>
  );
}

function About() {
  const { t } = useI18n(),
    { api, state, notify } = useApp();
  return (
    <Card title={t('about')} icon={icons.about} className="about-card">
      <div className="about-brand">
        <span className="brand-mark" aria-hidden="true">
          <Crosshair size={40} />
        </span>
        <h3>{t('brand')}</h3>
        <Badge>v{state.version.current}</Badge>
      </div>
      <p>{t('aboutText')}</p>
      <p className="muted">{t('companion')} · by Zola</p>
      <UpdatePanel />
      <div className="actions">
        {[
          ['BATrace', 'https://app.batrace.top/'],
          ['GitHub', 'https://github.com/JamesFlare1212/brokenarrow-log-maggot'],
        ].map(([label, url]) => (
          <Button
            key={label}
            onClick={() =>
              void api.invoke('external.open', { url: url! }).catch((e) => notify(String(e), true))
            }
          >
            {label}
            <ArrowUpRight size={15} />
          </Button>
        ))}
      </div>
    </Card>
  );
}

function ModalRouter() {
  const { modal } = useApp();
  if (!modal) return null;
  switch (modal.type) {
    case 'settings':
      return <SettingsDialog />;
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
  const { state, api, page, openModal, patchConfig, notify } = useApp(),
    { t } = useI18n();
  const [healthBusy, setHealthBusy] = useState(false),
    [navigationOpen, setNavigationOpen] = useState(false);
  const [visited, setVisited] = useState<Panel[]>([page]);
  const main = useRef<HTMLElement>(null),
    scrollPositions = useRef(new Map<Panel, number>()),
    previousPage = useRef(page);
  useEffect(() => {
    const remember = () => scrollPositions.current.set(previousPage.current, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, []);
  useLayoutEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    const scrollTop = scrollPositions.current.get(page) || 0;
    document.documentElement.scrollTop = scrollTop;
    document.body.scrollTop = scrollTop;
    main.current?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    setVisited((pages) => (pages.includes(page) ? pages : [...pages, page]));
  }, [page]);
  const components: Record<Panel, ReactNode> = {
    current: <Dashboard />,
    players: <PlayersPanel />,
    archive: <MatchArchive />,
    replays: <ReplaysPanel />,
    decks: <DecksPanel />,
    bans: <BansPanel />,
    apm: <ApmPanel />,
    about: <About />,
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
  const healthTone =
    state.health.state === 'ok'
      ? 'success'
      : state.health.state === 'partial'
        ? 'warning'
        : state.health.state === 'down'
          ? 'danger'
          : 'muted';
  const title = t(page === 'current' ? 'commandCenter' : page);
  const account = state.session.localName || t('noAccount');
  return (
    <div className="app-shell" data-ready="true">
      <a className="skip-link" href="#main-content">
        {t('skipContent')}
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="nav-section-label">{t('workspaceNav')}</div>
        <Navigation />
        <div className="sidebar-footer">
          <div className="sidebar-local">
            <HardDrive size={15} aria-hidden="true" />
            <span>{t('localData')}</span>
          </div>
          <Button
            className="settings-button"
            aria-label={t('settings')}
            onClick={() => openModal({ type: 'settings' })}
          >
            <Settings size={18} aria-hidden="true" />
            {t('settings')}
            <span className="version-label">v{state.version.current}</span>
          </Button>
          <div className="sidebar-credit">
            by Zola <span>Broken Arrow Companion</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-location">
            <Button
              className="mobile-menu"
              aria-label={t('openNavigation')}
              aria-expanded={navigationOpen}
              onClick={() => setNavigationOpen(true)}
            >
              <Menu size={20} />
            </Button>
            <Crosshair size={16} className="muted" aria-hidden="true" />
            <span>Broken Arrow</span>
            <ChevronRight size={14} className="muted" aria-hidden="true" />
            <strong>{t(page === 'current' ? 'overview' : page)}</strong>
          </div>
          <div className="topbar-actions">
            <Badge tone={healthTone}>
              <span
                className={`status-dot ${state.health.state === 'ok' ? 'status-success' : ''}`}
                aria-hidden="true"
              />
              BATrace
              <span className="sr-only">
                {' '}
                ·{' '}
                {t(
                  state.health.state === 'ok'
                    ? 'serviceConnected'
                    : state.health.state === 'down'
                      ? 'serviceDown'
                      : state.health.state === 'partial'
                        ? 'servicePartial'
                        : 'unknown',
                )}
              </span>
            </Badge>
            <div className="language-control">
              <Globe2 size={15} aria-hidden="true" />
              <select
                className="language-select"
                aria-label={t('language')}
                value={state.config.lang}
                onChange={(e) =>
                  void patchConfig({ lang: e.target.value as typeof state.config.lang })
                }
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ru">Русский</option>
              </select>
            </div>
            <button
              className="account-button"
              aria-label={`${t('currentAccount')}: ${account}`}
              onClick={() =>
                state.session.localPlayerId
                  ? openModal({ type: 'profile', id: state.session.localPlayerId, name: account })
                  : openModal({ type: 'settings' })
              }
            >
              {account.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main id="main-content" ref={main} tabIndex={-1} aria-labelledby="page-title">
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                BROKEN ARROW / {page === 'current' ? 'OVERVIEW' : page.toUpperCase()}
              </div>
              <h1 id="page-title">{title}</h1>
              <p>{t(page === 'current' ? 'overviewDescription' : `${page}Description`)}</p>
            </div>
            <div className="page-heading-status">
              <span
                className={`status-dot ${isListening ? 'status-success' : ''}`}
                aria-hidden="true"
              />
              <span title={state.watcher.file || undefined}>{status}</span>
              {new URLSearchParams(location.search).has('demo') && (
                <Badge tone="warning">{t('demo')}</Badge>
              )}
            </div>
          </div>
          {!state.config.logDir && page === 'current' && (
            <Notice>
              <span>{t('noDirectory')}</span>
              <Button onClick={() => openModal({ type: 'settings' })}>{t('select')}</Button>
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
            onClick={() => {
              setNavigationOpen(false);
              openModal({ type: 'settings' });
            }}
          >
            <Settings size={18} />
            {t('settings')}
          </Button>
        </Dialog>
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
