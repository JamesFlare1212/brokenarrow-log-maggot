import { useCallback, useRef, useState } from 'react';
import type { Bridge, PublicConfig, ReplayMoveResult } from '@ba/contracts';
import { combineSettingsStatuses, useSettingsAutosave } from '../../hooks/useSettingsAutosave';
import { translate } from '../../hooks/useI18n';

export function useRecordingSettingsState(
  api: Bridge,
  config: PublicConfig | undefined,
  configRevision?: number,
) {
  const [directoryDraft, updateDirectory] = useState<string | null>(null),
    [directoryPending, setDirectoryPending] = useState(false),
    [move, setMove] = useState(false),
    [migration, setMigration] = useState<ReplayMoveResult | null>(null);
  const directoryRef = useRef<string | null>(null);
  const needsDirectoryCommit = useRef(false);
  const settings = useSettingsAutosave(
    api,
    config,
    async (patch) => {
      if (!move || !patch.replaySaveDir) return;
      const { dir } = await api.invoke('replays.directory', null);
      if (dir === patch.replaySaveDir) return;
      let result: ReplayMoveResult;
      try {
        result = await api.invoke('replays.move', { from: dir, to: patch.replaySaveDir });
      } catch (error) {
        for (const code of [
          'REPLAY_MIGRATION_BUSY',
          'REPLAY_MIGRATION_RECORDING_ACTIVE',
          'REPLAY_DIRECTORY_CHANGED',
        ])
          if (String(error).includes(code)) throw new Error(translate(config?.lang ?? 'zh', code));
        throw error;
      }
      setMigration(result);
      if (!result.committed)
        throw new Error(translate(config?.lang ?? 'zh', 'recordingMigrationUnchanged'));
    },
    configRevision,
  );
  const setDirectory = useCallback((value: string) => {
    directoryRef.current = value;
    needsDirectoryCommit.current = true;
    setDirectoryPending(true);
    updateDirectory(value);
  }, []);
  const { change, flush: flushSettings, discard: discardSettings } = settings;
  const flush = useCallback(async () => {
    const directory = directoryRef.current;
    needsDirectoryCommit.current = false;
    setDirectoryPending(false);
    if (directory !== null) change({ replaySaveDir: directory });
    const saved = await flushSettings();
    if (saved && directoryRef.current === directory) {
      directoryRef.current = null;
      updateDirectory(null);
    }
    return saved;
  }, [change, flushSettings]);
  const flushPending = useCallback(() => {
    return needsDirectoryCommit.current ? flush() : settings.flushPending();
  }, [flush, settings.flushPending]);
  const discard = useCallback(async () => {
    await discardSettings();
    directoryRef.current = null;
    needsDirectoryCommit.current = false;
    setDirectoryPending(false);
    updateDirectory(null);
    setMove(false);
  }, [discardSettings]);
  const directory = directoryDraft ?? settings.draft?.replaySaveDir ?? config?.replaySaveDir ?? '';
  const status = combineSettingsStatuses(
    settings.status,
    directoryPending || directory !== (settings.draft ?? config)?.replaySaveDir
      ? 'pending'
      : 'saved',
  );
  return {
    ...settings,
    status,
    directory,
    setDirectory,
    move,
    setMove,
    migration,
    setMigration,
    flush,
    flushPending,
    discard,
  };
}
