import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bridge, PublicConfig } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export type SettingsSaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export function useSettingsAutosave(
  api: Bridge,
  config: PublicConfig | undefined,
  beforeSave?: (patch: Partial<PublicConfig>) => Promise<void>,
) {
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<SettingsSaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(config);
  const confirmed = useRef(config);
  const pending = useRef<Partial<PublicConfig>>({}),
    overrides = useRef<Partial<PublicConfig>>({});
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prepareSave = useRef(beforeSave);
  prepareSave.current = beforeSave;
  useEffect(() => {
    if (config) {
      confirmed.current = config;
      latest.current = { ...config, ...overrides.current };
      setDraft(latest.current);
    }
  }, [config]);
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) return running.current;
    if (!Object.keys(pending.current).length) return Promise.resolve(true);
    const save = async () => {
      while (Object.keys(pending.current).length) {
        const patch = pending.current;
        pending.current = {};
        setStatus('saving');
        setError(null);
        try {
          if (prepareSave.current) await prepareSave.current(patch);
          const result = await api.invoke('config.update', patch);
          confirmed.current = result;
          for (const key of Object.keys(patch) as Array<keyof PublicConfig>) {
            if (
              !(key in pending.current) &&
              JSON.stringify(overrides.current[key]) === JSON.stringify(patch[key])
            )
              delete overrides.current[key];
          }
          latest.current = { ...result, ...overrides.current };
          setDraft(latest.current);
        } catch (e) {
          pending.current = { ...patch, ...pending.current };
          setError(errorMessage(e));
          setStatus('error');
          return false;
        }
      }
      setStatus('saved');
      return true;
    };
    running.current = save().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [api]);
  const change = useCallback(
    (patch: Partial<PublicConfig>, delay = 0) => {
      if (!latest.current) return;
      const changed = Object.entries(patch).filter(
        ([key, value]) =>
          JSON.stringify(latest.current![key as keyof PublicConfig]) !== JSON.stringify(value),
      );
      if (!changed.length) return;
      const update = Object.fromEntries(changed) as Partial<PublicConfig>;
      Object.assign(pending.current, update);
      Object.assign(overrides.current, update);
      latest.current = { ...latest.current, ...update };
      setDraft(latest.current);
      setStatus('pending');
      setError(null);
      if (timer.current !== null) clearTimeout(timer.current);
      if (delay)
        timer.current = setTimeout(() => {
          timer.current = null;
          void flush();
        }, delay);
      else void flush();
    },
    [flush],
  );
  const discard = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) await running.current;
    pending.current = {};
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
  return { draft, status, error, change, flush, discard };
}
