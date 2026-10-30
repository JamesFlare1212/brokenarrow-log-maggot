import { useCallback, useRef, useState } from 'react';
import type { Bridge, CacheClearMode, CacheStats } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

type CacheOutcome =
  { kind: 'success'; removed: number } | { kind: 'uncertain' | 'failed'; error: string };
interface CacheState {
  data: CacheStats | null;
  current: boolean;
  reading: boolean;
  error: string | null;
  operation: { mode: CacheClearMode; phase: 'confirming' | 'clearing' | 'reconciling' } | null;
  outcome: CacheOutcome | null;
}

export function useCacheManagement(api: Bridge) {
  const [state, setState] = useState<CacheState>({
    data: null,
    current: false,
    reading: false,
    error: null,
    operation: null,
    outcome: null,
  });
  const running = useRef<Promise<void> | null>(null);
  const read = useCallback(async () => {
    setState((current) => ({ ...current, reading: true, error: null }));
    try {
      const data = await api.invoke('cache.stats', null);
      setState((current) => ({ ...current, data, current: true }));
    } catch (error) {
      setState((current) => ({ ...current, current: false, error: errorMessage(error) }));
    } finally {
      setState((current) => ({ ...current, reading: false }));
    }
  }, [api]);
  const refresh = useCallback(() => {
    if (running.current) return running.current;
    const task = Promise.resolve()
      .then(read)
      .finally(() => {
        running.current = null;
      });
    running.current = task;
    return task;
  }, [read]);
  const clear = useCallback(
    (mode: CacheClearMode, approve?: () => Promise<boolean>) => {
      if (running.current) return running.current;
      const task = Promise.resolve()
        .then(async () => {
          if (approve) {
            setState((current) => ({ ...current, operation: { mode, phase: 'confirming' } }));
            if (!(await approve())) return;
          }
          setState((current) => ({
            ...current,
            error: null,
            outcome: null,
            operation: { mode, phase: 'clearing' },
          }));
          try {
            const result = await api.invoke('cache.clear', { mode });
            setState((current) => ({
              ...current,
              data: result.stats,
              current: true,
              outcome: { kind: 'success', removed: result.removed },
            }));
          } catch (error) {
            setState((current) => ({
              ...current,
              current: false,
              outcome: { kind: 'uncertain', error: errorMessage(error) },
              operation: { mode, phase: 'reconciling' },
            }));
            await read();
          }
        })
        .catch((error) => {
          setState((current) => ({
            ...current,
            outcome: { kind: 'failed', error: errorMessage(error) },
          }));
        })
        .finally(() => {
          running.current = null;
          setState((current) => ({ ...current, operation: null }));
        });
      running.current = task;
      return task;
    },
    [api, read],
  );
  return { ...state, refresh, clear, busy: state.reading || state.operation !== null };
}
