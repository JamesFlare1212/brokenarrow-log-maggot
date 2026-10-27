import {
  DIAGNOSTIC_ERROR_TYPES,
  diagnosticFrames,
  type Bridge,
  type DiagnosticErrorType,
} from '@ba/contracts';

export function diagnosticErrorType(error: unknown): DiagnosticErrorType {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
  return DIAGNOSTIC_ERROR_TYPES.find((value) => value === name) ?? 'Error';
}

export function reportRendererError(
  api: Bridge,
  error: unknown,
  source: 'renderer' | 'renderer_rejection' | 'react',
): void {
  void api
    .invoke('diagnostics.report', {
      type: 'error',
      source,
      errorType: diagnosticErrorType(error),
      frames: diagnosticFrames(
        error && typeof error === 'object' && 'stack' in error ? error.stack : undefined,
      ),
    })
    .catch(() => {});
}

export function attachRendererDiagnostics(api: Bridge): () => void {
  const view = window,
    rendererDocument = view.document;
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const onError = (event: ErrorEvent) => reportRendererError(api, event.error, 'renderer');
  const onRejection = (event: PromiseRejectionEvent) =>
    reportRendererError(api, event.reason, 'renderer_rejection');
  view.addEventListener('error', onError);
  view.addEventListener('unhandledrejection', onRejection);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    view.removeEventListener('error', onError);
    view.removeEventListener('unhandledrejection', onRejection);
    view.removeEventListener('pagehide', dispose);
    cleanups.forEach((cleanup) => cleanup());
  };
  view.addEventListener('pagehide', dispose, { once: true });
  const sendStartup = (durationMs: number) => {
    if (Number.isFinite(durationMs) && durationMs >= 0)
      void api
        .invoke('diagnostics.report', {
          type: 'performance',
          metric: 'renderer_startup',
          durationMs: Math.min(600000, durationMs),
        })
        .catch(() => {});
  };
  let ready = false;
  const checkReady = () => {
    if (disposed || ready || !rendererDocument.querySelector('[data-ready="true"]')) return;
    ready = true;
    readiness.disconnect();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!disposed) sendStartup(performance.now());
      }),
    );
  };
  const readiness = new MutationObserver(checkReady);
  readiness.observe(rendererDocument.documentElement, { childList: true, subtree: true });
  checkReady();
  cleanups.push(() => readiness.disconnect());
  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    const aggregate = new LongTaskAggregate();
    const isForeground = () =>
      rendererDocument.visibilityState === 'visible' && rendererDocument.hasFocus();
    let activeSince = isForeground() ? performance.now() : Infinity;
    const reset = () => {
      aggregate.flush();
      activeSince = isForeground() ? performance.now() : Infinity;
    };
    rendererDocument.addEventListener('visibilitychange', reset);
    view.addEventListener('focus', reset);
    view.addEventListener('blur', reset);
    const flush = () => {
      const sample = aggregate.flush();
      if (sample && !disposed && isForeground())
        void api.invoke('diagnostics.report', { type: 'long_tasks', ...sample }).catch(() => {});
    };
    const observer = new PerformanceObserver((list) => {
      if (disposed || !isForeground()) return;
      aggregate.add(
        list
          .getEntries()
          .filter((entry) => entry.startTime >= activeSince)
          .map((entry) => entry.duration),
      );
    });
    observer.observe({ type: 'longtask' });
    const timer = setInterval(flush, 60000);
    cleanups.push(() => {
      observer.disconnect();
      clearInterval(timer);
      rendererDocument.removeEventListener('visibilitychange', reset);
      view.removeEventListener('focus', reset);
      view.removeEventListener('blur', reset);
    });
  }
  return dispose;
}

export class LongTaskAggregate {
  private count = 0;
  private totalMs = 0;
  private maxMs = 0;
  private blockingMs = 0;
  private at = performance.now();
  add(durations: number[]): void {
    for (const duration of durations) {
      if (!Number.isFinite(duration) || duration < 50 || this.count >= 100000) continue;
      const value = Math.min(600000, duration);
      this.count++;
      this.totalMs = Math.min(3600000, this.totalMs + value);
      this.maxMs = Math.max(this.maxMs, value);
      this.blockingMs = Math.min(3600000, this.blockingMs + value - 50);
    }
  }
  flush() {
    const now = performance.now();
    const result = this.count
      ? {
          count: this.count,
          totalMs: this.totalMs,
          maxMs: this.maxMs,
          blockingMs: this.blockingMs,
          windowMs: Math.min(3600000, Math.max(1, now - this.at)),
        }
      : null;
    this.count = this.totalMs = this.maxMs = this.blockingMs = 0;
    this.at = now;
    return result;
  }
}
