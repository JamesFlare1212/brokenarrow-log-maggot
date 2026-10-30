import { useCallback, useRef, useState } from 'react';
import type { Bridge, PlayerReport } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export type ReportSection = 'matches' | 'maps';
export function hasReportSection(report: PlayerReport | null | undefined, section: ReportSection) {
  return !!report && !report.fallback && report.detailAvailability?.[section] !== false;
}
export interface PlayerReportRequest {
  pending: boolean;
  data: PlayerReport | null;
  error: string | null;
  failedAt: number | null;
  details: Record<ReportSection, PlayerReport | null>;
}
const emptyRequest = (): PlayerReportRequest => ({
  pending: false,
  data: null,
  error: null,
  failedAt: null,
  details: { matches: null, maps: null },
});

export function usePlayerReports(api: Bridge) {
  const [reports, setReports] = useState<Record<string, PlayerReportRequest>>({});
  const current = useRef<Record<string, PlayerReportRequest>>({});
  const pending = useRef(
    new Map<string, { token: number; force: boolean; promise: Promise<PlayerReport | null> }>(),
  );
  const generation = useRef(0);
  const publish = (id: string, request: PlayerReportRequest) => {
    current.current = { ...current.current, [id]: request };
    setReports(current.current);
  };
  const loadReport = useCallback(
    (id: string, force = false): Promise<PlayerReport | null> => {
      const active = pending.current.get(id);
      if (active && (!force || active.force)) return active.promise;
      const token = ++generation.current;
      const previous = current.current[id] ?? emptyRequest();
      publish(id, { ...previous, pending: true });
      const promise = Promise.resolve().then(async () => {
        try {
          const data = await api.invoke('players.report', { id, force });
          if (data.id !== id) throw new Error('REPORT_ID_MISMATCH');
          if (pending.current.get(id)?.token !== token) return null;
          const latest = current.current[id] ?? previous;
          const stillPrevious =
            !!latest.failedAt &&
            !force &&
            data.updatedAt <= Math.max(latest.failedAt, latest.data?.updatedAt ?? 0);
          publish(id, {
            pending: false,
            data,
            error: stillPrevious ? latest.error : null,
            failedAt: stillPrevious ? latest.failedAt : null,
            details: {
              matches: hasReportSection(data, 'matches') ? data : latest.details.matches,
              maps: hasReportSection(data, 'maps') ? data : latest.details.maps,
            },
          });
          return data;
        } catch (error) {
          if (pending.current.get(id)?.token === token)
            publish(id, {
              ...(current.current[id] ?? previous),
              pending: false,
              error: errorMessage(error),
              failedAt: Date.now(),
            });
          return null;
        } finally {
          if (pending.current.get(id)?.token === token) pending.current.delete(id);
        }
      });
      pending.current.set(id, { token, force, promise });
      return promise;
    },
    [api],
  );
  return { reports, loadReport };
}
