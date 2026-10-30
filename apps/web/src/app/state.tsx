import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Loading, Notice } from '../components/ui';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { ConfirmationProvider } from '../components/Confirmation';
import type {
  AppEvent,
  Bootstrap,
  Bridge,
  Panel,
  PublicConfig,
  RosterQueries,
  Account,
} from '@ba/contracts';
import { LocaleContext, translate } from '../hooks/useI18n';
import { PANELS, hasAnalyticsChoice } from '@ba/contracts';
import { OverlayActivityContext } from '../components/overlay-activity';
import { BanAlertsContext, useBanAlertAcknowledgements } from '../features/bans/ban-alerts-context';
import {
  errorMessage,
  currentRosterKey,
  emptyRosterQueries,
  updateRosterQueries,
} from '@ba/shared';
import { useMaggotRequests } from '../hooks/useMaggotRequests';
import { usePlayerReports } from '../hooks/usePlayerReports';
import { useHealthCheck } from '../hooks/useHealthCheck';
import { useUpdateActions } from '../hooks/useUpdateActions';
import { useCacheManagement } from '../hooks/useCacheManagement';
import { useAppearance } from '../hooks/useAppearance';
import {
  useSettingsAutosave,
  combineSettingsStatuses,
  type SettingsSaveStatus,
} from '../hooks/useSettingsAutosave';
import { useRecordingPreference } from '../features/replays/useRecordingPreference';
import { useRecordingSettingsState } from '../features/replays/useRecordingSettingsState';
import { useLogMonitoring } from '../hooks/useLogMonitoring';
import { useBanSynchronization } from '../features/bans/useBanSynchronization';
import { settingsTabFromHash, type SettingsTab } from '../features/settings/routes';
import { captureDialogReturn, type DialogReturnState } from '../components/dialog-navigation';
export type ModalRoute =
  | ((
      | { type: 'profile'; id: string; name: string; tab?: string }
      | { type: 'match'; fid: string; accountId?: string | null }
      | { type: 'recordingSettings' }
      | { type: 'historyRecovery' }
      | { type: 'replay'; id: string; title: string }
      | { type: 'banAlert'; batchId: string; players: import('@ba/contracts').Ban[] }
    ) & { returnState?: DialogReturnState })
  | null;
export interface AppState extends Bootstrap {
  configRevision: number;
  rosters: RosterQueries;
  preview: { sessionId: string; dataUrl: string; hasAudio: boolean } | null;
  matchesRevision: number;
  replaysRevision: number;
  decksRevision: number;
  bansRevision: number;
  accountsSnapshot: Account[] | null;
  accountsRevision: number;
  accountContextRevision: number;
  accountContextKey: string;
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
      rosters: updateRosterQueries(action.bootstrap.rosters ?? emptyRosterQueries(), {
        type: 'session',
        session: action.bootstrap.session,
        revision: action.bootstrap.revision,
      }),
      preview: null,
      matchesRevision: 0,
      replaysRevision: 0,
      decksRevision: 0,
      bansRevision: 0,
      configRevision: action.bootstrap.revision,
      accountsSnapshot: null,
      accountsRevision: 0,
      accountContextRevision: 0,
      accountContextKey: '',
      maggotProgress: null,
    };
  if (!state || action.event.revision <= state.revision) return state;
  const e = action.event,
    next = { ...state, revision: e.revision };
  switch (e.type) {
    case 'accounts': {
      const key = JSON.stringify([
        e.activeAccountId,
        e.list.map(({ id, name, persona }) => [id, name, persona]).sort(),
      ]);
      return {
        ...next,
        accountsSnapshot: e.list,
        accountsRevision: next.accountsRevision + 1,
        accountContextRevision:
          next.accountContextRevision + Number(key !== next.accountContextKey),
        accountContextKey: key,
      };
    }
    case 'updates':
      return { ...next, updates: e.updates };
    case 'config':
      return { ...next, config: e.config, configRevision: e.revision };
    case 'session':
      return { ...next, session: e.session, rosters: updateRosterQueries(next.rosters, e) };
    case 'watcher':
      return { ...next, watcher: e.watcher };
    case 'health':
      return { ...next, health: e.health };
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
      return { ...next, banAlerts: e.alerts, bansRevision: next.bansRevision + 1 };
    case 'banAlerts':
      return { ...next, banAlerts: e.alerts };
    case 'banSync':
      return { ...next, banSync: e.status };
    case 'maggot':
      return { ...next, maggotProgress: e };
    case 'rosterQuery':
    case 'rosterRetry':
    case 'roster':
      if (e.context === 'current' && e.sourceKey !== currentRosterKey(next.session)) return next;
      return { ...next, rosters: updateRosterQueries(next.rosters, e) };
    default:
      return next;
  }
}
interface AppContextValue {
  api: Bridge;
  state: AppState;
  updater: ReturnType<typeof useUpdateActions>;
  page: Panel;
  setPage: (page: Panel) => void;
  settingsTab: SettingsTab | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  settings: ReturnType<typeof useSettingsAutosave>;
  recordingSettings: ReturnType<typeof useRecordingSettingsState>;
  monitoring: ReturnType<typeof useLogMonitoring>;
  banSynchronization: ReturnType<typeof useBanSynchronization>;
  settingsStatus: SettingsSaveStatus;
  flushSettings: () => Promise<boolean>;
  flushPendingSettings: () => Promise<void>;
  discardSettings: () => Promise<void>;
  modal: ModalRoute;
  openModal: (route: ModalRoute) => void;
  closeModal: () => void;
  backModal?: () => void;
  setMatchAccount?: (accountId: string | null) => void;
  setProfileTab?: (tab: string) => void;
  patchConfig: (patch: Partial<PublicConfig>) => Promise<void>;
  recordingPreference: ReturnType<typeof useRecordingPreference>;
  notify: (message: string, error?: boolean) => void;
  maggot: ReturnType<typeof useMaggotRequests>['maggot'];
  runMaggot: ReturnType<typeof useMaggotRequests>['runMaggot'];
  reports: ReturnType<typeof usePlayerReports>['reports'];
  loadReport: ReturnType<typeof usePlayerReports>['loadReport'];
  healthCheck: ReturnType<typeof useHealthCheck>;
  cache: ReturnType<typeof useCacheManagement>;
}
const Context = createContext<AppContextValue | null>(null);
function notify(message: string, error = false) {
  if (error) toast.error(message);
  else toast.success(message);
}
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
    [error, setError] = useState<string | null>(null),
    [bootstrapAttempt, setBootstrapAttempt] = useState(0),
    [initializing, setInitializing] = useState(true);
  const bootstrapRunning = useRef(true);
  const startupRetry = useRef<HTMLButtonElement>(null);
  const startupOwnedFocus = useRef(false);
  const overlays = useRef(new Set<object>());
  const [overlayVersion, setOverlayVersion] = useState(0);
  const registerOverlay = useCallback((token: object) => {
    overlays.current.add(token);
    setOverlayVersion((version) => version + 1);
    return () => {
      overlays.current.delete(token);
      setOverlayVersion((version) => version + 1);
    };
  }, []);
  const banAcknowledgements = useBanAlertAcknowledgements(api, state?.banAlerts);
  const { maggot, runMaggot } = useMaggotRequests(api);
  const { reports, loadReport } = usePlayerReports(api);
  const probeHealth = useCallback(() => api.invoke('api.health', { force: true }), [api]);
  const healthCheck = useHealthCheck(state?.health, probeHealth);
  const cache = useCacheManagement(api);
  const updater = useUpdateActions(api, state?.updates, state?.config.lang ?? 'zh');
  const settings = useSettingsAutosave(api, state?.config, undefined, state?.configRevision);
  const recordingPreference = useRecordingPreference(api);
  const recordingSettings = useRecordingSettingsState(api, state?.config, state?.configRevision);
  const monitoring = useLogMonitoring(api, state?.watcher);
  const banSynchronization = useBanSynchronization(api, state?.banSync);
  const settingsStatus = combineSettingsStatuses(
    settings.status,
    recordingSettings.status,
    recordingPreference.pending ? 'saving' : recordingPreference.failure ? 'error' : 'saved',
  );
  const flushSettings = useCallback(async () => {
    const results = await Promise.all([
      settings.flush(),
      recordingSettings.flush(),
      recordingPreference.flush(),
    ]);
    return results.every(Boolean);
  }, [settings.flush, recordingSettings.flush, recordingPreference.flush]);
  const discardSettings = useCallback(async () => {
    await Promise.all([
      settings.discard(),
      recordingSettings.discard(),
      recordingPreference.settle(),
    ]);
    recordingPreference.discard();
  }, [
    settings.discard,
    recordingSettings.discard,
    recordingPreference.settle,
    recordingPreference.discard,
  ]);
  const flushPendingSettings = useCallback(async () => {
    await Promise.all([
      settings.flushPending(),
      recordingSettings.flushPending(),
      recordingPreference.settle(),
    ]);
  }, [settings.flushPending, recordingSettings.flushPending, recordingPreference.settle]);
  const modal = modalStack.at(-1) ?? null;
  const openModal = useCallback((route: ModalRoute) => {
    const returnState = route && captureDialogReturn();
    setModalStack((stack) =>
      route === null
        ? []
        : JSON.stringify(stack.at(-1)) === JSON.stringify(route)
          ? stack
          : [
              ...stack.map((parent, index) =>
                index === stack.length - 1 && returnState ? { ...parent, returnState } : parent,
              ),
              route,
            ],
    );
  }, []);
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
    bootstrapRunning.current = true;
    setInitializing(true);
    let active = true,
      ready = false,
      acceptedRevision = -1;
    const buffered: AppEvent[] = [];
    const handle = (event: AppEvent) => {
      if (event.revision <= acceptedRevision) return;
      acceptedRevision = event.revision;
      dispatch({ type: 'event', event });
      if (event.type === 'error') toast.error(event.message);
    };
    let unsubscribe: (() => void) | null = null;
    const release = () => {
      const close = unsubscribe;
      unsubscribe = null;
      close?.();
    };
    const fail = (value: unknown) => {
      if (!active) return;
      buffered.length = 0;
      release();
      setError(errorMessage(value));
    };
    try {
      unsubscribe = api.subscribe((event) => {
        if (!active) return;
        if (!ready) buffered.push(event);
        else handle(event);
      });
    } catch (value) {
      fail(value);
      bootstrapRunning.current = false;
      setInitializing(false);
      return () => {
        active = false;
        release();
      };
    }
    let initialization: Promise<Bootstrap>;
    try {
      initialization = api.invoke('app.bootstrap', null);
    } catch (value) {
      initialization = Promise.reject(value);
    }
    void initialization
      .then((bootstrap) => {
        if (!active) return;
        startupOwnedFocus.current =
          document.activeElement === startupRetry.current && document.hasFocus();
        setError(null);
        dispatch({ type: 'bootstrap', bootstrap });
        acceptedRevision = bootstrap.revision;
        ready = true;
        for (const event of buffered.sort((a, b) => a.revision - b.revision))
          if (event.revision > bootstrap.revision) handle(event);
      })
      .catch(fail)
      .finally(() => {
        if (!active) return;
        bootstrapRunning.current = false;
        setInitializing(false);
      });
    return () => {
      active = false;
      release();
    };
  }, [api, bootstrapAttempt]);
  useLayoutEffect(() => {
    if (!state || initializing || error || !startupOwnedFocus.current) return;
    startupOwnedFocus.current = false;
    if (
      document.activeElement === document.body ||
      document.activeElement === document.documentElement
    )
      document
        .getElementById(settingsTab ? 'settings-content' : 'main-content')
        ?.focus({ preventScroll: true });
  }, [state, initializing, error, settingsTab]);
  useEffect(() => {
    const oldest = state?.banAlerts[0];
    if (
      !oldest ||
      !hasAnalyticsChoice(state.config) ||
      modalStack.length ||
      settingsTab ||
      overlays.current.size
    )
      return;
    setModalStack((stack) =>
      stack.length ? stack : [{ type: 'banAlert', batchId: oldest.id, players: oldest.players }],
    );
  }, [state?.banAlerts, state?.config, modalStack, settingsTab, overlayVersion]);
  useAppearance(settings.draft ?? state?.config);
  const startupLocale =
    state?.config.lang ?? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
  useEffect(() => {
    document.documentElement.lang = startupLocale === 'zh' ? 'zh-CN' : startupLocale;
    document.title = translate(startupLocale, 'brand');
  }, [startupLocale]);
  const startupText = (key: string) => translate(startupLocale, key);
  if (error || (bootstrapAttempt > 0 && initializing))
    return (
      <main className="startup-error" aria-labelledby="startup-recovery-title">
        <Card className="startup-recovery">
          <CardHeader>
            <p className="text-sm text-muted-foreground">{startupText('brand')}</p>
            <CardTitle>
              <h1 id="startup-recovery-title" className="text-lg">
                {startupText('startupFailure')}
              </h1>
            </CardTitle>
            <CardDescription>{startupText('startupFailureHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-3">
            <Button
              ref={startupRetry}
              aria-disabled={initializing}
              aria-busy={initializing}
              className="w-fit max-w-full whitespace-normal"
              onClick={() => {
                if (bootstrapRunning.current) return;
                bootstrapRunning.current = true;
                setInitializing(true);
                setBootstrapAttempt((attempt) => attempt + 1);
              }}
            >
              {initializing && <Spinner aria-hidden="true" />}
              {startupText('startupRetry')}
            </Button>
            {initializing && (
              <p role="status" className="text-sm text-muted-foreground wrap-anywhere">
                {startupText('startupRetrying')}
              </p>
            )}
            {error && (
              <Notice error>
                <span className="wrap-anywhere">
                  {initializing && (
                    <span className="block">{startupText('startupPreviousFailure')}</span>
                  )}
                  {error}
                </span>
              </Notice>
            )}
          </CardContent>
        </Card>
      </main>
    );
  if (!state)
    return (
      <div className="startup">
        <LocaleContext.Provider value={startupLocale}>
          <Loading />
        </LocaleContext.Provider>
      </div>
    );
  const value: AppContextValue = {
    api,
    state,
    updater,
    page,
    setPage,
    settingsTab,
    openSettings,
    closeSettings,
    settings,
    recordingSettings,
    monitoring,
    banSynchronization,
    settingsStatus,
    flushSettings,
    flushPendingSettings,
    discardSettings,
    recordingPreference,
    modal,
    openModal,
    setMatchAccount: (accountId) =>
      setModalStack((stack) =>
        stack.map((route, index) =>
          index === stack.length - 1 && route.type === 'match' ? { ...route, accountId } : route,
        ),
      ),
    setProfileTab: (tab) =>
      setModalStack((stack) =>
        stack.map((route, index) =>
          index === stack.length - 1 && route.type === 'profile' ? { ...route, tab } : route,
        ),
      ),
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
    runMaggot,
    reports,
    loadReport,
    healthCheck,
    cache,
  };
  return (
    <OverlayActivityContext.Provider value={registerOverlay}>
      <BanAlertsContext.Provider
        value={{
          alerts: state.banAlerts,
          activeIds: modalStack
            .filter((route) => route.type === 'banAlert')
            .map((route) => route.batchId),
          available: hasAnalyticsChoice(state.config),
          ...banAcknowledgements,
        }}
      >
        <Context.Provider value={value}>
          <LocaleContext.Provider value={state.config.lang}>
            <TooltipProvider>
              <ConfirmationProvider>{children}</ConfirmationProvider>
              <Toaster closeButton theme={(settings.draft ?? state.config).themeMode} />
            </TooltipProvider>
          </LocaleContext.Provider>
        </Context.Provider>
      </BanAlertsContext.Provider>
    </OverlayActivityContext.Provider>
  );
}
