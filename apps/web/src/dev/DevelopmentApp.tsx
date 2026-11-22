import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical, GripVertical, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { glassOverlaySurfaceClasses } from '@/lib/surfaces';
import toolStyles from './tools.css?inline';
import { useDevelopmentLayer, useDevelopmentTheme, useToolPosition } from './layer';
import { errorMessage } from '@ba/shared';
import type { Bridge } from '@ba/contracts';
import { App } from '../app/App';
import { AppProvider } from '../app/state';
import { archiveMatchFromHash } from '../features/matches/routes';
import { translate } from '../hooks/useI18n';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverAnchor, PopoverTrigger } from '@/components/ui/popover';
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

import { LoadingPreviewContext } from '../hooks/useLoadingPreview';

function DevelopmentTools({
  runtime,
  snapshot,
  loadingPreview,
  setLoadingPreview,
}: {
  loadingPreview: boolean;
  setLoadingPreview: (value: boolean) => void;
  runtime: DevelopmentRuntime;
  snapshot: DevelopmentSnapshot;
}) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const escape = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  const layer = useDevelopmentLayer(escape),
    theme = useDevelopmentTheme();
  const { dock, position, handle } = useToolPosition(layer?.root ?? null);
  const t = (key: string) => translate(snapshot.locale, key);
  const changeMode = (mode: DevelopmentMode) => {
    setError(null);
    void runtime.controls.setMode(mode).catch((value) => setError(errorMessage(value)));
  };
  const local = snapshot.mode !== 'captured';
  if (!layer) return null;
  return createPortal(
    <>
      <style>{toolStyles}</style>
      <div
        ref={setContainer}
        className={cn(
          'development-tools-theme [font-family:var(--font-sans)] text-[14px] leading-[1.5] text-foreground pointer-events-none',
          theme.dark && 'dark',
        )}
        style={theme.style}
      >
        <div
          ref={dock}
          className="development-tools fixed w-max pointer-events-auto"
          style={{ left: position.x, top: position.y }}
          data-dev-tools
        >
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
              <div
                className={cn(
                  'development-tools-launcher flex items-center gap-1 p-1 border border-transparent',
                  glassOverlaySurfaceClasses,
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="development-tools-handle touch-none cursor-grab [&:active]:cursor-grabbing"
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
                  <Button ref={trigger} variant="ghost" aria-label={t('devTools')}>
                    <FlaskConical data-icon="inline-start" aria-hidden="true" />
                    <span>{t('devTools')}</span>
                    <Badge variant="secondary">DEV</Badge>
                  </Button>
                </PopoverTrigger>
              </div>
            </PopoverAnchor>
            <PopoverContent
              align={
                position.x + (dock.current?.offsetWidth ?? 0) / 2 < innerWidth / 2 ? 'start' : 'end'
              }
              side="top"
              sideOffset={8}
              collisionPadding={8}
              container={container}
              updatePositionStrategy="always"
              aria-label={t('devTools')}
              className="development-tools-panel pointer-events-auto w-80 max-w-[calc(100dvw-1rem)] max-h-(--radix-popover-content-available-height) gap-4 overflow-x-hidden overflow-y-auto overscroll-contain p-4"
            >
              <FieldGroup className="gap-4">
                <Field>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel id="development-scene-label">{t('devScene')}</FieldLabel>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('devReset')}
                      disabled={snapshot.pending}
                      aria-busy={snapshot.pending}
                      onClick={() => changeMode(snapshot.mode)}
                    >
                      <RefreshCw data-icon="inline-start" aria-hidden="true" />
                      {t('devResetShort')}
                    </Button>
                  </div>
                  <ToggleGroup
                    type="single"
                    variant="filter"
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
                <Field data-disabled={!snapshot.hasLobbyRoster || snapshot.pending}>
                  <FieldLabel id="development-lobby-label">{t('devLobbyPlayers')}</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    className="grid w-full grid-cols-6"
                    spacing={1}
                    aria-labelledby="development-lobby-label"
                    aria-description={t('devLobbyPlayersHint')}
                    value={
                      snapshot.lobbyPlayerCount === null
                        ? 'match'
                        : String(snapshot.lobbyPlayerCount)
                    }
                    disabled={!snapshot.hasLobbyRoster || snapshot.pending}
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
                </Field>
                <Separator />
                <Field orientation="horizontal" data-disabled={!local || snapshot.pending}>
                  <FieldLabel htmlFor="development-recording">{t('devRecording')}</FieldLabel>
                  <Select
                    value={snapshot.recording}
                    disabled={!local || snapshot.pending}
                    onValueChange={(value) =>
                      runtime.controls.setRecording(value as DevelopmentRecording)
                    }
                  >
                    <SelectTrigger id="development-recording" className="max-w-[60%]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent container={layer.selectPortal}>
                      <SelectGroup>
                        {(['idle', 'recording', 'error'] as const).map((value) => (
                          <SelectItem key={value} value={value}>
                            {t('devRecording.' + value)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="development-cache-expired">{t('devCacheExpiry')}</FieldLabel>
                  <Switch
                    id="development-cache-expired"
                    checked={snapshot.cacheExpiryEnabled}
                    disabled={snapshot.pending}
                    onCheckedChange={runtime.controls.setCacheExpiryEnabled}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="development-loading">{t('devLoadingState')}</FieldLabel>
                  <Switch
                    id="development-loading"
                    checked={loadingPreview}
                    onCheckedChange={setLoadingPreview}
                  />
                </Field>
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
      <slot name="select-content" />
    </>,
    layer.root,
  );
}

export function DevelopmentApp({ api, desktop = false }: { api: Bridge; desktop?: boolean }) {
  const [loadingPreview, setLoadingPreview] = useState(false);
  const runtime = useMemo(() => createDevelopmentRuntime(api), [api]);
  const snapshot = useSyncExternalStore(runtime.controls.subscribe, runtime.controls.getSnapshot);
  useEffect(() => () => runtime.dispose(), [runtime]);
  useEffect(() => {
    if (snapshot.mode === 'empty' && archiveMatchFromHash(location.hash)) {
      history.replaceState(null, '', '#archive');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [snapshot.mode, snapshot.generation]);
  return (
    <>
      <AppProvider
        key={snapshot.generation}
        api={runtime.api}
        bootstrapApi={runtime.bootstrapApi}
        access={desktop && snapshot.mode === 'captured' ? undefined : runtime.access}
      >
        <LoadingPreviewContext value={loadingPreview}>
          <App />
        </LoadingPreviewContext>
      </AppProvider>
      <DevelopmentTools
        runtime={runtime}
        snapshot={snapshot}
        loadingPreview={loadingPreview}
        setLoadingPreview={setLoadingPreview}
      />
    </>
  );
}
