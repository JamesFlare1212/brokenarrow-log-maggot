import { app, powerMonitor, type BrowserWindow } from 'electron';
import type { AnalyticsRuntimeSample } from '@ba/contracts';

/** Capture aggregate resources and foreground/activity gates, never titles or input details. */
export function sampleAnalyticsRuntime(window: BrowserWindow | null): AnalyticsRuntimeSample {
  const foreground =
    !!window &&
    !window.isDestroyed() &&
    window.isVisible() &&
    !window.isMinimized() &&
    window.isFocused();
  const result: AnalyticsRuntimeSample = {
    foreground,
    active: foreground && powerMonitor.getSystemIdleTime() < 60,
  };
  const renderers = app.getAppMetrics().filter((process) => process.type === 'Tab');
  result.renderer_processes = renderers.length;
  result.renderer_cpu_percent = renderers.reduce(
    (total, process) => total + Math.max(0, process.cpu.percentCPUUsage),
    0,
  );
  result.renderer_rss_mb =
    renderers.reduce((total, process) => total + Math.max(0, process.memory.workingSetSize), 0) /
    1024;
  return result;
}
