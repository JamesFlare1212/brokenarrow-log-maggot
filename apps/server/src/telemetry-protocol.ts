import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  DIAGNOSTIC_ERROR_TYPES,
  diagnosticFrames,
  isDiagnosticFilename,
  type DiagnosticFrame,
} from '@ba/contracts';

export const TELEMETRY_APP = 'brokenarrow.desktop';
export const MAX_OUTBOX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_OUTBOX_EVENTS = 50;
export const MAX_QUEUE_EVENTS = 200;
export const TELEMETRY_BATCH_SIZE = 20;
export const TELEMETRY_EVENTS = [
  'app_installed',
  'app_updated',
  'app_started',
  'app_heartbeat',
  'user_identified',
  'match_started',
  'feature_used',
  'operation_completed',
  '$exception',
  'exception_summary',
  'performance_sample',
  'update_state_changed',
  'update_not_applied',
  'update_attempt_result',
  'previous_run_exit',
  'delivery_summary',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];
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
export interface TelemetryEnvelope {
  uuid: string;
  event: TelemetryEventName;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}
export interface QueuedTelemetryEvent {
  payload: TelemetryEnvelope;
  critical: boolean;
  attempts: number;
  nextAttemptAt: number;
  expiresAt: number;
}
export interface TelemetryPersistence {
  read(key: 'outbox' | 'run' | 'update'): unknown;
  write(key: 'outbox' | 'run' | 'update', value: unknown): void;
}
export const versionSchema = z
  .string()
  .max(80)
  .regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const runSchema = z
  .object({
    runId: z.string().uuid(),
    exitId: z.string().uuid(),
    version: versionSchema,
    startedAt: z.number().finite(),
    endedAt: z.number().finite().optional(),
    fatal: z.boolean().optional(),
  })
  .strict();
export const updateAttemptSchema = z
  .object({
    id: z.string().uuid(),
    resultId: z.string().uuid(),
    fromVersion: versionSchema,
    targetVersion: versionSchema,
    stage: z.enum(['available', 'downloading', 'downloaded', 'installing', 'error']),
    at: z.number().finite(),
    completed: z.boolean().optional(),
  })
  .strict();
export type UpdateAttempt = z.infer<typeof updateAttemptSchema>;
const envelopeSchema = z
  .object({
    uuid: z.string().uuid(),
    event: z.enum(TELEMETRY_EVENTS),
    distinct_id: hashSchema,
    timestamp: z.iso.datetime(),
    properties: z.record(z.string(), z.unknown()),
  })
  .strict();
const queuedSchema = z
  .object({
    payload: envelopeSchema,
    critical: z.literal(true),
    attempts: z.number().int().min(0).max(5),
    nextAttemptAt: z.number().finite().nonnegative(),
    expiresAt: z.number().finite().nonnegative(),
  })
  .strict();
const privateKeys = new Set([
  'message',
  'stack',
  'path',
  'name',
  'account_id',
  'player_id',
  'query',
  'url',
]);
const publicFrame = z
  .object({
    filename: z.string().refine(isDiagnosticFilename),
    lineno: z.number().int().positive().max(10000000),
    colno: z.number().int().positive().max(10000000),
    chunk_id: z.string().uuid().optional(),
    platform: z.enum(['node:javascript', 'web:javascript']),
    function: z.literal('<app>'),
    in_app: z.literal(true),
  })
  .strict();
const baseProperties = z.object({
  $process_person_profile: z.literal(false),
  app: z.literal(TELEMETRY_APP),
  version: versionSchema,
  distribution: z.enum(['installed', 'portable']),
  language: z.enum(['zh', 'en', 'ja', 'ru']),
  installation_id: hashSchema,
  app_session_id: z.string().uuid(),
  $session_id: z.string().uuid().optional(),
  identity_source: z.enum(['game_account', 'installation']),
  identity_confidence: z.enum(['confirmed', 'cached', 'installation']),
  platform: z.enum(['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32', 'android']),
  arch: z.string().regex(/^[a-z0-9_]{1,20}$/),
  telemetry_schema: z.literal(3),
});
const exceptionProperties = baseProperties
  .extend({
    source: z.enum([
      'rpc',
      'background',
      'watcher',
      'recording',
      'apm',
      'update',
      'renderer',
      'renderer_rejection',
      'react',
      'renderer_crash',
      'main',
      'startup',
    ]),
    operation: z
      .string()
      .regex(/^[a-z]+\.[A-Za-z]+$/)
      .max(80)
      .optional(),
    error_type: z.enum(DIAGNOSTIC_ERROR_TYPES),
    error_code: z.string().regex(/^(?:UNKNOWN|ABORT_ERR|E[A-Z_]{1,40}|SQLITE_[A-Z_]{1,40})$/),
    http_status: z.number().int().min(400).max(599).optional(),
    occurrences: z.number().int().positive().max(1000000000),
    $exception_level: z.enum(['fatal', 'error']),
    $exception_fingerprint: hashSchema,
    $release_id: z.string().uuid().optional(),
    $exception_list: z
      .array(
        z
          .object({
            type: z.enum(DIAGNOSTIC_ERROR_TYPES),
            value: z
              .string()
              .max(150)
              .regex(/^[A-Za-z_.]+: (?:UNKNOWN|ABORT_ERR|E[A-Z_]+|SQLITE_[A-Z_]+|HTTP [45]\d\d)$/),
            mechanism: z.object({ handled: z.boolean(), synthetic: z.literal(true) }).strict(),
            stacktrace: z
              .object({ type: z.literal('raw'), frames: z.array(publicFrame).max(8) })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();
const propertySchemas: Partial<Record<TelemetryEventName, z.ZodType>> = {
  match_started: baseProperties.strict(),
  delivery_summary: baseProperties
    .extend({
      delivery_dropped_total: z.number().int().nonnegative(),
      delivery_retried_total: z.number().int().nonnegative(),
      persistence_failures_total: z.number().int().nonnegative(),
    })
    .strict(),
  app_installed: baseProperties
    .extend({
      kind: z.enum(['first_run', 'existing_profile', 'version_change']),
      previous_version: versionSchema.optional(),
    })
    .strict(),
  app_updated: baseProperties.extend({ previous_version: versionSchema.optional() }).strict(),
  $exception: exceptionProperties,
  exception_summary: exceptionProperties,
  update_state_changed: baseProperties
    .extend({
      status: z.enum(['available', 'downloading', 'downloaded', 'installing', 'error']),
      target_version: versionSchema.nullable(),
      error_context: z.enum(['check', 'download', 'install']).nullable(),
      duration_ms: z.number().finite().nonnegative().optional(),
      update_attempt_id: z.string().uuid().optional(),
    })
    .strict(),
  update_not_applied: baseProperties.extend({ target_version: versionSchema }).strict(),
  update_attempt_result: baseProperties
    .extend({
      update_attempt_id: z.string().uuid(),
      from_version: versionSchema,
      target_version: versionSchema,
      last_stage: z.enum([
        'available',
        'downloading',
        'downloaded',
        'installing',
        'error',
        'download',
        'install',
      ]),
      outcome: z.enum(['applied', 'not_applied', 'other_version', 'interrupted', 'failed']),
    })
    .strict(),
  previous_run_exit: baseProperties
    .extend({
      previous_version: versionSchema,
      previous_run_id: z.string().uuid(),
      reason: z.enum(['exception', 'unclean_exit']),
    })
    .strict(),
};
export function restoreOutbox(
  value: unknown,
  now: number,
  installationId: string,
): QueuedTelemetryEvent[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_OUTBOX_EVENTS).flatMap((item) => {
    const parsed = queuedSchema.safeParse(item);
    if (!parsed.success) return [];
    const event = parsed.data;
    if (!propertySchemas[event.payload.event]?.safeParse(event.payload.properties).success)
      return [];
    if (
      event.expiresAt <= now ||
      event.expiresAt > now + MAX_OUTBOX_AGE_MS ||
      JSON.stringify(event).length > 16384 ||
      event.payload.properties.app !== TELEMETRY_APP ||
      event.payload.properties.installation_id !== installationId ||
      !versionSchema.safeParse(event.payload.properties.version).success ||
      Object.keys(event.payload.properties).some((key) => privateKeys.has(key))
    )
      return [];
    return [{ ...event, attempts: 0, nextAttemptAt: now }];
  });
}
/** UUIDv7 with the capture time embedded, as required by PostHog session aggregation. */
export function uuid7(timestamp = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Math.max(0, Math.min(0xffffffffffff, Math.floor(timestamp))), 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
