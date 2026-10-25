import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Activity, FlaskConical, GripVertical, RefreshCw, Video } from 'lucide-react';
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
  type DevelopmentRuntime,
  type DevelopmentSnapshot,
  type DevelopmentMode,
  type DevelopmentRecording,
  type DevelopmentApm,
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
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const escape = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  const layer = useDevelopmentLayer(escape),
    theme = useDevelopmentTheme();
  const { dock, position, handle } = useToolPosition(layer);
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
                <Button ref={trigger} variant="ghost" aria-label={t('devTools')}>
                  <FlaskConical data-icon="inline-start" aria-hidden="true" />
                  <span>{t('devTools')}</span>
                  <Badge variant="secondary">DEV</Badge>
                </Button>
              </PopoverTrigger>
            </div>
            <PopoverContent
              align="end"
              side="top"
              container={container}
              updatePositionStrategy="always"
              aria-labelledby="development-tools-title"
              className="development-tools-panel w-80 max-w-[calc(100vw-2rem)]"
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
                <Field data-disabled={!local || snapshot.pending}>
                  <FieldLabel htmlFor="development-apm">
                    <Activity aria-hidden="true" />
                    {t('devApm')}
                  </FieldLabel>
                  <NativeSelect
                    id="development-apm"
                    className="w-full"
                    value={snapshot.apm}
                    disabled={!local || snapshot.pending}
                    onChange={(event) =>
                      runtime.controls.setApm(event.target.value as DevelopmentApm)
                    }
                  >
                    {(['empty', 'active', 'complete'] as const).map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {t('devApm.' + value)}
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

export function DevelopmentApp({ api }: { api: Bridge }) {
  const [runtime] = useState(() => createDevelopmentRuntime(api));
  const snapshot = useSyncExternalStore(runtime.controls.subscribe, runtime.controls.getSnapshot);
  useEffect(() => () => runtime.dispose(), [runtime]);
  return (
    <>
      <AppProvider key={snapshot.generation} api={runtime.api}>
        <App />
      </AppProvider>
      <DevelopmentTools runtime={runtime} snapshot={snapshot} />
    </>
  );
}
