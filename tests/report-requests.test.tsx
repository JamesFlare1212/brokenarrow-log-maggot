// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge, PlayerReport } from '@ba/contracts';
import { summarizeMaggot } from '@ba/shared';
import { usePlayerReports } from '../apps/web/src/hooks/usePlayerReports';
import { useMaggotRequests } from '../apps/web/src/hooks/useMaggotRequests';
import { reportFixture } from './fixtures/ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const bridge = (invoke: (method: string, input: unknown) => unknown): Bridge => ({
  invoke: invoke as Bridge['invoke'],
  subscribe: () => () => {},
});
const report = (overrides: Partial<PlayerReport> = {}) =>
  reportFixture({ id: '1', updatedAt: 1000, ...overrides });
describe('shared player report ownership', () => {
  it('deduplicates readers and prevents an earlier ordinary result overwriting a forced refresh', async () => {
    const ordinary = deferred<PlayerReport>(),
      forced = deferred<PlayerReport>();
    const invoke = vi.fn((_method: string, input: unknown) =>
      (input as { force: boolean }).force ? forced.promise : ordinary.promise,
    );
    const api = bridge(invoke);
    const { result } = renderHook(() => usePlayerReports(api));
    const newer = report({ elo: 1800, updatedAt: 3000 });
    let first!: Promise<PlayerReport | null>,
      second!: Promise<PlayerReport | null>,
      refresh!: Promise<PlayerReport | null>;
    await act(async () => {
      first = result.current.loadReport('1');
      second = result.current.loadReport('1');
    });
    expect(first).toBe(second);
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      refresh = result.current.loadReport('1', true);
    });
    await act(async () => {
      forced.resolve(newer);
      await refresh;
    });
    await act(async () => {
      ordinary.resolve(report({ elo: 1500 }));
      await first;
    });
    expect(result.current.reports['1']).toMatchObject({ pending: false, data: newer, error: null });
  });
  it.each([1000, 2000, 5000])(
    'retains the last result timestamped %s after failure until fresh evidence is obtained',
    async (previousAt) => {
      let mode: 'old' | 'fail' | 'new' = 'old';
      vi.spyOn(Date, 'now').mockReturnValue(2000);
      const api = bridge(async () => {
        if (mode === 'fail') throw new Error('Report outage');
        return report({
          elo: mode === 'new' ? 1800 : 1501,
          updatedAt: mode === 'new' ? 6000 : previousAt,
        });
      });
      const { result } = renderHook(() => usePlayerReports(api));
      await act(async () => {
        await result.current.loadReport('1');
      });
      mode = 'fail';
      await act(async () => {
        await result.current.loadReport('1', true);
      });
      expect(result.current.reports['1']).toMatchObject({
        data: { elo: 1501 },
        error: 'Report outage',
        failedAt: 2000,
      });
      mode = 'old';
      await act(async () => {
        await result.current.loadReport('1');
      });
      expect(result.current.reports['1']!.error).toBe('Report outage');
      mode = 'new';
      await act(async () => {
        await result.current.loadReport('1', true);
      });
      expect(result.current.reports['1']).toMatchObject({
        data: { elo: 1800 },
        error: null,
        failedAt: null,
      });
    },
  );
  it('retains independently available detailed sections through basic and partial updates', async () => {
    let next = report();
    const original = next;
    const api = bridge(async () => next),
      { result } = renderHook(() => usePlayerReports(api));
    await act(async () => {
      await result.current.loadReport('1');
    });
    next = report({ fallback: true, elo: 1700, updatedAt: 2000, recentMatches: [], mapStats: [] });
    await act(async () => {
      await result.current.loadReport('1', true);
    });
    expect(result.current.reports['1']).toMatchObject({
      data: { fallback: true, elo: 1700 },
      details: { matches: original, maps: original },
    });
    next = report({
      updatedAt: 3000,
      detailAvailability: { matches: true, maps: false },
      mapStats: [],
    });
    await act(async () => {
      await result.current.loadReport('1', true);
    });
    expect(result.current.reports['1']!.details.matches).toEqual(next);
    expect(result.current.reports['1']!.details.maps).toEqual(original);
  });
  it('isolates player identities and catches synchronously thrown bridge failures', async () => {
    const api = bridge((_method, input) => {
      const id = (input as { id: string }).id;
      if (id === '2') throw new Error('Synchronous IPC failure');
      return Promise.resolve(report());
    });
    const { result } = renderHook(() => usePlayerReports(api));
    await act(async () => {
      await Promise.all([result.current.loadReport('1'), result.current.loadReport('2')]);
    });
    expect(result.current.reports['1']).toMatchObject({ data: { id: '1' }, error: null });
    expect(result.current.reports['2']).toMatchObject({
      data: null,
      pending: false,
      error: 'Synchronous IPC failure',
    });
  });
  it('rejects a report for the wrong player without replacing the previous result', async () => {
    let next = report();
    const api = bridge(async () => next);
    const { result } = renderHook(() => usePlayerReports(api));
    await act(async () => {
      await result.current.loadReport('1');
    });
    next = report({ id: '2', elo: 9999 });
    await act(async () => {
      await result.current.loadReport('1', true);
    });
    expect(result.current.reports['1']).toMatchObject({
      data: { id: '1' },
      error: 'REPORT_ID_MISMATCH',
    });
  });
});

describe('retained Maggot Index recovery', () => {
  it('keeps the prior score and sample after failure and permits an ordinary retry', async () => {
    const rows = (rank: number) =>
      Array.from({ length: 12 }, (_, index) => ({
        matchId: String(index + 1),
        won: true,
        mvpRank: rank,
        killRank: rank,
        lossRank: rank,
        kdRank: rank,
        eloDelta: 20,
      }));
    const first = summarizeMaggot('1', rows(2)),
      last = summarizeMaggot('1', rows(8));
    let mode: 'first' | 'fail' | 'last' = 'first';
    const invoke = vi.fn(async () => {
      if (mode === 'fail') throw new Error('Index outage');
      return mode === 'first' ? first : last;
    });
    const api = bridge(invoke),
      { result } = renderHook(() => useMaggotRequests(api));
    await act(async () => {
      await result.current.runMaggot('1');
    });
    const at = result.current.maggot['1']!.updatedAt;
    mode = 'fail';
    await act(async () => {
      await result.current.runMaggot('1', true);
    });
    expect(result.current.maggot['1']).toMatchObject({
      status: 'error',
      data: first,
      error: 'Index outage',
      updatedAt: at,
    });
    mode = 'last';
    await act(async () => {
      await result.current.runMaggot('1');
    });
    expect(result.current.maggot['1']).toMatchObject({
      status: 'success',
      data: last,
      error: null,
    });
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
