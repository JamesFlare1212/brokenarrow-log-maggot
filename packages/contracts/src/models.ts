export type Id = string;
export type Metric = number | null;
export type TeamId = 0 | 1 | 100 | null;
export type Outcome = 'win' | 'loss' | 'spectator' | 'unknown';
export type Mode = 'ranked' | 'custom' | 'unknown';
export type Locale = 'zh' | 'en' | 'ja' | 'ru';
export type Theme = 'dark' | 'light' | 'cyan' | 'orange' | 'violet' | 'forest' | 'ocean';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorScheme = Exclude<Theme, 'light'>;
export type Panel =
  'current' | 'radar' | 'players' | 'apm' | 'archive' | 'replays' | 'decks' | 'bans';
export interface Player {
  id: Id;
  name: string;
  teamId: TeamId;
}
export interface MatchPlayer extends Player {
  oldRating: Metric;
  newRating: Metric;
  destructionScore: Metric;
  lossesScore: Metric;
  objectivesCaptured: Metric;
  killed: Metric;
  damageDealt: Metric;
  damageReceived: Metric;
  dlRatio: Metric;
  supplyPoints: Metric;
  exp: Metric;
  medals: Metric;
}
export interface Match {
  id: Id;
  fid: Id | null;
  sessionId: string;
  mapId: number | null;
  map: string;
  scenario: string;
  startedAt: number | null;
  endedAt: number | null;
  durationSec: Metric;
  durationSource: 'log' | 'api' | 'estimated' | null;
  localDeck: string;
  points: Metric;
  players: MatchPlayer[];
  mode: Mode;
  winnerTeamId: 0 | 1 | null;
  localPlayerId: Id | null;
  localPersona: string;
  outcome: Outcome;
  eloBefore: Metric;
  eloAfter: Metric;
  restarted: boolean;
  source: 'log' | 'api' | 'legacy';
  updatedAt: number;
  warning?: string;
}
export interface Session {
  generation: number;
  phase: 'idle' | 'lobby' | 'match';
  localName: string;
  localPlayerId: Id | null;
  accountKey: string;
  loginSeen: boolean;
  localDeck: string;
  lobbyId: string;
  lobbyPlayers: Player[];
  current: Match | null;
  recovering: boolean;
}
export interface WatcherStatus {
  dir: string;
  file: string | null;
  listening: boolean;
  recovering: boolean;
  error: string | null;
  live?: boolean;
}
export interface MiniInfo {
  name?: string;
  elo: Metric;
  kd: Metric;
  winRate: Metric;
  matchCount: number;
  sampleCount?: number;
  fallback?: boolean;
  category: string | null;
  topUnits: string;
  updatedAt: number;
  stale: boolean;
}
export interface SearchPlayer {
  id: Id;
  name: string;
  level: Metric;
  rating: Metric;
}
export interface PlayerReport {
  id: Id;
  name: string;
  level: Metric;
  fallback: boolean;
  matchCount: number;
  sampleCount: number;
  elo: Metric;
  kd: Metric;
  dmr: Metric;
  winRate: Metric;
  wins: number;
  losses: number;
  updatedAt: number;
  stale: boolean;
  recentMatches: Array<{
    matchId: Id;
    won: boolean | null;
    eloDelta: Metric;
    kd: Metric;
    dmr: Metric;
    destruction: Metric;
    losses: Metric;
    objectives: Metric;
    endTime: number | null;
  }>;
  favUnits: Array<{ name: string; value: Metric; spawn: Metric; roi: Metric }>;
  categories: Array<{ key: string; pct: Metric }>;
  mapStats: Array<{ mapId: number | null; name: string; matchCount: number; winRate: Metric }>;
  style: string | null;
}
export interface MaggotRow {
  matchId: Id;
  won: boolean | null;
  mvpRank: number;
  killRank: Metric;
  lossRank: Metric;
  kdRank: Metric;
  eloDelta: Metric;
}
export interface MaggotReport {
  id: Id;
  complete: boolean;
  index: Metric;
  averageRank: Metric;
  trend: 'up' | 'down' | 'flat';
  rows: MaggotRow[];
  calls: number;
  warning: string | null;
}
export interface Account {
  id: Id;
  name: string;
  persona: string;
  firstSeen: number;
  lastSeen: number;
  matchCount: number;
}
export interface NameRecord {
  name: string;
  firstSeen: number;
  lastSeen: number;
}
export interface Encounter {
  matchId: Id;
  at: number | null;
  map: string;
  relation: 'same' | 'opponent' | 'spectator' | 'unknown';
  won: boolean | null;
  custom: boolean;
}
export interface Ban {
  id: Id;
  name: string;
  steamId: string;
  rating: Metric;
  firstSeenAt: number;
  lastSeenAt: number;
  encountered: boolean;
}
export interface PlayerProfile {
  id: Id;
  name: string;
  names: NameRecord[];
  firstSeen: number | null;
  lastSeen: number | null;
  encounters: Encounter[];
  banned: Ban | null;
  recentMatches: Match[];
  recentError: string | null;
  latestElo: Metric;
  info: MiniInfo | null;
}
export interface ApiHealthCheck {
  path: string;
  ok: boolean;
  ms: number;
  status: number | null;
  failure?: 'http' | 'blocked' | 'verification' | 'timeout' | 'invalid-response' | 'network';
  rayId?: string;
}
export interface ApiHealth {
  state: 'unknown' | 'ok' | 'partial' | 'down';
  at: number;
  checks: Array<ApiHealthCheck & { fallback?: ApiHealthCheck }>;
}
export interface VersionInfo {
  current: string;
}
export interface ApmState {
  status: 'disabled' | 'unavailable' | 'replay' | 'active' | 'complete' | 'idle';
  totalActions: number;
  durationSec: number;
  apm: number;
  peak: number;
  perMinute: number[];
  focused: boolean;
  fid: Id | null;
}
export interface DeckFile {
  name: string;
  size: number;
  modifiedAt: number;
}
export interface DeckList {
  found: boolean;
  decksDir: string;
  backupsDir: string;
  decks: DeckFile[];
  backups: DeckFile[];
}
export interface DeckSwitchAlert {
  pair: string;
  from: string;
  to: string;
  count: number;
  names: string[];
  fid: Id | null;
}
export interface Replay {
  id: string;
  fid: Id | null;
  map: string;
  uploaderId: Id | null;
  uploaderName: string;
  teamId: TeamId;
  size: number;
  createdAt: number;
  durationSec: Metric;
  test: boolean;
}
export interface Display {
  id: string;
  label: string;
  thumbnail: string;
}
export interface RecordingState {
  phase: 'idle' | 'starting' | 'recording' | 'stopping' | 'error';
  sessionId: string | null;
  fid: Id | null;
  map: string;
  sourceId: string;
  startedAt: number | null;
  seconds: number;
  hasAudio: boolean;
  error: string | null;
}
export interface MigrationStatus {
  completed: boolean;
  imported: Record<string, number>;
  warnings: string[];
  backupDir: string | null;
}
export interface PublicConfig {
  logDir: string;
  decksDir: string;
  autoQueryCurrentMatch: boolean;
  inputHookEnabled: boolean;
  banPollEnabled: boolean;
  matchSyncEnabled: boolean;
  banCardVisible: boolean;
  multiAccountBond: boolean;
  theme: Theme;
  themeMode: ThemeMode;
  lightTheme?: ColorScheme;
  darkTheme?: ColorScheme;
  sidebarCollapsed: boolean;
  lang: Locale;
  panelOrder: Panel[];
  hiddenPanels: Panel[];
  collapsedPanels: Panel[];
  replayEnabled: boolean;
  replayDisplayId: string;
  replayQuality: 240 | 360 | 480 | 720 | 1080;
  replayFps: number;
  replayBitrateMbps: number;
  replayAudio: 'default' | 'off';
  replayMicrophone: boolean;
  replaySaveDir: string;
}
export interface Bootstrap {
  updates: import('./updates').UpdateState;
  revision: number;
  config: PublicConfig;
  session: Session;
  watcher: WatcherStatus;
  recording: RecordingState;
  apm: ApmState;
  health: ApiHealth;
  version: VersionInfo;
  migration: MigrationStatus;
  deckAlert: DeckSwitchAlert | null;
}
