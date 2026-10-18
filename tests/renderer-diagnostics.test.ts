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
  it('associates chunk metadata with the injecting module rather than its import callers', () => {
    const appId = 'e2f6e7aa-a7aa-4eb4-9279-f29eb5e3f4b5',
      settingsId = 'f2f6e7aa-a7aa-4eb4-9279-f29eb5e3f4b5';
    vi.stubGlobal('_posthogChunkIds', {
      'Error\n    at inject (file:///private/app-hashAB12.js:1:1)': appId,
      'Error\n    at inject (file:///private/SettingsPage-hashAB12.js:1:1)\n    at caller (file:///private/app-hashAB12.js:2:2)':
        settingsId,
    });
    const frames = diagnosticFrames(
      'Error\n    at run (file:///private/SettingsPage-hashAB12.js:10:2)\n    at caller (file:///private/app-hashAB12.js:20:3)',
    );
    expect(frames.map((frame) => frame.chunk_id)).toEqual([settingsId, appId]);
  });

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
  it('forwards only app chunk locations and validated chunk IDs, never local paths or error messages', () => {
    const stack =
      'TypeError: private account\n    at fn (file:///C:/Users/Private/app-hashAB12.js:7:9)\n    at fn (file:///C:/Users/Private/secret.js:8:10)';
    vi.stubGlobal('_posthogChunkIds', { [stack]: 'e2f6e7aa-a7aa-4eb4-9279-f29eb5e3f4b5' });
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
        chunk_id: 'e2f6e7aa-a7aa-4eb4-9279-f29eb5e3f4b5',
      },
    ]);
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(
      /Private|private account|secret\.js|file:\/\//,
    );
  });
});
