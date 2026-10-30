import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useEffect, useId, useState } from 'react';
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
import { RECORDING_FPS, RECORDING_BITRATE_MBPS, type PublicConfig } from '@ba/contracts';
import { QUALITIES, normalizeQuality, estimateRecordingBytes, formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Dialog, Button, Field, Toggle, Notice } from '../../components/ui';
import { RecordingMigrationResult } from './RecordingMigrationResult';
import { AutoRecordingControl } from './AutoRecordingControl';
import { RecordingCaptureFeedback } from './RecordingCaptureFeedback';
import { RecordingDisplayPicker } from './RecordingDisplayPicker';
import { SettingsSaveIndicator } from '../settings/SettingsSaveIndicator';
export function RecordingSettings({
  inline = false,
  showSaveStatus = true,
}: {
  inline?: boolean;
  showSaveStatus?: boolean;
}) {
  const {
      api,
      state,
      closeModal,
      backModal,
      notify,
      recordingPreference,
      recordingSettings: settings,
    } = useApp(),
    { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const microphoneHint = useId();
  const draft = settings.draft ?? state.config;
  const {
    change,
    flush,
    flushPending,
    directory,
    setDirectory,
    move,
    setMove,
    migration,
    setMigration,
  } = settings;
  useEffect(() => {
    let active = true;
    void api
      .invoke('replays.list', null)
      .then((library) => {
        if (active && library.migration)
          setMigration((previous) =>
            !previous || library.migration!.createdAt >= previous.createdAt
              ? library.migration!
              : previous,
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, state.replaysRevision, setMigration]);
  useEffect(
    () => () => {
      void flushPending();
    },
    [flushPending],
  );
  const set = <K extends keyof PublicConfig>(key: K, value: PublicConfig[K], delay = 0) =>
    change({ [key]: value }, delay);
  const close = async (back = false) => {
    if (await flush()) {
      if (back && backModal) backModal();
      else closeModal();
    }
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
    <div className="recording-settings">
      {inline && showSaveStatus && <SettingsSaveIndicator />}
      <RecordingCaptureFeedback settingsAvailable={false} />
      <Card className="recording-behavior-card">
        <CardHeader>
          <CardTitle>{t('recordingBehavior')}</CardTitle>
          <CardDescription>{t('recordingHint')}</CardDescription>
          <CardAction>
            <Button
              disabled={
                busy ||
                settings.status === 'saving' ||
                recordingPreference.pending ||
                ['recording', 'starting', 'stopping'].includes(state.recording.phase)
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
            <AutoRecordingControl id="rec-enabled" />
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
            <RecordingDisplayPicker
              value={draft.replayDisplayId}
              onChange={(id) => set('replayDisplayId', id)}
            >
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
                    aria-valuetext={`${draft.replayBitrateMbps} Mbps`}
                    onValueChange={([value]) =>
                      set('replayBitrateMbps', value ?? RECORDING_BITRATE_MBPS.default, 250)
                    }
                  />
                </Field>
              </FieldGroup>
            </RecordingDisplayPicker>
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
              aria-describedby={microphoneHint}
              onChange={(value) => set('replayMicrophone', value)}
            />
            <FieldDescription id={microphoneHint}>
              {t(
                draft.replayAudio === 'off'
                  ? draft.replayMicrophone
                    ? 'recordingMicrophonePausedOn'
                    : 'recordingMicrophonePausedOff'
                  : 'recordingAudioNextCapture',
              )}
            </FieldDescription>
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
                  onBlur={() => void flushPending()}
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
                            void flush();
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
      <RecordingMigrationResult result={migration} />
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
      headerActions={showSaveStatus ? <SettingsSaveIndicator compact /> : undefined}
    >
      {content}
    </Dialog>
  );
}
