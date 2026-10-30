import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bridge, WatcherStatus } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export function useLogMonitoring(api: Bridge, watcher: WatcherStatus | undefined) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<Promise<WatcherStatus | null> | null>(null);
  useEffect(() => {
    if (watcher?.checkedAt && !watcher.error) setError(null);
  }, [watcher?.checkedAt]);
  const refresh = useCallback(() => {
    if (running.current) return running.current;
    setPending(true);
    setError(null);
    const operation = api
      .invoke('logs.refresh', null)
      .catch((failure) => {
        setError(errorMessage(failure));
        return null;
      })
      .finally(() => {
        running.current = null;
        setPending(false);
      });
    running.current = operation;
    return operation;
  }, [api]);
  return { pending, error, refresh };
}
