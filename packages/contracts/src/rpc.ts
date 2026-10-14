import { z } from 'zod';
import type {
  Account,
  ApmState,
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
  Usage,
  WatcherStatus,
  DeckSwitchAlert,
} from './models';
export const PANELS = [
  'current',
  'players',
  'apm',
  'archive',
  'replays',
  'decks',
  'bans',
  'about',
] as const;
export const THEMES = ['dark', 'light', 'cyan', 'orange', 'violet', 'forest', 'ocean'] as const;
export const configSchema = z.object({
  logDir: z.string().max(4096).default(''),
  decksDir: z.string().max(4096).default(''),
  autoQueryCurrentMatch: z.boolean().default(true),
  inputHookEnabled: z.boolean().default(false),
  banPollEnabled: z.boolean().default(true),
  matchSyncEnabled: z.boolean().default(true),
  banCardVisible: z.boolean().default(false),
  multiAccountBond: z.boolean().default(true),
  theme: z.enum(THEMES).default('dark'),
  lang: z.enum(['zh', 'en', 'ja', 'ru']).default('zh'),
  panelOrder: z.array(z.enum(PANELS)).default([...PANELS]),
  collapsedPanels: z.array(z.enum(PANELS)).default(['decks']),
  replayEnabled: z.boolean().default(false),
  replayDisplayId: z.string().max(256).default(''),
  replayQuality: z
    .union([z.literal(240), z.literal(360), z.literal(480), z.literal(720), z.literal(1080)])
    .default(720),
  replayFps: z.number().int().min(30).max(60).default(30),
  replayBitrateMbps: z.number().int().min(3).max(10).default(5),
  replayAudio: z.enum(['default', 'off']).default('default'),
  replaySaveDir: z.string().max(4096).default(''),
});
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
  'app.bootstrap': empty,
  'config.update': configSchema.partial().strict(),
  'directory.select': z.object({ kind: z.enum(['logs', 'replays', 'decks']) }),
  'directory.detect': empty,
  'players.search': z.object({ query: z.string().trim().min(1).max(200) }),
  'players.report': z.object({ id }),
  'players.maggot': z.object({ id, requestId: z.string().uuid() }),
  'players.profile': z.object({ id, force: z.boolean().default(false) }),
  'session.query': z.object({
    requestId: z.string().uuid(),
    context: z.enum(['current', 'previous']),
    players: roster.optional(),
    fid: id.optional(),
  }),
  'matches.list': z.object({ accountId: id.optional() }),
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
  'app.bootstrap': Bootstrap;
  'config.update': PublicConfig;
  'directory.select': string | null;
  'directory.detect': string;
  'players.search': { players: SearchPlayer[]; source: 'network' | 'cache' | 'local' | 'stale' };
  'players.report': PlayerReport;
  'players.maggot': MaggotReport;
  'players.profile': PlayerProfile;
  'session.query': { requestId: string; queried: number; skipped: number; cancelled: boolean };
  'matches.list': Match[];
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
  | { type: 'config'; config: PublicConfig }
  | { type: 'session'; session: Session }
  | { type: 'watcher'; watcher: WatcherStatus }
  | { type: 'usage'; usage: Usage }
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
  | { type: 'apm'; apm: ApmState }
  | { type: 'decks'; alert: DeckSwitchAlert | null }
  | { type: 'health'; health: ApiHealth }
  | { type: 'gate'; state: 'open' | 'done' | 'cancelled' }
  | { type: 'error'; message: string }
) & { revision: number };
export interface Bridge {
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
