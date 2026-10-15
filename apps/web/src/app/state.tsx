import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from 'react';
import type {
  AppEvent,
  Bootstrap,
  Bridge,
  Panel,
  Player,
  PublicConfig,
  MiniInfo,
  MaggotReport,
} from '@ba/contracts';
import { LocaleContext, translate } from '../hooks/useI18n';
import { PANELS } from '@ba/contracts';
import { errorMessage } from '@ba/shared';
import { useRef } from 'react';
export type ModalRoute =
  | { type: 'settings' }
  | { type: 'profile'; id: string; name: string }
  | { type: 'match'; fid: string }
  | { type: 'recordingSettings'; enable?: boolean }
  | { type: 'replay'; id: string; title: string }
  | { type: 'banAlert'; players: import('@ba/contracts').Ban[] }
  | null;
export interface RosterResult {
  player: Player;
  info: MiniInfo | null;
  error: string | null;
}
export interface AppState extends Bootstrap {
  rosters: {
    current: { requestId: string; rows: Record<string, RosterResult> };
    previous: { requestId: string; rows: Record<string, RosterResult> };
  };
  preview: { sessionId: string; dataUrl: string; hasAudio: boolean } | null;
  matchesRevision: number;
  replaysRevision: number;
  decksRevision: number;
  bansRevision: number;
  maggotProgress: {
    requestId: string;
    id: string;
    done: number;
    scanned: number;
    total: number;
  } | null;
}
type Action = { type: 'bootstrap'; bootstrap: Bootstrap } | { type: 'event'; event: AppEvent };
export function reduce(state: AppState | null, action: Action): AppState | null {
  if (action.type === 'bootstrap')
    return {
      ...action.bootstrap,
      rosters: { current: { requestId: '', rows: {} }, previous: { requestId: '', rows: {} } },
      preview: null,
      matchesRevision: 0,
      replaysRevision: 0,
      decksRevision: 0,
      bansRevision: 0,
      maggotProgress: null,
    };
  if (!state || action.event.revision <= state.revision) return state;
  const e = action.event,
    next = { ...state, revision: e.revision };
  switch (e.type) {
    case 'updates':
      return { ...next, updates: e.updates };
    case 'config':
      return { ...next, config: e.config };
    case 'session':
      return { ...next, session: e.session };
    case 'watcher':
      return { ...next, watcher: e.watcher };
    case 'usage':
      return { ...next, usage: e.usage };
    case 'health':
      return { ...next, health: e.health };
    case 'apm':
      return { ...next, apm: e.apm };
    case 'recording':
      return {
        ...next,
        recording: e.recording,
        preview: e.recording.phase === 'recording' ? next.preview : null,
      };
    case 'preview':
      return next.recording.phase === 'recording' && e.sessionId === next.recording.sessionId
        ? { ...next, preview: e }
        : next;
    case 'matches':
      return { ...next, matchesRevision: next.matchesRevision + 1 };
    case 'replays':
      return { ...next, replaysRevision: next.replaysRevision + 1 };
    case 'decks':
      return { ...next, deckAlert: e.alert, decksRevision: next.decksRevision + 1 };
    case 'bans':
      return { ...next, bansRevision: next.bansRevision + 1 };
    case 'maggot':
      return { ...next, maggotProgress: e };
    case 'roster': {
      if (e.context === 'current' && e.generation !== next.session.generation) return next;
      const old = next.rosters[e.context],
        rows = old.requestId === e.requestId ? old.rows : {};
      return {
        ...next,
        rosters: {
          ...next.rosters,
          [e.context]: {
            requestId: e.requestId,
            rows: { ...rows, [e.player.id]: { player: e.player, info: e.info, error: e.error } },
          },
        },
      };
    }
    default:
      return next;
  }
}
interface AppContextValue {
  api: Bridge;
  state: AppState;
  page: Panel;
  setPage: (page: Panel) => void;
  modal: ModalRoute;
  openModal: (route: ModalRoute) => void;
  closeModal: () => void;
  patchConfig: (patch: Partial<PublicConfig>) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  maggot: {
    busy: boolean;
    requestId: string | null;
    id: string | null;
    data: MaggotReport | null;
    error: string | null;
  };
  runMaggot: (id: string) => Promise<void>;
}
const Context = createContext<AppContextValue | null>(null);
export function useApp(): AppContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('App provider missing');
  return value;
}
export function AppProvider({ api, children }: { api: Bridge; children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, null),
    [page, updatePage] = useState<Panel>(
      () => PANELS.find((panel) => location.hash === `#${panel}`) || 'current',
    ),
    [modal, openModal] = useState<ModalRoute>(null),
    [error, setError] = useState<string | null>(null),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [maggot, setMaggot] = useState<AppContextValue['maggot']>({
      busy: false,
      requestId: null,
      id: null,
      data: null,
      error: null,
    }),
    maggotRunning = useRef(false);
  const setPage = (next: Panel) => {
    if (location.hash !== `#${next}`) location.hash = next;
    updatePage(next);
  };
  useEffect(() => {
    const navigate = () => {
      const panel = PANELS.find((candidate) => location.hash === `#${candidate}`);
      if (panel || !location.hash) updatePage(panel || 'current');
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    let active = true,
      ready = false,
      acceptedRevision = -1;
    const buffered: AppEvent[] = [];
    const handle = (event: AppEvent) => {
      if (event.revision <= acceptedRevision) return;
      acceptedRevision = event.revision;
      dispatch({ type: 'event', event });
      if (event.type === 'bans' && event.newly.length)
        openModal({ type: 'banAlert', players: event.newly });
      if (event.type === 'error') setToast({ message: event.message, error: true });
    };
    const unsubscribe = api.subscribe((event) => {
      if (!active) return;
      if (!ready) buffered.push(event);
      else handle(event);
    });
    void api
      .invoke('app.bootstrap', null)
      .then((bootstrap) => {
        if (!active) return;
        dispatch({ type: 'bootstrap', bootstrap });
        acceptedRevision = bootstrap.revision;
        ready = true;
        for (const event of buffered.sort((a, b) => a.revision - b.revision))
          if (event.revision > bootstrap.revision) handle(event);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.config.theme;
    document.documentElement.lang = state.config.lang === 'zh' ? 'zh-CN' : state.config.lang;
    document.title = translate(state.config.lang, 'brand') + ' by Zola';
  }, [state?.config.theme, state?.config.lang]);
  if (error)
    return (
      <div className="startup-error" role="alert">
        {error}
      </div>
    );
  if (!state) return <div className="startup">Loading…</div>;
  const notify = (message: string, error = false) => setToast({ message, error });
  const value: AppContextValue = {
    api,
    state,
    page,
    setPage,
    modal,
    openModal,
    closeModal: () => openModal(null),
    patchConfig: async (patch) => {
      try {
        await api.invoke('config.update', patch);
      } catch (e) {
        notify(errorMessage(e), true);
        throw e;
      }
    },
    notify,
    maggot,
    runMaggot: async (id) => {
      if (maggotRunning.current) return;
      maggotRunning.current = true;
      const requestId = crypto.randomUUID();
      setMaggot({ busy: true, requestId, id, data: null, error: null });
      try {
        const data = await api.invoke('players.maggot', { id, requestId });
        setMaggot({ busy: false, requestId, id, data, error: null });
      } catch (e) {
        setMaggot({ busy: false, requestId, id, data: null, error: errorMessage(e) });
      } finally {
        maggotRunning.current = false;
      }
    },
  };
  return (
    <Context.Provider value={value}>
      <LocaleContext.Provider value={state.config.lang}>
        {children}
        {toast && (
          <div
            className={`toast ${toast.error ? 'toast-error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >
            {toast.message}
            <button
              aria-label={translate(state.config.lang, 'close')}
              onClick={() => setToast(null)}
            >
              ×
            </button>
          </div>
        )}
      </LocaleContext.Provider>
    </Context.Provider>
  );
}
