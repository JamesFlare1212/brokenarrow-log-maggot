import { randomInt } from 'node:crypto';
import { z } from 'zod';
import {
  DIAGNOSTIC_ERROR_TYPES,
  diagnosticFrames,
  isDiagnosticFilename,
  type DiagnosticFrame,
} from '@ba/contracts';

export const MAX_PENDING_EVENTS = 200;
export const EVENT_TTL_MS = 5 * 60 * 1000;
export const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
export const APTABASE_BATCH_SIZE = 20;
export type AnalyticsEventName =
  | 'app_first_open'
  | 'app_updated'
  | 'app_started'
  | 'resource_sample'
  | 'match_started'
  | 'feature_used'
  | 'operation_completed'
  | 'app_error'
  | 'error_summary'
  | 'performance_sample'
  | 'update_state_changed'
  | 'update_outcome';
export type ErrorSource =
  | 'rpc'
  | 'background'
  | 'watcher'
  | 'recording'
  | 'apm'
  | 'update'
  | 'renderer'
  | 'renderer_rejection'
  | 'react'
  | 'renderer_crash'
  | 'main'
  | 'startup';
export interface AptabaseEvent {
  eventName: AnalyticsEventName;
  sessionId: string;
  timestamp: string;
  systemProps: {
    isDebug: boolean;
    osName: string;
    osVersion: string;
    locale: string;
    appVersion: string;
    engineName: string;
    engineVersion: string;
    sdkVersion: string;
  };
  props: Record<string, string | number>;
}
export interface PendingAnalyticsEvent {
  payload: AptabaseEvent;
  attempts: number;
  nextAttemptAt: number;
  expiresAt: number;
  delivered?: () => void;
}
/** Only anonymous update outcome metadata survives a restart. Event payloads never do. */
export interface PendingUpdateStore {
  load(): unknown;
  save(value: PendingUpdate | null): void;
}
export const versionSchema = z
  .string()
  .max(50)
  .regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
export const appVersionMarkerSchema = z
  .object({
    version: versionSchema,
    previousVersion: versionSchema.optional(),
    reported: z.boolean(),
  })
  .strict();
export type AppVersionMarker = z.infer<typeof appVersionMarkerSchema>;
export const pendingUpdateSchema = z
  .object({
    fromVersion: versionSchema,
    targetVersion: versionSchema,
    stage: z.enum(['available', 'downloading', 'downloaded', 'installing']),
  })
  .strict();
export type PendingUpdate = z.infer<typeof pendingUpdateSchema>;
/** Match the Electron SDK's timestamp plus random eight-digit anonymous session format. */
export function newSessionId(now: number): string {
  return `${Math.floor(now / 1000)}${randomInt(100000000).toString().padStart(8, '0')}`;
}
export function retryDelay(attempt: number, retryAfter: string | null, now: number): number {
  const explicit =
    retryAfter === null
      ? NaN
      : /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Date.parse(retryAfter) - now;
  if (Number.isFinite(explicit)) return Math.max(1000, Math.min(300000, explicit));
  return Math.round(
    Math.min(60000, 1000 * 2 ** Math.max(0, attempt - 1)) * (0.75 + Math.random() * 0.5),
  );
}
const errorCodes = [
  'ENOENT',
  'EACCES',
  'EPERM',
  'EIO',
  'EEXIST',
  'ENOSPC',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ABORT_ERR',
  'ERR_NETWORK',
  'ERR_INVALID_URL',
  'SQLITE_BUSY',
  'SQLITE_CORRUPT',
  'SQLITE_CONSTRAINT',
];
export function safeError(error: unknown, suppliedFrames?: DiagnosticFrame[]) {
  const value =
    error && typeof error === 'object'
      ? (error as { name?: unknown; code?: unknown; status?: unknown; stack?: unknown })
      : {};
  const frames =
    suppliedFrames
      ?.filter(
        (frame) =>
          isDiagnosticFilename(frame.filename) &&
          Number.isInteger(frame.lineno) &&
          frame.lineno > 0 &&
          Number.isInteger(frame.colno) &&
          frame.colno > 0,
      )
      .slice(0, 8) ?? diagnosticFrames(value.stack);
  return {
    type: DIAGNOSTIC_ERROR_TYPES.find((type) => type === value.name) ?? 'Error',
    code: errorCodes.find((code) => code === value.code) ?? 'UNKNOWN',
    status:
      typeof value.status === 'number' &&
      Number.isInteger(value.status) &&
      value.status >= 400 &&
      value.status <= 599
        ? value.status
        : undefined,
    frames,
  };
}
