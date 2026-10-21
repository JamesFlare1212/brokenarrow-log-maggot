import { z } from 'zod';
import configuration from '../../../app.config.json';

const milliseconds = z.number().int().nonnegative().max(2147483647);
const duration = milliseconds.positive();
const count = z.number().int().positive().safe();

export const projectConfigSchema = z.strictObject({
  network: z.strictObject({
    requestOffsetMs: milliseconds,
    requestTimeoutMs: duration,
    maxAttempts: count,
    retryDelayMs: milliseconds,
  }),
  cache: z.strictObject({
    ttlMs: z.strictObject({
      player: duration,
      playerMatches: duration,
      match: duration,
      search: duration,
      bans: duration,
      units: duration,
    }),
    maxApiEntries: count,
    maxPlayerSnapshots: count,
  }),
  background: z.strictObject({
    archiveScanIntervalMs: duration,
    syncIntervalMs: duration,
    healthProbeIntervalMs: duration,
  }),
  queries: z.strictObject({
    maxRoomPlayers: count.max(100),
  }),
});

export const projectConfig = projectConfigSchema.parse(configuration);
export type NetworkConfig = z.infer<typeof projectConfigSchema>['network'];
