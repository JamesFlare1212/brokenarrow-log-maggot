import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical, GripVertical, RefreshCw, Users, Video, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import toolStyles from './tools.css?inline';
import { useDevelopmentLayer, useDevelopmentTheme, useToolPosition } from './layer';
import { errorMessage } from '@ba/shared';
import type { Bridge } from '@ba/contracts';
import { App } from '../app/App';
import { AppProvider } from '../app/state';
import { translate } from '../hooks/useI18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  createDevelopmentRuntime,
  developmentLobbyPlayerCounts,
  type DevelopmentLobbyPlayerCount,
  type DevelopmentRuntime,
  type DevelopmentSnapshot,
  type DevelopmentMode,
  type DevelopmentRecording,
} from './runtime';

function DevelopmentTools({
  runtime,
  snapshot,
}: {
  runtime: DevelopmentRuntime;
  snapshot: DevelopmentSnapshot;
}) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [focusVersion, setFocusVersion] = useState(0);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const applicationFocus = useRef<HTMLElement | null>(null);
  const dismissing = useRef(false);
  const escape = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  const layer = useDevelopmentLayer(escape),
    theme = useDevelopmentTheme();
  const { dock, position, handle } = useToolPosition(layer);
  const t = (key: string) => translate(snapshot.locale, key);
  const changeMode = (mode: DevelopmentMode) => {
    const active = layer?.activeElement;
    pendingFocus.current = active instanceof HTMLElement ? active : null;
    setError(null);
    void runtime.controls
      .setMode(mode)
      .catch((value) =>
        setError(
          translate(snapshot.locale, 'devSceneChangeFailed', {
            scene: t('devMode.' + mode),
            error: errorMessage(value),
          }),
        ),
      )
      .finally(() => setFocusVersion((version) => version + 1));
  };
  useLayoutEffect(() => {
    if (snapshot.pending) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (!open || !target?.isConnected || target.matches(':disabled')) return;
    const active = layer?.activeElement ?? document.activeElement;
    if (active === target || active === document.body || active === layer?.host) {
      const committed =
        target.getAttribute('role') === 'radio' && target.getAttribute('aria-checked') !== 'true'
          ? (target
              .closest('[role=radiogroup]')
              ?.querySelector<HTMLElement>('[role=radio][aria-checked=true]') ?? target)
          : target;
      committed.focus({ preventScroll: true });
      committed.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  }, [snapshot.pending, snapshot.generation, focusVersion, open, layer]);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target !== document.body && target !== layer?.host)
        applicationFocus.current = target;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, [layer]);
  const hide = () => {
    dismissing.current = true;
    pendingFocus.current = null;
    setOpen(false);
    setHidden(true);
    const target = [
      applicationFocus.current,
      ...document.querySelectorAll<HTMLElement>('#settings-content,#main-content'),
    ].find(
      (element) =>
        element?.isConnected &&
        !element.closest('[hidden],[inert],[aria-hidden=true]') &&
        !element.matches(':disabled'),
    );
    target?.focus({ preventScroll: true });
  };
  const local = snapshot.mode !== 'captured';
  if (!layer || hidden) return null;
  return createPortal(
    <>
      <style>{toolStyles}</style>
      <div
        ref={setContainer}
        className={cn('development-tools-theme', theme.dark && 'dark')}
        style={theme.style}
      >
        <div
          ref={dock}
          className="development-tools"
          style={{ left: position.x, top: position.y }}
          data-dev-tools
        >
          <Popover open={open} onOpenChange={setOpen}>
            <div className="development-tools-launcher">
              <Button
                variant="ghost"
                size="icon"
                className="development-tools-handle"
                aria-label={t('devMoveTools')}
                aria-describedby="development-move-hint"
                {...handle}
              >
                <GripVertical aria-hidden="true" />
              </Button>
              <span className="sr-only" id="development-move-hint">
                {t('devMoveToolsHint')}
              </span>
              <PopoverTrigger asChild>
                <Button
                  ref={trigger}
                  variant="ghost"
                  aria-label={t('devTools')}
                  title={t('devTools')}
                >
                  <FlaskConical data-icon="inline-start" aria-hidden="true" />
                  <Badge variant="secondary">DEV</Badge>
                </Button>
              </PopoverTrigger>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('devHideTools')}
                aria-describedby="development-hide-hint"
                title={t('devHideToolsHint')}
                onClick={hide}
              >
                <X aria-hidden="true" />
              </Button>
              <span className="sr-only" id="development-hide-hint">
                {t('devHideToolsHint')}
              </span>
            </div>
            <PopoverContent
              align="end"
              side="top"
              container={container}
              updatePositionStrategy="always"
              aria-labelledby="development-tools-title"
              className="development-tools-panel w-80 max-w-[calc(100vw-2rem)]"
              onCloseAutoFocus={(event) => {
                if (dismissing.current) event.preventDefault();
              }}
            >
              <PopoverHeader>
                <PopoverTitle id="development-tools-title">{t('devTools')}</PopoverTitle>
                <PopoverDescription>{t('devToolsHint')}</PopoverDescription>
              </PopoverHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel id="development-scene-label">{t('devScene')}</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    className="grid w-full grid-cols-3"
                    aria-labelledby="development-scene-label"
                    value={snapshot.mode}
                    disabled={snapshot.pending}
                    onValueChange={(value) => {
                      if (value) changeMode(value as DevelopmentMode);
                    }}
                  >
                    {(['captured', 'empty', 'demo'] as const).map((mode) => (
                      <ToggleGroupItem value={mode} key={mode}>
                        {t('devMode.' + mode)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription role="status">
                    {t(snapshot.pending ? 'loading' : 'devModeHint.' + snapshot.mode)}
                  </FieldDescription>
                </Field>
                <Field data-disabled={snapshot.mode !== 'demo' || snapshot.pending}>
                  <FieldLabel id="development-lobby-label">
                    <Users aria-hidden="true" />
                    {t('devLobbyPlayers')}
                  </FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    className="grid w-full grid-cols-6"
                    spacing={1}
                    aria-labelledby="development-lobby-label"
                    aria-describedby="development-lobby-hint"
                    value={
                      snapshot.lobbyPlayerCount === null
                        ? 'match'
                        : String(snapshot.lobbyPlayerCount)
                    }
                    disabled={snapshot.mode !== 'demo' || snapshot.pending}
                    onValueChange={(value) => {
                      if (value)
                        runtime.controls.setLobbyPlayerCount(
                          value === 'match' ? null : (Number(value) as DevelopmentLobbyPlayerCount),
                        );
                    }}
                  >
                    <ToggleGroupItem value="match">5v5</ToggleGroupItem>
                    {developmentLobbyPlayerCounts.map((count) => (
                      <ToggleGroupItem value={String(count)} key={count}>
                        {count}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription id="development-lobby-hint">
                    {t('devLobbyPlayersHint')}
                  </FieldDescription>
                </Field>
                <Field data-disabled={!local || snapshot.pending}>
                  <FieldLabel htmlFor="development-recording">
                    <Video aria-hidden="true" />
                    {t('devRecording')}
                  </FieldLabel>
                  <NativeSelect
                    id="development-recording"
                    className="w-full"
                    value={snapshot.recording}
                    disabled={!local || snapshot.pending}
                    onChange={(event) =>
                      runtime.controls.setRecording(event.target.value as DevelopmentRecording)
                    }
                  >
                    {(['idle', 'recording', 'error'] as const).map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {t('devRecording.' + value)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Button
                  variant="outline"
                  disabled={snapshot.pending}
                  aria-busy={snapshot.pending}
                  onClick={() => changeMode(snapshot.mode)}
                >
                  <RefreshCw data-icon="inline-start" aria-hidden="true" />
                  {t('devReset')}
                </Button>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </FieldGroup>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </>,
    layer,
  );
}

function DevelopmentWorkspace() {
  useLayoutEffect(() => {
    if (document.activeElement !== document.body) return;
    const main = [
      ...document.querySelectorAll<HTMLElement>('#settings-content,#main-content'),
    ].find((element) => !element.closest('[hidden],[inert],[aria-hidden=true]'));
    main?.focus({ preventScroll: true });
  }, []);
  return <App />;
}

export function DevelopmentApp({ api }: { api: Bridge }) {
  const [runtime] = useState(() => createDevelopmentRuntime(api));
  const snapshot = useSyncExternalStore(runtime.controls.subscribe, runtime.controls.getSnapshot);
  useEffect(() => () => runtime.dispose(), [runtime]);
  return (
    <>
      <AppProvider key={snapshot.generation} api={runtime.api}>
        <DevelopmentWorkspace />
      </AppProvider>
      <DevelopmentTools runtime={runtime} snapshot={snapshot} />
    </>
  );
}
