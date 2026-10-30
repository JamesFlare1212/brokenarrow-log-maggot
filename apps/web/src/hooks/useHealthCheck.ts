import { useCallback, useRef, useState } from 'react';
import type { ApiHealth } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

const unknownHealth: ApiHealth = { state: 'unknown', at: 0, checks: [] };

export function useHealthCheck(health = unknownHealth, onCheck?: () => Promise<ApiHealth>) {
  const running = useRef<Promise<void> | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; at: number } | null>(null);
  const [result, setResult] = useState<ApiHealth | null>(null);
  const current = result && result.at >= health.at ? result : health;
  const check = useCallback(() => {
    if (running.current) return running.current;
    if (!onCheck) return Promise.resolve();
    setPending(true);
    setFailure(null);
    const task = Promise.resolve()
      .then(onCheck)
      .then(setResult)
      .catch((error) => {
        setFailure({ message: errorMessage(error), at: Date.now() });
      })
      .finally(() => {
        running.current = null;
        setPending(false);
      });
    running.current = task;
    return task;
  }, [onCheck]);
  return { current, pending, failure, check, canCheck: !!onCheck };
}

export type HealthCheckRequest = ReturnType<typeof useHealthCheck>;
