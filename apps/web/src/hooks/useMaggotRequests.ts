import { useCallback, useRef, useState } from 'react';
import type { Bridge, MaggotReport } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

interface MaggotRequest {
  status: 'queued' | 'loading' | 'success' | 'error';
  requestId: string;
  data: MaggotReport | null;
  error: string | null;
  updatedAt: number | null;
}

const CACHE_TTL = 5 * 60_000;

export function useMaggotRequests(api: Bridge) {
  const [maggot, setMaggot] = useState<Record<string, MaggotRequest>>({});
  const pending = useRef(new Map<string, { promise: Promise<void>; force: boolean }>());
  const cache = useRef(
    new Map<string, { data: MaggotReport; updatedAt: number; failed?: boolean }>(),
  );
  const queue = useRef(Promise.resolve());

  const runMaggot = useCallback(
    (id: string, force = false): Promise<void> => {
      const active = pending.current.get(id);
      if (active)
        return force && !active.force
          ? active.promise.then(() => runMaggot(id, true))
          : active.promise;
      const cached = cache.current.get(id);
      if (!force && cached && !cached.failed && Date.now() - cached.updatedAt < CACHE_TTL)
        return Promise.resolve();

      const requestId = crypto.randomUUID();
      const previous = cached?.data ?? null;
      const update = (
        value: Omit<MaggotRequest, 'requestId' | 'updatedAt'>,
        updatedAt = cached?.updatedAt ?? null,
      ) => setMaggot((current) => ({ ...current, [id]: { ...value, requestId, updatedAt } }));
      update({ status: 'queued', data: previous, error: null });
      // The analyzer accepts one calculation at a time across all player views.
      const request = queue.current.then(async () => {
        update({ status: 'loading', data: previous, error: null });
        try {
          const data = await api.invoke('players.maggot', { id, requestId });
          const updatedAt = Date.now();
          cache.current.set(id, { data, updatedAt });
          update({ status: 'success', data, error: null }, updatedAt);
        } catch (error) {
          if (cached) cache.current.set(id, { ...cached, failed: true });
          update({ status: 'error', data: previous, error: errorMessage(error) });
        } finally {
          pending.current.delete(id);
        }
      });
      pending.current.set(id, { promise: request, force });
      queue.current = request;
      return request;
    },
    [api],
  );

  return { maggot, runMaggot };
}
