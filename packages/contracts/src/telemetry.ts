export const TELEMETRY_CONSENT_VERSION = 3;
export const TELEMETRY_FEATURES = [
  'current',
  'radar',
  'players',
  'apm',
  'archive',
  'replays',
  'decks',
  'bans',
  'settings',
] as const;
export type TelemetryFeature = (typeof TELEMETRY_FEATURES)[number];
export const DIAGNOSTIC_ERROR_TYPES = [
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'NetworkError',
] as const;
export type DiagnosticErrorType = (typeof DIAGNOSTIC_ERROR_TYPES)[number];
export interface DiagnosticFrame {
  filename: string;
  lineno: number;
  colno: number;
  chunk_id?: string;
}
export interface TelemetryRuntimeSample {
  foreground: boolean;
  active: boolean;
  renderer_cpu_percent?: number;
  renderer_rss_mb?: number;
  renderer_processes?: number;
}
const appModules = new Set([
  'main.cjs',
  'index.cjs',
  'app.ts',
  'client.ts',
  'analyzer.ts',
  'tracker.ts',
  'files.ts',
  'service.ts',
  'watcher.ts',
  'parser.ts',
  'controller.ts',
  'apm.ts',
]);
export function isDiagnosticFilename(value: string): boolean {
  return (
    appModules.has(value) || /^[A-Za-z][A-Za-z0-9_-]{0,64}-[A-Za-z0-9_-]{6,32}\.js$/.test(value)
  );
}
/** Retain only public app module names and code positions, never paths or messages. */
export function diagnosticFrames(stack: unknown): DiagnosticFrame[] {
  if (typeof stack !== 'string') return [];
  const frames = stack
    .split('\n')
    .slice(1, 31)
    .flatMap((line) => {
      const match = /[\\/]([^\\/():]+\.(?:ts|cjs|js)):(\d+):(\d+)\)?$/.exec(line.trim());
      if (!match || !isDiagnosticFilename(match[1]!)) return [];
      const lineno = Number(match[2]),
        colno = Number(match[3]);
      return lineno > 0 && lineno <= 10000000 && colno > 0 && colno <= 10000000
        ? [{ filename: match[1]!, lineno, colno }]
        : [];
    })
    .slice(0, 8);
  const chunks = (globalThis as { _posthogChunkIds?: Record<string, string> })._posthogChunkIds;
  if (chunks && typeof chunks === 'object') {
    for (const [trace, id] of Object.entries(chunks).slice(0, 500)) {
      if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) continue;
      const owner = trace
        .split('\n')
        .slice(1)
        .map((line) => /[\\/]([^\\/():]+\.(?:ts|cjs|js)):(\d+):(\d+)\)?$/.exec(line.trim()))
        .find((match) => match && isDiagnosticFilename(match[1]!));
      for (const frame of frames)
        if (frame.filename === owner?.[1]) (frame as DiagnosticFrame).chunk_id = id;
    }
  }
  return frames;
}
export function hasTelemetryConsent(config: {
  telemetryEnabled: boolean;
  telemetryConsentConfirmed: boolean;
  telemetryConsentVersion: number;
}): boolean {
  return (
    config.telemetryConsentConfirmed &&
    (!config.telemetryEnabled || config.telemetryConsentVersion >= TELEMETRY_CONSENT_VERSION)
  );
}
