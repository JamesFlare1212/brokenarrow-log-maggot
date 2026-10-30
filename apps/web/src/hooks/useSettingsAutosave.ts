import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bridge, PublicConfig } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export type SettingsSaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'unconfirmed';

export function combineSettingsStatuses(...statuses: SettingsSaveStatus[]): SettingsSaveStatus {
  if (statuses.includes('unconfirmed')) return 'unconfirmed';
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('saving')) return 'saving';
  if (statuses.includes('pending')) return 'pending';
  return 'saved';
}

export function useSettingsAutosave(
  api: Bridge,
  config: PublicConfig | undefined,
  beforeSave?: (patch: Partial<PublicConfig>) => Promise<void>,
  configRevision?: number,
) {
  const [draft, setDraft] = useState(config);
  const [status, setStatus] = useState<SettingsSaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const failure = useRef<string | null>(null);
  const latest = useRef(config);
  const confirmed = useRef(config);
  const confirmedRevision = useRef(configRevision ?? -1);
  const unconfirmed = useRef<Partial<PublicConfig> | null>(null);
  const discarded = useRef(0);
  const edits = useRef<Partial<Record<keyof PublicConfig, number>>>({});
  const [, setDiscarded] = useState(0);
  const pending = useRef<Partial<PublicConfig>>({}),
    overrides = useRef<Partial<PublicConfig>>({});
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prepareSave = useRef(beforeSave);
  prepareSave.current = beforeSave;
  const matches = (patch: Partial<PublicConfig>, value: PublicConfig | undefined) =>
    !!value &&
    Object.entries(patch).every(
      ([key, field]) => JSON.stringify(field) === JSON.stringify(value[key as keyof PublicConfig]),
    );
  const accept = (patch: Partial<PublicConfig>, result: PublicConfig) => {
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
  };
  const readConfirmed = useCallback(async () => {
    const snapshot = await api.invoke('config.read', null);
    if (snapshot.revision >= confirmedRevision.current || !confirmed.current) {
      confirmed.current = snapshot.config;
      confirmedRevision.current = snapshot.revision;
    }
    return confirmed.current;
  }, [api]);
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) return running.current;
    if (!Object.keys(pending.current).length && unconfirmed.current === null)
      return Promise.resolve(true);
    const save = async () => {
      while (Object.keys(pending.current).length || unconfirmed.current !== null) {
        const patch = pending.current;
        pending.current = {};
        setStatus('saving');
        failure.current = null;
        setError(null);
        let attempted = false;
        const revision = confirmedRevision.current;
        try {
          if (unconfirmed.current !== null) {
            const result = await readConfirmed();
            unconfirmed.current = null;
            if (matches(patch, result)) {
              accept(patch, result);
              continue;
            }
          }
          if (!Object.keys(patch).length) continue;
          if (prepareSave.current) await prepareSave.current(patch);
          attempted = true;
          const result = await api.invoke('config.update', patch);
          accept(patch, result);
        } catch (e) {
          let uncertain = unconfirmed.current !== null;
          if (attempted) {
            try {
              const result = await readConfirmed();
              if (matches(patch, result)) {
                accept(patch, result);
                continue;
              }
            } catch {
              if (confirmedRevision.current > revision && matches(patch, confirmed.current)) {
                accept(patch, confirmed.current!);
                continue;
              }
              uncertain = true;
            }
          }
          pending.current = { ...patch, ...pending.current };
          unconfirmed.current = uncertain ? patch : null;
          failure.current = errorMessage(e);
          setError(failure.current);
          setStatus(uncertain ? 'unconfirmed' : 'error');
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
  }, [api, readConfirmed]);
  useEffect(() => {
    if (!config || (configRevision !== undefined && configRevision < confirmedRevision.current))
      return;
    confirmed.current = config;
    confirmedRevision.current = configRevision ?? confirmedRevision.current;
    if (unconfirmed.current !== null && matches(unconfirmed.current, config)) {
      for (const key of Object.keys(unconfirmed.current) as Array<keyof PublicConfig>) {
        if (JSON.stringify(pending.current[key]) === JSON.stringify(unconfirmed.current[key]))
          delete pending.current[key];
        if (
          !(key in pending.current) &&
          JSON.stringify(overrides.current[key]) === JSON.stringify(unconfirmed.current[key])
        )
          delete overrides.current[key];
      }
      unconfirmed.current = null;
      failure.current = null;
      setError(null);
      setStatus(Object.keys(pending.current).length ? 'pending' : 'saved');
      if (Object.keys(pending.current).length && !running.current) void flush();
    }
    latest.current = { ...config, ...overrides.current };
    setDraft(latest.current);
  }, [config, configRevision, flush]);
  const change = useCallback(
    (patch: Partial<PublicConfig>, delay = 0) => {
      if (!latest.current) return;
      const changed = Object.entries(patch).filter(
        ([key, value]) =>
          JSON.stringify(latest.current![key as keyof PublicConfig]) !== JSON.stringify(value),
      );
      if (!changed.length) return;
      for (const [key] of changed) {
        const field = key as keyof PublicConfig;
        edits.current[field] = (edits.current[field] ?? 0) + 1;
      }
      const update = Object.fromEntries(changed) as Partial<PublicConfig>;
      Object.assign(pending.current, update);
      Object.assign(overrides.current, update);
      latest.current = { ...latest.current, ...update };
      setDraft(latest.current);
      setStatus('pending');
      failure.current = null;
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
    // Invalidate asynchronous field suggestions before waiting for an active save.
    discarded.current++;
    setDiscarded(discarded.current);
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) await running.current;
    if (unconfirmed.current !== null) {
      try {
        await readConfirmed();
        unconfirmed.current = null;
      } catch (e) {
        unconfirmed.current = {};
        failure.current = errorMessage(e);
        setError(failure.current);
      }
    }
    pending.current = {};
    overrides.current = {};
    latest.current = confirmed.current;
    setDraft(confirmed.current);
    if (unconfirmed.current === null) {
      failure.current = null;
      setError(null);
    }
    setStatus(unconfirmed.current === null ? 'saved' : 'unconfirmed');
  }, [readConfirmed]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const flushPending = useCallback(() => {
    if (running.current) return running.current;
    return failure.current !== null ? Promise.resolve(false) : flush();
  }, [flush]);
  const capture = useCallback((...keys: Array<keyof PublicConfig>) => {
    const generation = discarded.current;
    const revisions = keys.map((key) => edits.current[key]);
    return () =>
      generation === discarded.current &&
      keys.every((key, index) => edits.current[key] === revisions[index]);
  }, []);
  return {
    draft,
    confirmed: confirmed.current,
    status,
    error,
    change,
    flush,
    flushPending,
    discard,
    capture,
  };
}
