import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bridge, PublicConfig } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export type SettingsSaveStatus = 'saved' | 'pending' | 'saving' | 'error';
type PrepareSettings = (patch: Partial<PublicConfig>) => Promise<void>;

export function useSettingsAutosave(
  api: Bridge,
  config: PublicConfig | undefined,
  beforeSave?: PrepareSettings,
) {
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<SettingsSaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const [savingFields, setSavingFields] = useState<Array<keyof PublicConfig>>([]);
  const latest = useRef(config);
  const confirmed = useRef(config);
  const observed = useRef(config);
  const versions = useRef<Partial<Record<keyof PublicConfig, number>>>({});
  // Automatic saves drain pending fields; only explicit flush promotes draft-only fields.
  const pending = useRef<Partial<PublicConfig>>({}),
    staged = useRef<Partial<PublicConfig>>({}),
    overrides = useRef<Partial<PublicConfig>>({});
  const preparations = useRef<Partial<Record<keyof PublicConfig, PrepareSettings | undefined>>>({});
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prepareSave = useRef(beforeSave);
  prepareSave.current = beforeSave;
  if (config && !latest.current) {
    latest.current = confirmed.current = observed.current = config;
  }
  useEffect(() => {
    if (config) {
      for (const key of Object.keys(config) as Array<keyof PublicConfig>)
        if (JSON.stringify(observed.current?.[key]) !== JSON.stringify(config[key]))
          versions.current[key] = (versions.current[key] ?? 0) + 1;
      observed.current = config;
      confirmed.current = config;
      latest.current = { ...config, ...overrides.current };
      setDraft(latest.current);
    }
  }, [config]);
  const saveReady = useCallback((): Promise<boolean> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) return running.current;
    if (!Object.keys(pending.current).length) return Promise.resolve(true);
    const save = async () => {
      while (Object.keys(pending.current).length) {
        const patch = pending.current;
        const keys = Object.keys(patch) as Array<keyof PublicConfig>;
        const prepare: Partial<Record<keyof PublicConfig, PrepareSettings | undefined>> = {};
        for (const key of keys) {
          prepare[key] = preparations.current[key];
          delete preparations.current[key];
        }
        pending.current = {};
        setSavingFields(keys);
        setStatus('saving');
        setError(null);
        try {
          if (prepareSave.current) await prepareSave.current(patch);
          for (const run of new Set(Object.values(prepare))) if (run) await run(patch);
          const sentVersions = { ...versions.current };
          const result = await api.invoke('config.update', patch);
          const acknowledged = { ...confirmed.current } as PublicConfig;
          for (const key of keys) {
            // Replies acknowledge patched fields; newer observed fields retain their authority.
            if (versions.current[key] === sentVersions[key])
              Object.assign(acknowledged, { [key]: result[key] });
            if (
              !(key in pending.current) &&
              !(key in staged.current) &&
              JSON.stringify(overrides.current[key]) === JSON.stringify(patch[key])
            )
              delete overrides.current[key];
          }
          confirmed.current = acknowledged;
          latest.current = { ...acknowledged, ...overrides.current };
          setDraft(latest.current);
        } catch (e) {
          for (const key of keys)
            if (!(key in pending.current) && !(key in staged.current)) {
              Object.assign(pending.current, { [key]: patch[key] });
              preparations.current[key] = prepare[key];
            }
          setError(errorMessage(e));
          setStatus('error');
          return false;
        }
      }
      setStatus(Object.keys(staged.current).length ? 'pending' : 'saved');
      return true;
    };
    running.current = save().finally(() => {
      running.current = null;
      setSavingFields([]);
    });
    return running.current;
  }, [api]);
  const flush = useCallback((): Promise<boolean> => {
    Object.assign(pending.current, staged.current);
    staged.current = {};
    return saveReady();
  }, [saveReady]);
  const edit = useCallback(
    (
      patch: Partial<PublicConfig>,
      prepare: PrepareSettings | undefined,
      hold: boolean,
    ): boolean => {
      if (!latest.current) return false;
      for (const key of Object.keys(patch) as Array<keyof PublicConfig>)
        if (key in pending.current || key in staged.current) preparations.current[key] = prepare;
      const changed = Object.entries(patch).filter(
        ([key, value]) =>
          JSON.stringify(latest.current![key as keyof PublicConfig]) !== JSON.stringify(value) ||
          key in (hold ? pending.current : staged.current),
      );
      if (!changed.length) return false;
      const update = Object.fromEntries(changed) as Partial<PublicConfig>;
      for (const [key, value] of changed) {
        Object.assign(hold ? staged.current : pending.current, { [key]: value });
        delete (hold ? pending.current : staged.current)[key as keyof PublicConfig];
      }
      Object.assign(overrides.current, update);
      for (const key of Object.keys(update) as Array<keyof PublicConfig>)
        preparations.current[key] = prepare;
      latest.current = { ...latest.current, ...update };
      setDraft(latest.current);
      setStatus('pending');
      setError(null);
      return true;
    },
    [],
  );
  const stage = useCallback(
    (patch: Partial<PublicConfig>, prepare?: PrepareSettings) => edit(patch, prepare, true),
    [edit],
  );
  const prepareField = useCallback((key: keyof PublicConfig, prepare: PrepareSettings) => {
    if (key in pending.current || key in staged.current) preparations.current[key] = prepare;
  }, []);
  const change = useCallback(
    (patch: Partial<PublicConfig>, delay = 0, prepare?: PrepareSettings) => {
      if (!edit(patch, prepare, false)) return;
      if (timer.current !== null) clearTimeout(timer.current);
      if (delay)
        timer.current = setTimeout(() => {
          timer.current = null;
          void saveReady();
        }, delay);
      else void saveReady();
    },
    [saveReady, edit],
  );
  const discard = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) await running.current;
    pending.current = {};
    staged.current = {};
    preparations.current = {};
    overrides.current = {};
    latest.current = confirmed.current;
    setDraft(confirmed.current);
    setError(null);
    setStatus('saved');
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return { draft, status, error, savingFields, stage, prepareField, change, flush, discard };
}
