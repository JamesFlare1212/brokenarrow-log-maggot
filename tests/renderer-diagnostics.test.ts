// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '@ba/contracts';
import { diagnosticFrames } from '@ba/contracts';
import { attachRendererDiagnostics, reportRendererError } from '../apps/web/src/app/diagnostics';
const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
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
});
