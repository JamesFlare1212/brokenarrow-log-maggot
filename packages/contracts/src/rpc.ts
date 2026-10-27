import { z } from 'zod';
import { DIAGNOSTIC_ERROR_TYPES, ANALYTICS_FEATURES, isDiagnosticFilename } from './analytics';
import { RECORDING_QUALITIES, RECORDING_FPS, RECORDING_BITRATE_MBPS } from './recording';
import type {
  Account,
  ApiHealth,
  Ban,
  Bootstrap,
  DeckList,
  Display,
  MaggotReport,
  Match,
  MiniInfo,
  Player,
  PlayerProfile,
  PlayerReport,
  PublicConfig,
  RecordingState,
  SearchPlayer,
  Session,
  ThemeMode,
  WatcherStatus,
  DeckSwitchAlert,
} from './models';
export const PANELS = [
  'current',
  'radar',
  'players',
  'archive',
  'replays',
  'decks',
  'bans',
] as const;
// Remove retired pages from saved navigation without resetting other preferences.
const panelListSchema = z
  .array(z.enum([...PANELS, 'about', 'apm']))
  .transform((panels) => panels.filter((panel) => panel !== 'about' && panel !== 'apm'));
export const THEMES = ['dark', 'light', 'cyan', 'orange', 'violet', 'forest', 'ocean'] as const;
export const THEME_MODES = ['system', 'light', 'dark'] as const;
// Keep legacy palette keys so existing installations retain their colors.
export const COLOR_SCHEMES = ['dark', 'cyan', 'orange', 'violet', 'forest', 'ocean'] as const;
export const GLASS_OPACITY = { min: 40, max: 100, step: 5, default: 50 } as const;
export function legacyThemeMode(theme: unknown): ThemeMode {
  if (theme === undefined) return 'system';
  return ['light', 'cyan', 'orange'].includes(String(theme)) ? 'light' : 'dark';
}
export const configSchema = z.object({
  analyticsEnabled: z.boolean().default(false),
  analyticsChoiceSaved: z.boolean().default(false),
  logDir: z.string().max(4096).default(''),
  decksDir: z.string().max(4096).default(''),
  autoQueryCurrentMatch: z.boolean().default(true),
  banPollEnabled: z.boolean().default(true),
  matchSyncEnabled: z.boolean().default(true),
  banCardVisible: z.boolean().default(false),
  multiAccountBond: z.boolean().default(true),
  theme: z.enum(THEMES).default('dark'),
  themeMode: z.enum(THEME_MODES).default('system'),
  lightTheme: z.enum(COLOR_SCHEMES).optional(),
  darkTheme: z.enum(COLOR_SCHEMES).optional(),
  eloColorScheme: z.enum(['green-up', 'red-up']).default('green-up'),
  glassOpacity: z
    .number()
    .int()
    .min(GLASS_OPACITY.min)
    .max(GLASS_OPACITY.max)
    .default(GLASS_OPACITY.default),
  sidebarCollapsed: z.boolean().default(false),
  lang: z.enum(['zh', 'en']).default('zh'),
  panelOrder: panelListSchema.default([...PANELS]),
  hiddenPanels: z
    .array(z.enum([...PANELS, 'apm']))
    .transform((panels) => panels.filter((panel) => panel !== 'apm'))
    .default([]),
  collapsedPanels: panelListSchema.default(['decks']),
  replayEnabled: z.boolean().default(false),
  replayDisplayId: z.string().max(256).default(''),
  replayQuality: z.literal(RECORDING_QUALITIES).default(RECORDING_QUALITIES[0]),
  replayFps: z
    .number()
    .int()
    .min(RECORDING_FPS.min)
    .max(RECORDING_FPS.max)
    .multipleOf(RECORDING_FPS.step)
    .default(RECORDING_FPS.default),
  replayBitrateMbps: z
    .number()
    .int()
    .min(RECORDING_BITRATE_MBPS.min)
    .max(RECORDING_BITRATE_MBPS.max)
    .default(RECORDING_BITRATE_MBPS.default),
  replayAudio: z.enum(['default', 'off']).default('default'),
  replayMicrophone: z.boolean().default(true),
  replaySaveDir: z.string().max(4096).default(''),
});
// Zod preserves defaults inside partial objects. Patches must validate only the
// supplied fields, or a single preference change overwrites every other setting.
const configPatchSchema: z.ZodType<Partial<PublicConfig>> = z
  .object(
    Object.fromEntries(
      Object.entries(configSchema.shape).map(([key, schema]) => [
        key,
        (schema instanceof z.ZodDefault ? schema.removeDefault() : schema).optional(),
      ]),
    ),
  )
  .strict();
const id = z.string().regex(/^\d+$/).max(32);
const name = z.string().min(1).max(255);
const empty = z.null();
const roster = z
  .array(
    z.object({
      id,
      name: z.string().max(256),
      teamId: z.union([z.literal(0), z.literal(1), z.literal(100), z.null()]),
    }),
  )
  .max(100);
export const rpcSchemas = {
  'diagnostics.report': z.discriminatedUnion('type', [
    z.object({ type: z.literal('feature'), feature: z.enum(ANALYTICS_FEATURES) }).strict(),
    z
      .object({
        type: z.literal('error'),
        source: z.enum(['renderer', 'renderer_rejection', 'react']),
        errorType: z.enum(DIAGNOSTIC_ERROR_TYPES),
        frames: z
          .array(
            z
              .object({
                filename: z.string().refine(isDiagnosticFilename),
                lineno: z.number().int().positive().max(10000000),
                colno: z.number().int().positive().max(10000000),
              })
              .strict(),
          )
          .max(8)
          .optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('performance'),
        metric: z.literal('renderer_startup'),
        durationMs: z.number().finite().min(0).max(600000),
      })
      .strict(),
    z
      .object({
        type: z.literal('long_tasks'),
        count: z.number().int().min(1).max(100000),
        totalMs: z.number().finite().min(0).max(3600000),
        maxMs: z.number().finite().min(50).max(600000),
        blockingMs: z.number().finite().min(0).max(3600000),
        windowMs: z.number().finite().min(1).max(3600000),
      })
      .strict(),
  ]),
  'updates.check': empty,
  'updates.download': empty,
  'updates.install': empty,
  'updates.openDownload': empty,
  'app.bootstrap': empty,
  'config.update': configPatchSchema,
  'cache.stats': empty,
  'cache.clear': z.object({ mode: z.enum(['expired', 'all']) }).strict(),
  'directory.select': z.object({ kind: z.enum(['logs', 'replays', 'decks']) }),
  'directory.detect': empty,
  'players.search': z.object({ query: z.string().trim().min(1).max(200) }),
  'players.report': z.object({ id, force: z.boolean().optional() }),
  'players.maggot': z.object({ id, requestId: z.string().uuid() }),
  'players.profile': z.object({ id, force: z.boolean().default(false) }),
  'session.query': z.object({
    requestId: z.string().uuid(),
    context: z.enum(['current', 'previous']),
    players: roster.optional(),
    fid: id.optional(),
  }),
  'matches.list': z.object({ accountId: id.optional() }),
  'matches.scan': empty,
  'matches.detail': z.object({ fid: id, force: z.boolean().default(false) }),
  'matches.add': z.object({ fid: id }),
  'matches.delete': z.object({ id: z.string().min(1).max(128) }),
  'bans.list': z.object({ metOnly: z.boolean().default(false) }),
  'bans.sync': empty,
  'accounts.list': empty,
  'accounts.delete': z.object({ id }),
  'decks.list': empty,
  'decks.backup': z.object({ names: z.array(name).max(2000), packageName: name }),
  'decks.deploy': z.object({ name }),
  'decks.delete': z.object({ kind: z.enum(['decks', 'backups']), names: z.array(name).max(2000) }),
  'decks.open': z.object({ kind: z.enum(['decks', 'backups']) }),
  'decks.switch': z.object({ action: z.enum(['restore', 'ignore', 'dismiss']) }),
  'replays.list': empty,
  'replays.directory': empty,
  'replays.delete': z.object({ name }),
  'replays.clean': z.object({ days: z.number().int().min(0).max(36500) }),
  'replays.open': empty,
  'replays.play': z.object({ name }),
  'replays.move': z.object({ from: z.string().min(1).max(4096), to: z.string().min(1).max(4096) }),
  'replays.test': empty,
  'displays.list': empty,
  'displays.thumbnail': z.object({ id: z.string().max(256) }),
  'api.health': z.object({ force: z.boolean().default(false) }),
  'external.open': z.object({ url: z.url().regex(/^https?:\/\//) }),
} as const;
export type RpcMethod = keyof typeof rpcSchemas;
export type RpcInputs = { [K in RpcMethod]: z.infer<(typeof rpcSchemas)[K]> };
export interface RpcOutputs {
  'diagnostics.report': null;
  'updates.check': import('./updates').UpdateState;
  'updates.download': import('./updates').UpdateState;
  'updates.install': import('./updates').UpdateState;
  'updates.openDownload': null;
  'app.bootstrap': Bootstrap;
  'config.update': PublicConfig;
  'cache.stats': import('./cache').CacheStats;
  'cache.clear': { removed: number; stats: import('./cache').CacheStats };
  'directory.select': string | null;
  'directory.detect': string;
  'players.search': { players: SearchPlayer[]; source: 'network' | 'cache' | 'local' | 'stale' };
  'players.report': PlayerReport;
  'players.maggot': MaggotReport;
  'players.profile': PlayerProfile;
  'session.query': { requestId: string; queried: number; skipped: number; cancelled: boolean };
  'matches.list': Match[];
  'matches.scan': null;
  'matches.detail': Match;
  'matches.add': Match;
  'matches.delete': { removed: boolean };
  'bans.list': Ban[];
  'bans.sync': Ban[];
  'accounts.list': Account[];
  'accounts.delete': { removedMatches: number };
  'decks.list': DeckList;
  'decks.backup': { name: string };
  'decks.deploy': { deployed: number };
  'decks.delete': { removed: number };
  'decks.open': null;
  'decks.switch': null;
  'replays.list': import('./models').Replay[];
  'replays.directory': { dir: string; count: number };
  'replays.delete': { removed: boolean };
  'replays.clean': { removed: number };
  'replays.open': null;
  'replays.play': { url: string };
  'replays.move': { moved: number; failed: string[] };
  'replays.test': null;
  'displays.list': Display[];
  'displays.thumbnail': string | null;
  'api.health': ApiHealth;
  'external.open': null;
}
export type AppEvent = (
  | { type: 'updates'; updates: import('./updates').UpdateState }
  | { type: 'config'; config: PublicConfig }
  | { type: 'session'; session: Session }
  | { type: 'watcher'; watcher: WatcherStatus }
  | {
      type: 'roster';
      requestId: string;
      context: 'current' | 'previous';
      generation: number;
      player: Player;
      info: MiniInfo | null;
      error: string | null;
    }
  | { type: 'maggot'; requestId: string; id: string; done: number; scanned: number; total: number }
  | { type: 'matches' }
  | { type: 'bans'; list: Ban[]; newly: Ban[] }
  | { type: 'recording'; recording: RecordingState }
  | { type: 'preview'; sessionId: string; dataUrl: string; hasAudio: boolean }
  | { type: 'replays' }
  | { type: 'decks'; alert: DeckSwitchAlert | null }
  | { type: 'health'; health: ApiHealth }
  | { type: 'error'; message: string }
) & { revision: number };
export const windowThemeColorsSchema = z
  .object({
    background: z.string().regex(/^#[\da-f]{6}$/i),
    foreground: z.string().regex(/^#[\da-f]{6}$/i),
  })
  .strict();
export type WindowThemeColors = z.infer<typeof windowThemeColorsSchema>;
export interface Bridge {
  setWindowTheme?(mode: 'light' | 'dark', colors?: WindowThemeColors): Promise<void>;
  invoke<K extends RpcMethod>(method: K, input: RpcInputs[K]): Promise<RpcOutputs[K]>;
  subscribe(callback: (event: AppEvent) => void): () => void;
}
export interface RecorderConfig {
  sessionId: string;
  sourceId: string;
  quality: number;
  fps: number;
  bitrateMbps: number;
  audio: 'default' | 'off';
  microphone: boolean;
}
export interface RecorderBridge {
  config(): Promise<RecorderConfig>;
  started(sessionId: string, hasAudio: boolean): Promise<void>;
  chunk(sessionId: string, sequence: number, data: ArrayBuffer): Promise<void>;
  finish(sessionId: string, durationSec: number, hasAudio: boolean): Promise<void>;
  failure(sessionId: string, error: string): Promise<void>;
  preview(sessionId: string, dataUrl: string, hasAudio: boolean): void;
  stop(callback: (discard: boolean) => void): () => void;
}
