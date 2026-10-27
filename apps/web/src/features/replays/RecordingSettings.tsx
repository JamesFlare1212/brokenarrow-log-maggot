import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  RECORDING_BITRATE_MBPS,
  type Display,
  type PublicConfig,
} from '@ba/contracts';
import { QUALITIES, normalizeQuality, estimateRecordingBytes, formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { useSettingsAutosave, type SettingsSaveStatus } from '../../hooks/useSettingsAutosave';
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
  const { api, state, closeModal, backModal, notify } = useApp(),
    { t } = useI18n(),
    [directory, setDirectory] = useState(state.config.replaySaveDir),
    [displays, setDisplays] = useState<Display[]>([]),
    [previewAspectRatio, setPreviewAspectRatio] = useState(16 / 9),
    [move, setMove] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    thumbnail = useRequest<string | null>();
  const settings = useSettingsAutosave(api, state.config, async (patch) => {
    if (!move || !patch.replaySaveDir) return;
    const { dir } = await api.invoke('replays.directory', null);
    if (dir === patch.replaySaveDir) return;
    const result = await api.invoke('replays.move', { from: dir, to: patch.replaySaveDir });
    if (result.failed.length) throw new Error(t('movePartial', { n: result.failed.length }));
  });
  const draft = settings.draft ?? state.config;
  const status =
    settings.status === 'saved' && directory !== draft.replaySaveDir ? 'pending' : settings.status;
  const { change, flush } = settings;
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);
  const latest = useRef({ directory, notify, t, discarded: false });
  Object.assign(latest.current, { directory, notify, t });
  useEffect(
    () => () => {
      if (latest.current.discarded) return;
      change({ replaySaveDir: latest.current.directory });
      void flush().then((saved) => {
        if (!saved) latest.current.notify(latest.current.t('settingsSaveFailed'), true);
      });
    },
    [change, flush],
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
    change({ [key]: value }, delay);
  const close = async (back = false) => {
    set('replaySaveDir', directory);
    if (await flush()) {
      if (back && backModal) backModal();
      else closeModal();
    }
  };
  const discard = async () => {
    latest.current.discarded = true;
    await settings.discard();
    setDirectory(state.config.replaySaveDir);
    latest.current.directory = state.config.replaySaveDir;
    if (!inline) closeModal();
    else latest.current.discarded = false;
  };
  const test = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      set('replaySaveDir', directory);
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
    <div className="recording-settings">
      <Card className="recording-behavior-card">
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
      <Card className="recording-video-card">
        <CardHeader>
          <CardTitle>{t('recordingVideo')}</CardTitle>
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
            <div className="recording-video-grid">
              <div
                className="display-preview-slot"
                style={{ '--display-preview-ratio': previewAspectRatio } as CSSProperties}
                aria-busy={thumbnail.pending && !thumbnail.data}
              >
                {thumbnail.data ? (
                  <img
                    className="display-preview"
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
                  <span role={thumbnail.error ? 'alert' : 'status'} className="muted">
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
                <Field id="rec-bitrate" label={`${t('bitrate')} · ${draft.replayBitrateMbps} Mbps`}>
                  <Slider
                    id="rec-bitrate"
                    min={RECORDING_BITRATE_MBPS.min}
                    max={RECORDING_BITRATE_MBPS.max}
                    step={1}
                    value={[draft.replayBitrateMbps]}
                    aria-label={t('bitrate')}
                    onValueChange={([value]) =>
                      set('replayBitrateMbps', value ?? RECORDING_BITRATE_MBPS.default, 250)
                    }
                  />
                </Field>
              </FieldGroup>
            </div>
            <FieldDescription>
              {t('estimated', {
                size: formatSize(
                  estimateRecordingBytes(
                    45,
                    draft.replayBitrateMbps,
                    draft.replayAudio === 'default',
                  ),
                ),
              })}
            </FieldDescription>
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
                  onChange={(e) => setDirectory(e.target.value)}
                  onBlur={() => set('replaySaveDir', directory)}
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
                            setDirectory(dir);
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
        <div className="settings-save-state" role="status" aria-live="polite">
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
      className="recording-settings-dialog"
    >
      {content}
    </Dialog>
  );
}
