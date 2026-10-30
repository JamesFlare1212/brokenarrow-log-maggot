import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { BanAlertBatch, Bridge } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export interface BanAlertsValue {
  alerts: BanAlertBatch[];
  activeIds: string[];
  available: boolean;
  pending: Set<string>;
  errors: Record<string, string>;
  acknowledge: (id: string) => Promise<boolean>;
}

export const BanAlertsContext = createContext<BanAlertsValue | null>(null);

export function useBanAlertAcknowledgements(api: Bridge, alerts: BanAlertBatch[] | undefined) {
  const [pending, setPending] = useState(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const running = useRef(new Map<string, Promise<boolean>>());
  const current = useRef(alerts);
  current.current = alerts;
  useEffect(() => {
    const ids = new Set(alerts?.map((alert) => alert.id));
    setErrors((previous) => {
      const next = Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id)));
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  }, [alerts]);
  const acknowledge = useCallback(
    (id: string) => {
      const existing = running.current.get(id);
      if (existing) return existing;
      if (!current.current?.some((alert) => alert.id === id)) return Promise.resolve(true);
      setPending((previous) => new Set(previous).add(id));
      const operation = api
        .invoke('bans.acknowledgeAlerts', { ids: [id] })
        .then(() => true)
        .catch((error) => {
          if (!current.current?.some((alert) => alert.id === id)) return true;
          setErrors((previous) => ({ ...previous, [id]: errorMessage(error) }));
          return false;
        })
        .finally(() => {
          running.current.delete(id);
          setPending((previous) => {
            const next = new Set(previous);
            next.delete(id);
            return next;
          });
        });
      running.current.set(id, operation);
      return operation;
    },
    [api],
  );
  return { pending, errors, acknowledge };
}
