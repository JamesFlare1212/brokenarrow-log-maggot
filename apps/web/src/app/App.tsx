import { useState, type ReactNode } from 'react';
import {
  Activity,
  Archive,
  Home,
  Info,
  Layers,
  Search,
  Settings,
  Shield,
  Video,
} from 'lucide-react';
import type { Panel } from '@ba/contracts';
import { useApp } from './state';
import { useI18n } from '../hooks/useI18n';
import { Badge, Button, Card, Notice } from '../components/ui';
import { SessionPanel } from '../features/session/SessionPanel';
import { PlayersPanel } from '../features/players/PlayersPanel';
import { ProfileDialog } from '../features/players/ProfileDialog';
import { MatchArchive } from '../features/matches/MatchArchive';
import { MatchDialog } from '../features/matches/MatchDialog';
import { BansPanel, BanAlertDialog } from '../features/bans/BansPanel';
import { DecksPanel } from '../features/decks/DecksPanel';
import { ApmPanel } from '../features/apm/ApmPanel';
import { ReplaysPanel } from '../features/replays/ReplaysPanel';
import { RecordingSettings } from '../features/replays/RecordingSettings';
import { ReplayDialog } from '../features/replays/ReplayDialog';
import { SettingsDialog } from '../features/settings/SettingsDialog';
const icons: Record<Panel, ReactNode> = {
  current: <Home size={18} />,
  players: <Search size={18} />,
  apm: <Activity size={18} />,
  archive: <Archive size={18} />,
  replays: <Video size={18} />,
  decks: <Layers size={18} />,
  bans: <Shield size={18} />,
  about: <Info size={18} />,
};
function About() {
  const { t } = useI18n(),
    { api, state } = useApp();
  return (
    <Card title={t('about')} icon={icons.about}>
      <p>{t('aboutText')}</p>
      <p className="muted">by Zola · v{state.version.current}</p>
      <div className="actions">
        <Button
          onClick={() => void api.invoke('external.open', { url: 'https://app.batrace.top/' })}
        >
          BATrace
        </Button>
        <Button
          onClick={() =>
            void api.invoke('external.open', {
              url: 'https://github.com/Zawinzala/brokenarrow-log-maggot',
            })
          }
        >
          GitHub
        </Button>
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
  const { state, api, page, setPage, openModal, patchConfig, notify } = useApp(),
    { t } = useI18n(),
    [healthBusy, setHealthBusy] = useState(false);
  const components: Record<Panel, ReactNode> = {
    current: <SessionPanel />,
    players: <PlayersPanel />,
    archive: <MatchArchive />,
    replays: <ReplaysPanel />,
    decks: <DecksPanel />,
    bans: <BansPanel />,
    apm: <ApmPanel />,
    about: <About />,
  };
  const status = state.watcher.error
    ? state.watcher.error
    : state.watcher.recovering
      ? t('recovering')
      : state.watcher.listening
        ? t('listening')
        : t('notListening');
  return (
    <div className="app-shell" data-ready="true">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">BA</span>
          <div>
            <strong>{t('brand')}</strong>
            <small>by Zola · {state.version.current}</small>
          </div>
        </div>
        <nav aria-label={t('overview')}>
          {state.config.panelOrder.map((panel) => (
            <button
              key={panel}
              className={`nav-item ${page === panel ? 'active' : ''}`}
              onClick={() => setPage(panel)}
              aria-current={page === panel ? 'page' : undefined}
            >
              {icons[panel]}
              {t(panel === 'current' ? 'overview' : panel)}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Button onClick={() => openModal({ type: 'settings' })}>
            <Settings size={18} />
            {t('settings')}
          </Button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="status-cluster">
            <span
              className={`status-dot ${state.watcher.listening && !state.watcher.error ? 'status-success' : 'status-muted'}`}
            />
            <strong>{status}</strong>
            {state.watcher.file && (
              <span className="path" title={state.watcher.file}>
                {state.watcher.file.split(/[\\/]/).at(-1)}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <small>{t('quota', { used: state.usage.used24h, limit: state.usage.limit24h })}</small>
            <Button
              disabled={healthBusy}
              onClick={() => {
                setHealthBusy(true);
                void api
                  .invoke('api.health', { force: true })
                  .catch((e) => notify(String(e), true))
                  .finally(() => setHealthBusy(false));
              }}
            >
              <Badge
                tone={
                  state.health.state === 'ok'
                    ? 'success'
                    : state.health.state === 'partial'
                      ? 'warning'
                      : state.health.state === 'down'
                        ? 'danger'
                        : 'muted'
                }
              >
                BATrace
              </Badge>
            </Button>
            <select
              className="language-select"
              aria-label={t('language')}
              value={state.config.lang}
              onChange={(e) =>
                void patchConfig({ lang: e.target.value as typeof state.config.lang })
              }
            >
              <option value="zh">中文</option>
              <option value="en">EN</option>
              <option value="ja">日本語</option>
              <option value="ru">РУС</option>
            </select>
          </div>
        </header>
        <main id="main-content">
          {new URLSearchParams(location.search).has('demo') && <Notice>{t('demo')}</Notice>}
          {!state.config.logDir && page === 'current' && (
            <Notice>
              <span>{t('noDirectory')}</span>
              <Button onClick={() => openModal({ type: 'settings' })}>{t('settings')}</Button>
            </Notice>
          )}
          {page === 'current' ? (
            <div className="overview-grid">
              {state.config.panelOrder
                .filter((panel) => panel !== 'bans' || state.config.banCardVisible)
                .filter((panel) => panel !== 'apm' || state.config.inputHookEnabled)
                .map((panel) => (
                  <div className={`overview-panel panel-${panel}`} key={panel}>
                    {components[panel]}
                  </div>
                ))}
            </div>
          ) : (
            <div className="feature-page">{components[page]}</div>
          )}
        </main>
        <footer className="app-footer">
          <span>{t('historical')}</span>
          <small>by Zola</small>
        </footer>
      </div>
      <ModalRouter />
    </div>
  );
}
