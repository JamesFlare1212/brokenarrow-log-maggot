import { useCallback, useEffect, useRef, useState } from 'react';
import type { BanSyncStatus, Bridge } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export function useBanSynchronization(api: Bridge, status: BanSyncStatus | undefined) {
  const latest = useRef(status);
  latest.current = status;
  const running = useRef<Promise<boolean> | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{
    attemptId: string | null;
    joined: boolean;
    message: string;
  } | null>(null);
  const synchronize = useCallback(() => {
    if (running.current) return running.current;
    const before = latest.current;
    setPending(true);
    setFailure(null);
    const operation = Promise.resolve()
      .then(() => api.invoke('bans.sync', null))
      .then(() => true)
      .catch((error) => {
        setFailure({
          attemptId: before?.attemptId ?? null,
          joined: before?.phase === 'syncing',
          message: errorMessage(error),
        });
        return false;
      })
      .finally(() => {
        running.current = null;
        setPending(false);
      });
    running.current = operation;
    return operation;
  }, [api]);
  const recovered =
    status?.phase === 'success' && (status.attemptId !== failure?.attemptId || failure?.joined);
  useEffect(() => {
    if (failure && recovered) setFailure(null);
  }, [failure, recovered]);
  return {
    pending: pending || status?.phase === 'syncing',
    error: failure && !recovered ? failure.message : null,
    synchronize,
  };
}
