// @vitest-environment jsdom
import { StrictMode, useEffect } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge, MaggotReport } from '@ba/contracts';
import { summarizeMaggot } from '@ba/shared';
import { useMaggotRequests } from '../apps/web/src/hooks/useMaggotRequests';

function deferred() {
  let resolve!: (value: MaggotReport) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MaggotReport>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function bridge(invoke: ReturnType<typeof vi.fn>): Bridge {
  return { invoke: invoke as Bridge['invoke'], subscribe: () => () => {} };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('automatic Maggot Index requests', () => {
  it('deduplicates Strict Mode effects and simultaneous views of the same player', async () => {
    const pending = deferred();
    const invoke = vi.fn(() => pending.promise);
    const api = bridge(invoke);
    const { result } = renderHook(
      () => {
        const requests = useMaggotRequests(api);
        useEffect(() => {
          void requests.runMaggot('1');
        }, [requests.runMaggot]);
        return requests;
      },
      { wrapper: StrictMode },
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    let duplicate!: Promise<void>;
    act(() => {
      duplicate = result.current.runMaggot('1');
    });
    await act(async () => {
      pending.resolve(summarizeMaggot('1', []));
      await duplicate;
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.maggot['1']?.status).toBe('success');
  });

  it('continues queued players after a failure and only retries when requested', async () => {
    const first = deferred();
    const invoke = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation((_method, { id }) => Promise.resolve(summarizeMaggot(id, [])));
    const api = bridge(invoke);
    const { result } = renderHook(() => useMaggotRequests(api));
    let queued!: Promise<void>;
    act(() => {
      void result.current.runMaggot('1');
      queued = result.current.runMaggot('2');
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(result.current.maggot['2']?.status).toBe('queued');
    await act(async () => {
      first.reject(new Error('Offline'));
      await queued;
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.current.maggot['1']?.error).toBe('Offline');
    expect(result.current.maggot['2']?.data?.id).toBe('2');
    await act(async () => {
      await result.current.runMaggot('1', true);
    });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(result.current.maggot['1']?.error).toBeNull();
  });

  it('reuses recent results, recalculates after expiry, and refreshes cached results', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const invoke = vi.fn((_method, { id }) => Promise.resolve(summarizeMaggot(id, [])));
    const api = bridge(invoke);
    const { result } = renderHook(() => useMaggotRequests(api));
    await act(async () => {
      await result.current.runMaggot('1');
    });
    await act(async () => {
      await result.current.runMaggot('1');
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    now += 5 * 60_000;
    await act(async () => {
      await result.current.runMaggot('1');
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.runMaggot('1', true);
    });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(new Set(invoke.mock.calls.map(([, input]) => input.requestId)).size).toBe(3);
  });

  it('schedules one fresh calculation when refreshed during an automatic request', async () => {
    const first = deferred();
    const fresh = deferred();
    const invoke = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(fresh.promise);
    const api = bridge(invoke);
    const { result } = renderHook(() => useMaggotRequests(api));
    let refresh!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      void result.current.runMaggot('1');
      refresh = result.current.runMaggot('1', true);
      duplicate = result.current.runMaggot('1', true);
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve(summarizeMaggot('1', []));
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await act(async () => {
      fresh.resolve(summarizeMaggot('1', [], 2));
      await Promise.all([refresh, duplicate]);
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.current.maggot['1']?.data?.calls).toBe(2);
  });
});
