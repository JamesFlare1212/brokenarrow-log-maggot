import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { FolderOpen } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from '@/components/ui/card';
import { FieldGroup, FieldDescription } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RECORDING_FPS,
  RECORDING_QUALITY_SCORE,
  RECORDING_CODEC_LABELS,
  type Display,
  type PublicConfig,
} from '@ba/contracts';
import { QUALITIES, normalizeQuality } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import type { SettingsSaveStatus } from '../../hooks/useSettingsAutosave';
import { Dialog, Button, Field, Toggle, Notice } from '../../components/ui';
export function RecordingSettings({
  enable = false,
  inline = false,
  onStatusChange,
}: {
  enable?: boolean;
  inline?: boolean;
  onStatusChange?: (status: SettingsSaveStatus) => void;
}) {
  const { api, state, settings, recordingPreferences, closeModal, backModal, notify } = useApp(),
    { t } = useI18n(),
    [displays, setDisplays] = useState<Display[]>([]),
    [previewAspectRatio, setPreviewAspectRatio] = useState(16 / 9),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    thumbnail = useRequest<string | null>();
  const { moveFiles: move, setMoveFiles: setMove } = recordingPreferences;
  const prepareDirectory = useCallback(
    async (patch: Partial<PublicConfig>) => {
      if (!move || !patch.replaySaveDir) return;
      const { dir } = await api.invoke('replays.directory', null);
      if (dir === patch.replaySaveDir) return;
      const result = await api.invoke('replays.move', { from: dir, to: patch.replaySaveDir });
      if (result.failed.length) throw new Error(t('movePartial', { n: result.failed.length }));
    },
    [api, move, t],
  );
  const draft = settings.draft ?? state.config;
  const directory = draft.replaySaveDir;
  const status = settings.status;
  const { stage, prepareField, change, flush } = settings;
  useEffect(() => {
    prepareField('replaySaveDir', prepareDirectory);
  }, [prepareField, prepareDirectory]);
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);
  const latest = useRef({ notify, t });
  Object.assign(latest.current, { notify, t });
  useEffect(
    () => () => {
      void flush().then((saved) => {
        if (!saved) latest.current.notify(latest.current.t('settingsSaveFailed'), true);
      });
    },
    [flush],
  );
  useEffect(() => {
    if (enable) change({ replayEnabled: true });
  }, [enable, change]);
  useEffect(() => {
    void api
      .invoke('displays.list', null)
      .then(setDisplays)
      .catch((e) => setError(String(e)));
  }, [api]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      await thumbnail.load(
        () => api.invoke('displays.thumbnail', { id: draft.replayDisplayId }),
        true,
      );
      if (active) timer = setTimeout(() => void refresh(), 2000);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, draft.replayDisplayId]);
  const set = <K extends keyof PublicConfig>(key: K, value: PublicConfig[K], delay = 0) =>
    change({ [key]: value }, delay, key === 'replaySaveDir' ? prepareDirectory : undefined);
  const close = async (back = false) => {
    if (await flush()) {
      if (back && backModal) backModal();
      else closeModal();
    }
  };
  const discard = async () => {
    await settings.discard();
    if (!inline) closeModal();
  };
  const test = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await flush())) return;
      await api.invoke('replays.test', null);
      notify(t('success'));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const content = (
    <div className="recording-settings grid min-w-0 flex-col gap-(--content-gap) @container/recording grid-cols-2 [&>[role='alert']]:col-span-full viewport-max-767:grid-cols-1">
      <Card className="recording-behavior-card recording-max-28:[&>[data-slot='card-header']]:grid-cols-1 recording-max-28:[&_[data-slot='card-action']]:col-start-1 recording-max-28:[&_[data-slot='card-action']]:[grid-row:3] recording-max-28:[&_[data-slot='card-action']]:justify-self-start recording-max-28:[&_[data-slot='card-action']]:mt-2 col-span-full">
        <CardHeader>
          <CardTitle>{t('recordingBehavior')}</CardTitle>
          <CardDescription>{t('recordingHint')}</CardDescription>
          <CardAction>
            <Button
              disabled={
                busy || ['recording', 'starting', 'stopping'].includes(state.recording.phase)
              }
              aria-busy={busy}
              onClick={() => void test()}
            >
              {t('recordingTest')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Toggle
              id="rec-enabled"
              label={t('autoRecord')}
              labelClickable={false}
              checked={draft.replayEnabled}
              onChange={(value) => set('replayEnabled', value)}
            />
            <FieldDescription>{t('recordingTestHint')}</FieldDescription>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card className="recording-video-card col-span-full">
        <CardHeader>
          <CardTitle>{t('recordingVideo')}</CardTitle>
          <CardDescription>{t('recordingCodecAutomatic')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field id="rec-display" label={t('display')}>
              <NativeSelect
                id="rec-display"
                value={draft.replayDisplayId}
                onChange={(e) => set('replayDisplayId', e.target.value)}
              >
                <NativeSelectOption value="">{t('autoDisplay')}</NativeSelectOption>
                {displays.map((display) => (
                  <NativeSelectOption key={display.id} value={display.id}>
                    {display.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <div className="recording-video-grid grid grid-cols-2 gap-6 items-center viewport-max-767:grid-cols-1">
              <div
                className="display-preview-slot flex w-full max-w-[calc(20rem_*_var(--display-preview-ratio))] [aspect-ratio:var(--display-preview-ratio)] items-center justify-center overflow-hidden rounded-lg bg-muted"
                style={{ '--display-preview-ratio': previewAspectRatio } as CSSProperties}
                aria-busy={thumbnail.pending && !thumbnail.data}
              >
                {thumbnail.data ? (
                  <img
                    className="display-preview block size-full object-contain"
                    src={thumbnail.data}
                    alt={t('display')}
                    onLoad={({ currentTarget: image }) => {
                      if (image.naturalWidth > 0 && image.naturalHeight > 0)
                        setPreviewAspectRatio(image.naturalWidth / image.naturalHeight);
                    }}
                  />
                ) : thumbnail.pending ? (
                  <Skeleton className="size-full" />
                ) : (
                  <span
                    role={thumbnail.error ? 'alert' : 'status'}
                    className="muted text-muted-foreground"
                  >
                    {thumbnail.error || t('previewUnavailable')}
                  </span>
                )}
              </div>
              <FieldGroup>
                <Field id="rec-quality" label={`${t('quality')} · ${draft.replayQuality}p`}>
                  <Slider
                    id="rec-quality"
                    min={0}
                    max={QUALITIES.length - 1}
                    step={1}
                    value={[QUALITIES.indexOf(draft.replayQuality)]}
                    aria-label={t('quality')}
                    aria-valuetext={draft.replayQuality + 'p'}
                    onValueChange={([value]) =>
                      set('replayQuality', normalizeQuality(QUALITIES[value ?? 0]), 250)
                    }
                  />
                </Field>
                <Field id="rec-fps" label={`${t('fps')} · ${draft.replayFps}`}>
                  <Slider
                    id="rec-fps"
                    min={RECORDING_FPS.min}
                    max={RECORDING_FPS.max}
                    step={RECORDING_FPS.step}
                    value={[draft.replayFps]}
                    aria-label={t('fps')}
                    onValueChange={([value]) =>
                      set('replayFps', value ?? RECORDING_FPS.default, 250)
                    }
                  />
                </Field>
                <Field
                  id="rec-quality-score"
                  label={`${t('recordingQualityScore')} · ${draft.replayQualityScore}`}
                >
                  <Slider
                    id="rec-quality-score"
                    min={RECORDING_QUALITY_SCORE.min}
                    max={RECORDING_QUALITY_SCORE.max}
                    step={1}
                    value={[draft.replayQualityScore]}
                    aria-label={t('recordingQualityScore')}
                    aria-describedby="rec-quality-score-hint"
                    onValueChange={([value]) =>
                      set('replayQualityScore', value ?? RECORDING_QUALITY_SCORE.default, 250)
                    }
                  />
                  <FieldDescription id="rec-quality-score-hint">
                    {t('recordingQualityHint', {
                      min: RECORDING_QUALITY_SCORE.recommendedMin,
                      max: RECORDING_QUALITY_SCORE.recommendedMax,
                      value: RECORDING_QUALITY_SCORE.default,
                    })}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </div>
            <FieldDescription>{t('recordingVariableSize')}</FieldDescription>
            {state.recording.codec && ['recording', 'stopping'].includes(state.recording.phase) && (
              <FieldDescription role="status">
                {t('recordingCodecSelected', {
                  codec: RECORDING_CODEC_LABELS[state.recording.codec],
                })}
              </FieldDescription>
            )}
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('recordingSound')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field id="rec-audio" label={t('audio')}>
              <NativeSelect
                id="rec-audio"
                value={draft.replayAudio}
                onChange={(e) => set('replayAudio', e.target.value === 'off' ? 'off' : 'default')}
              >
                <NativeSelectOption value="default">{t('audio')}</NativeSelectOption>
                <NativeSelectOption value="off">{t('audioOff')}</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Toggle
              id="rec-microphone"
              label={t('recordMicrophone')}
              checked={draft.replayMicrophone}
              disabled={draft.replayAudio === 'off'}
              onChange={(value) => set('replayMicrophone', value)}
            />
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('recordingStorage')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Toggle
              id="rec-migrate"
              label={t('migrateFilesOnChange')}
              checked={move}
              onChange={setMove}
              disabled={busy || settings.status === 'saving'}
            />
            <Field id="rec-directory" label={t('saveDirectory')}>
              <InputGroup>
                <InputGroupInput
                  id="rec-directory"
                  value={directory}
                  onChange={(e) => stage({ replaySaveDir: e.target.value }, prepareDirectory)}
                  onBlur={() => void flush()}
                  disabled={busy || settings.status === 'saving'}
                  placeholder={t('defaultDirectory')}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    disabled={busy || settings.status === 'saving'}
                    onClick={() =>
                      void api
                        .invoke('directory.select', { kind: 'replays' })
                        .then((dir) => {
                          if (dir) {
                            set('replaySaveDir', dir);
                          }
                        })
                        .catch((e) => setError(String(e)))
                    }
                  >
                    <FolderOpen data-icon="inline-start" />
                    {t('select')}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      {error && <Notice error>{error}</Notice>}
      {settings.error && (
        <Notice error>
          {settings.error}
          <Button onClick={() => void flush()}>{t('settingsRetry')}</Button>
          <Button onClick={() => void discard()}>{t('settingsDiscard')}</Button>
        </Notice>
      )}
      {!inline && (
        <div
          className="settings-save-state flex items-center gap-2 text-muted-foreground text-[0.75rem] [.recording-settings>&]:col-span-full viewport-max-767:max-w-32 viewport-max-479:shrink-0 viewport-max-479:max-w-24"
          role="status"
          aria-live="polite"
        >
          {t(
            status === 'saved'
              ? 'settingsAutoSaved'
              : status === 'error'
                ? 'settingsSaveFailed'
                : 'settingsSaving',
          )}
        </div>
      )}
    </div>
  );

  return inline ? (
    content
  ) : (
    <Dialog
      open
      onClose={() => void close()}
      onBack={backModal ? () => void close(true) : undefined}
      title={t('recordingSettings')}
      className="recording-settings-dialog w-[calc(100%_-_3rem)] max-w-192 sm:max-w-192 viewport-max-767:w-[calc(100%_-_1.5rem)]"
    >
      {content}
    </Dialog>
  );
}
