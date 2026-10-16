import { useEffect, useRef, useState } from 'react';
import { faFolderOpen } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import type { Display, PublicConfig } from '@ba/contracts';
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
      <section className="settings-section" aria-labelledby="rec-behavior-heading">
        <h3 id="rec-behavior-heading">{t('recordingBehavior')}</h3>
        <p>{t('recordingHint')}</p>
        <div className="settings-card recording-settings-card settings-flags">
          <div className="recording-setting-row">
            <Toggle
              id="rec-enabled"
              label={t('autoRecord')}
              checked={draft.replayEnabled}
              onChange={(value) => set('replayEnabled', value)}
            />
          </div>
          <div className="recording-setting-row recording-test-row">
            <p>{t('recordingTestHint')}</p>
            <Button
              disabled={
                busy || ['recording', 'starting', 'stopping'].includes(state.recording.phase)
              }
              onClick={() => void test()}
            >
              {t('recordingTest')}
            </Button>
          </div>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="rec-video-heading">
        <h3 id="rec-video-heading">{t('recordingVideo')}</h3>
        <div className="settings-card recording-settings-card">
          <div className="recording-setting-row">
            <Field id="rec-display" label={t('display')}>
              <select
                id="rec-display"
                value={draft.replayDisplayId}
                onChange={(e) => set('replayDisplayId', e.target.value)}
              >
                <option value="">{t('autoDisplay')}</option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="recording-setting-row">
            <div className="display-preview-slot" aria-busy={thumbnail.pending && !thumbnail.data}>
              {thumbnail.data ? (
                <img className="display-preview" src={thumbnail.data} alt={t('display')} />
              ) : (
                <span role={thumbnail.error ? 'alert' : 'status'} className="muted">
                  {thumbnail.error || t(thumbnail.pending ? 'loading' : 'previewUnavailable')}
                </span>
              )}
            </div>
          </div>
          <div className="recording-setting-row">
            <Field id="rec-quality" label={`${t('quality')} · ${draft.replayQuality}p`}>
              <input
                id="rec-quality"
                type="range"
                min={0}
                max={4}
                step={1}
                aria-valuetext={draft.replayQuality + 'p'}
                value={QUALITIES.indexOf(draft.replayQuality)}
                onChange={(e) =>
                  set('replayQuality', normalizeQuality(QUALITIES[Number(e.target.value)]), 250)
                }
              />
            </Field>
          </div>
          <div className="recording-setting-row">
            <Field id="rec-fps" label={`${t('fps')} · ${draft.replayFps}`}>
              <input
                id="rec-fps"
                type="range"
                min={30}
                max={60}
                value={draft.replayFps}
                onChange={(e) => set('replayFps', Number(e.target.value), 250)}
              />
            </Field>
          </div>
          <div className="recording-setting-row">
            <Field id="rec-bitrate" label={`${t('bitrate')} · ${draft.replayBitrateMbps} Mbps`}>
              <input
                id="rec-bitrate"
                type="range"
                min={3}
                max={10}
                value={draft.replayBitrateMbps}
                onChange={(e) => set('replayBitrateMbps', Number(e.target.value), 250)}
              />
            </Field>
          </div>
        </div>
        <p className="recording-storage-estimate">
          {t('estimated', {
            size: formatSize(
              estimateRecordingBytes(45, draft.replayBitrateMbps, draft.replayAudio === 'default'),
            ),
          })}
        </p>
      </section>
      <section className="settings-section" aria-labelledby="rec-sound-heading">
        <h3 id="rec-sound-heading">{t('recordingSound')}</h3>
        <div className="settings-card recording-settings-card settings-flags">
          <div className="recording-setting-row">
            <Field id="rec-audio" label={t('audio')}>
              <select
                id="rec-audio"
                value={draft.replayAudio}
                onChange={(e) => set('replayAudio', e.target.value === 'off' ? 'off' : 'default')}
              >
                <option value="default">{t('audio')}</option>
                <option value="off">{t('audioOff')}</option>
              </select>
            </Field>
          </div>
          <div className="recording-setting-row">
            <Toggle
              id="rec-microphone"
              label={t('recordMicrophone')}
              checked={draft.replayMicrophone}
              disabled={draft.replayAudio === 'off'}
              onChange={(value) => set('replayMicrophone', value)}
            />
          </div>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="rec-storage-heading">
        <h3 id="rec-storage-heading">{t('recordingStorage')}</h3>
        <div className="settings-card recording-settings-card settings-flags">
          <div className="recording-setting-row">
            <Toggle
              id="rec-migrate"
              label={t('migrateFilesOnChange')}
              checked={move}
              onChange={setMove}
              disabled={busy || settings.status === 'saving'}
            />
          </div>
          <div className="recording-setting-row recording-directory-row">
            <Field id="rec-directory" label={t('saveDirectory')}>
              <div className="input-action">
                <input
                  id="rec-directory"
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                  onBlur={() => set('replaySaveDir', directory)}
                  disabled={busy || settings.status === 'saving'}
                  placeholder={t('defaultDirectory')}
                />
                <Button
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
                  <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                  {t('select')}
                </Button>
              </div>
            </Field>
          </div>
        </div>
      </section>
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
      showHeader={false}
      className="recording-settings-dialog"
    >
      {content}
    </Dialog>
  );
}
