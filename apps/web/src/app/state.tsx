import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Loading, Notice } from '../components/ui';
import { ConfirmationProvider } from '../components/Confirmation';
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
import { useAppearance } from '../hooks/useAppearance';
import { useSettingsAutosave } from '../hooks/useSettingsAutosave';
import { settingsTabFromHash, type SettingsTab } from '../features/settings/routes';
export type ModalRoute =
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
  settingsTab: SettingsTab | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  settings: ReturnType<typeof useSettingsAutosave>;
  modal: ModalRoute;
  openModal: (route: ModalRoute) => void;
  closeModal: () => void;
  backModal?: () => void;
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
      () =>
        PANELS.find((panel) => location.hash === `#${panel}`) ||
        PANELS.find((panel) => panel === history.state?.baSettingsFrom) ||
        'current',
    ),
    [settingsTab, updateSettingsTab] = useState<SettingsTab | null>(() =>
      settingsTabFromHash(location.hash),
    ),
    [modalStack, setModalStack] = useState<NonNullable<ModalRoute>[]>([]),
    [error, setError] = useState<string | null>(null);
  const [maggot, setMaggot] = useState<AppContextValue['maggot']>({
      busy: false,
      requestId: null,
      id: null,
      data: null,
      error: null,
    }),
    maggotRunning = useRef(false);
  const settings = useSettingsAutosave(api, state?.config);
  const modal = modalStack.at(-1) ?? null;
  const openModal = (route: ModalRoute) =>
    setModalStack((stack) =>
      route === null
        ? []
        : JSON.stringify(stack.at(-1)) === JSON.stringify(route)
          ? stack
          : [...stack, route],
    );
  const setPage = (next: Panel) => {
    if (location.hash !== `#${next}`) history.pushState(null, '', `#${next}`);
    updateSettingsTab(null);
    updatePage(next);
  };
  const openSettings = (tab: SettingsTab = 'appearance') => {
    const hash = `#settings/${tab}`;
    if (settingsTab) history.replaceState(history.state, '', hash);
    else history.pushState({ baSettingsFrom: page }, '', hash);
    updateSettingsTab(tab);
  };
  const closeSettings = () => {
    if (PANELS.some((panel) => panel === history.state?.baSettingsFrom)) history.back();
    else setPage(page);
  };
  useEffect(() => {
    const navigate = () => {
      const tab = settingsTabFromHash(location.hash);
      if (tab && location.hash !== `#settings/${tab}`)
        history.replaceState(history.state, '', `#settings/${tab}`);
      updateSettingsTab(tab);
      if (tab) {
        const from = PANELS.find((panel) => panel === history.state?.baSettingsFrom);
        if (from) updatePage(from);
        return;
      }
      const panel = PANELS.find((candidate) => location.hash === `#${candidate}`);
      if (panel || !location.hash) updatePage(panel || 'current');
    };
    navigate();
    window.addEventListener('hashchange', navigate);
    window.addEventListener('popstate', navigate);
    return () => {
      window.removeEventListener('hashchange', navigate);
      window.removeEventListener('popstate', navigate);
    };
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
      if (event.type === 'error') toast.error(event.message);
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
  useAppearance(settings.draft ?? state?.config);
  useEffect(() => {
    if (!state) return;
    document.documentElement.lang = state.config.lang === 'zh' ? 'zh-CN' : state.config.lang;
    document.title = translate(state.config.lang, 'brand');
  }, [state?.config.lang]);
  if (error)
    return (
      <div className="startup-error">
        <Notice error>{error}</Notice>
      </div>
    );
  if (!state)
    return (
      <div className="startup">
        <Loading />
      </div>
    );
  const notify = (message: string, error = false) => {
    if (error) toast.error(message);
    else toast.success(message);
  };
  const value: AppContextValue = {
    api,
    state,
    page,
    setPage,
    settingsTab,
    openSettings,
    closeSettings,
    settings,
    modal,
    openModal,
    closeModal: () => openModal(null),
    backModal:
      modalStack.length > 1 ? () => setModalStack((stack) => stack.slice(0, -1)) : undefined,
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
        <TooltipProvider>
          <ConfirmationProvider>{children}</ConfirmationProvider>
          <Toaster closeButton theme={(settings.draft ?? state.config).themeMode} />
        </TooltipProvider>
      </LocaleContext.Provider>
    </Context.Provider>
  );
}
