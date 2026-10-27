// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '@ba/contracts';
import { diagnosticFrames } from '@ba/contracts';
import { attachRendererDiagnostics, reportRendererError } from '../apps/web/src/app/diagnostics';
const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  window.dispatchEvent(new Event('pagehide'));
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('renderer diagnostic capture boundaries', () => {
  it('waits for the real application readiness marker before reporting startup', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const api = { invoke, subscribe: () => () => {} } as Bridge;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    cleanups.push(attachRendererDiagnostics(api));
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    const app = document.createElement('div');
    app.dataset.ready = 'true';
    document.body.append(app);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledWith('diagnostics.report', {
      type: 'performance',
      metric: 'renderer_startup',
      durationMs: expect.any(Number),
    });
    app.append(document.createElement('span'));
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('forwards only public app code locations, never local paths or error messages', () => {
    const stack =
      'TypeError: private account\n    at fn (file:///C:/Users/Private/app-hashAB12.js:7:9)\n    at fn (file:///C:/Users/Private/secret.js:8:10)';
    const invoke = vi.fn().mockResolvedValue(null);
    const api = { invoke, subscribe: () => () => {} } as Bridge;
    const error = new TypeError('private account');
    error.stack = stack;
    reportRendererError(api, error, 'react');
    expect(diagnosticFrames(stack)).toEqual([
      {
        filename: 'app-hashAB12.js',
        lineno: 7,
        colno: 9,
      },
    ]);
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(
      /Private|private account|secret\.js|file:\/\//,
    );
  });
  it('drops hidden and blurred long tasks, delayed entries from earlier focus, and pending work on disposal', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible',
      focused = true;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
    let callback!: PerformanceObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        static supportedEntryTypes = ['longtask'];
        constructor(onEntries: PerformanceObserverCallback) {
          callback = onEntries;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const emit = (duration: number, startTime = performance.now()) =>
      callback(
        { getEntries: () => [{ duration, startTime }] } as PerformanceObserverEntryList,
        {} as PerformanceObserver,
      );
    const invoke = vi.fn().mockResolvedValue(null);
    cleanups.push(attachRendererDiagnostics({ invoke, subscribe: () => () => {} } as Bridge));
    emit(80);
    await vi.advanceTimersByTimeAsync(100);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    emit(500);
    await vi.advanceTimersByTimeAsync(100);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    emit(1000, 50);
    emit(120);
    await vi.advanceTimersByTimeAsync(60000);
    const reports = () => invoke.mock.calls.filter(([, payload]) => payload.type === 'long_tasks');
    expect(reports()).toHaveLength(1);
    expect(reports()[0]![1]).toMatchObject({ count: 1, totalMs: 120, maxMs: 120, blockingMs: 70 });
    emit(400);
    focused = false;
    window.dispatchEvent(new Event('blur'));
    emit(500);
    await vi.advanceTimersByTimeAsync(60000);
    expect(reports()).toHaveLength(1);
    focused = true;
    window.dispatchEvent(new Event('focus'));
    emit(90);
    cleanups.pop()!();
    emit(900);
    await vi.advanceTimersByTimeAsync(60000);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(reports()).toHaveLength(1);
  });
});
