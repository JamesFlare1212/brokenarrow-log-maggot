import { useCallback, useRef, useState } from 'react';
import type { Bridge } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export function useRecordingPreference(api: Bridge) {
  const busy = useRef(false);
  const failureRef = useRef<{ enabled: boolean; message: string } | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const [pending, setPending] = useState(false),
    [requested, setRequested] = useState<boolean | null>(null),
    [failure, setFailure] = useState<{ enabled: boolean; message: string } | null>(null),
    [captureError, setCaptureError] = useState<string | null>(null),
    [stopped, setStopped] = useState(false);
  const change = useCallback(
    async (enabled: boolean, stopSessionId?: string) => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      setRequested(enabled);
      failureRef.current = null;
      setFailure(null);
      setCaptureError(null);
      setStopped(false);
      let settle!: () => void;
      running.current = new Promise<void>((resolve) => {
        settle = resolve;
      });
      let saved = false;
      try {
        await api.invoke('config.update', { replayEnabled: enabled });
        saved = true;
        if (stopSessionId) {
          await api.invoke('replays.stop', { sessionId: stopSessionId });
          setStopped(true);
        }
        return true;
      } catch (error) {
        if (saved) setCaptureError(errorMessage(error));
        else {
          failureRef.current = { enabled, message: errorMessage(error) };
          setFailure(failureRef.current);
        }
        return saved;
      } finally {
        busy.current = false;
        setPending(false);
        setRequested(null);
        running.current = null;
        settle();
      }
    },
    [api],
  );
  const settle = useCallback(async () => {
    await running.current;
  }, []);
  const flush = useCallback(async () => {
    if (running.current) {
      await running.current;
      return !failureRef.current;
    }
    return failureRef.current ? change(failureRef.current.enabled) : true;
  }, [change]);
  const discard = useCallback(() => {
    failureRef.current = null;
    setFailure(null);
  }, []);
  return { pending, requested, failure, captureError, stopped, change, discard, flush, settle };
}
