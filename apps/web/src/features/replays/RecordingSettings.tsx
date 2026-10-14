import { useEffect, useState } from 'react';
import type { Display, PublicConfig } from '@ba/contracts';
import { QUALITIES, normalizeQuality, estimateRecordingBytes, formatSize } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Button, Field, Toggle, Notice } from '../../components/ui';
export function RecordingSettings({ enable = false }: { enable?: boolean }) {
  const { api, state, closeModal, notify, patchConfig } = useApp(),
    { t } = useI18n(),
    [draft, setDraft] = useState<PublicConfig>(() => ({
      ...state.config,
      replayEnabled: enable || state.config.replayEnabled,
    })),
    [displays, setDisplays] = useState<Display[]>([]),
    [move, setMove] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [originalDir, setOriginalDir] = useState<string>(''),
    thumbnail = useRequest<string | null>();
  useEffect(() => {
    void api
      .invoke('replays.directory', null)
      .then((result) => setOriginalDir(result.dir))
      .catch((e) => setError(String(e)));
    void api
      .invoke('displays.list', null)
      .then(setDisplays)
      .catch((e) => setError(String(e)));
  }, [api]);
  useEffect(() => {
    const refresh = () =>
      void thumbnail.load(
        () => api.invoke('displays.thumbnail', { id: draft.replayDisplayId }),
        true,
      );
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [api, draft.replayDisplayId]);
  const set = <K extends keyof PublicConfig>(key: K, value: PublicConfig[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (move && draft.replaySaveDir && draft.replaySaveDir !== state.config.replaySaveDir) {
        const from = originalDir;
        if (!from) {
          setBusy(false);
          return;
        }
        const result = await api.invoke('replays.move', { from, to: draft.replaySaveDir });
        if (result.failed.length) {
          setError(t('movePartial', { n: result.failed.length }));
          return;
        }
      }
      await patchConfig({
        replayEnabled: draft.replayEnabled,
        replayQuality: draft.replayQuality,
        replayFps: draft.replayFps,
        replayBitrateMbps: draft.replayBitrateMbps,
        replayAudio: draft.replayAudio,
        replayDisplayId: draft.replayDisplayId,
        replaySaveDir: draft.replaySaveDir,
      });
      notify(t('success'));
      closeModal();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={closeModal} title={t('recordingSettings')}>
      <div className="settings-grid">
        <Notice>{t('recordingDescription')}</Notice>
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
        {thumbnail.data && (
          <img className="display-preview" src={thumbnail.data} alt={t('display')} />
        )}
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
              set('replayQuality', normalizeQuality(QUALITIES[Number(e.target.value)]))
            }
          />
        </Field>
        <Field id="rec-fps" label={`${t('fps')} · ${draft.replayFps}`}>
          <input
            id="rec-fps"
            type="range"
            min={30}
            max={60}
            value={draft.replayFps}
            onChange={(e) => set('replayFps', Number(e.target.value))}
          />
        </Field>
        <Field id="rec-bitrate" label={`${t('bitrate')} · ${draft.replayBitrateMbps} Mbps`}>
          <input
            id="rec-bitrate"
            type="range"
            min={3}
            max={10}
            value={draft.replayBitrateMbps}
            onChange={(e) => set('replayBitrateMbps', Number(e.target.value))}
          />
        </Field>
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
        <Notice>
          {t('estimated', {
            size: formatSize(
              estimateRecordingBytes(45, draft.replayBitrateMbps, draft.replayAudio === 'default'),
            ),
          })}
        </Notice>
        <Field id="rec-directory" label={t('saveDirectory')}>
          <div className="input-action">
            <input
              id="rec-directory"
              value={draft.replaySaveDir}
              onChange={(e) => set('replaySaveDir', e.target.value)}
              placeholder={t('defaultDirectory')}
            />
            <Button
              onClick={() =>
                void api
                  .invoke('directory.select', { kind: 'replays' })
                  .then((dir) => {
                    if (dir) set('replaySaveDir', dir);
                  })
                  .catch((e) => setError(String(e)))
              }
            >
              {t('select')}
            </Button>
          </div>
        </Field>
        <Toggle id="rec-migrate" label={t('migrateFiles')} checked={move} onChange={setMove} />
        <Toggle
          id="rec-enabled"
          label={t('autoRecord')}
          checked={draft.replayEnabled}
          onChange={(value) => set('replayEnabled', value)}
        />
        {error && <Notice error>{error}</Notice>}
        <div className="actions">
          <Button
            disabled={
              busy ||
              state.recording.phase === 'recording' ||
              state.recording.phase === 'starting' ||
              state.recording.phase === 'stopping'
            }
            onClick={() =>
              void api
                .invoke('replays.test', null)
                .then(() => notify(t('success')))
                .catch((e) => setError(String(e)))
            }
          >
            {t('recordingTest')}
          </Button>
          <Button disabled={busy} variant="primary" onClick={() => void save()}>
            {t('save')}
          </Button>
          <Button disabled={busy} onClick={closeModal}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
