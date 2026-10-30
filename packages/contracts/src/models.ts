import type { RecordingQuality } from './recording';

export type Id = string;
export type Metric = number | null;
export type TeamId = 0 | 1 | 100 | null;
export type Outcome = 'win' | 'loss' | 'spectator' | 'unknown';
export type Mode = 'ranked' | 'custom' | 'unknown';
export type Locale = 'zh' | 'en';
export type Theme = 'dark' | 'light' | 'cyan' | 'orange' | 'violet' | 'forest' | 'ocean';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorScheme = Exclude<Theme, 'light'>;
export type Panel = 'current' | 'radar' | 'players' | 'archive' | 'replays' | 'decks' | 'bans';
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
  warningCode?: 'batrace-cache';
  titles?: Record<Id, import('./titles').MatchTitle[]>;
  scoreLabels?: Record<Id, import('./score-labels').MatchScoreLabel[]>;
  scoreLabelRule?: 'team-maximum' | 'match-maximum-single';
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
  checkedAt?: number | null;
  checking?: boolean;
}
export interface MiniInfo {
  name?: string;
  elo: Metric;
  kd: Metric;
  winRate: Metric;
  matchCount: Metric;
  sampleCount?: Metric;
  fallback?: boolean;
  category: string | null;
  topUnits: string;
  updatedAt: number;
  stale: boolean;
}
export interface RosterResult {
  player: Player;
  info: MiniInfo | null;
  error: string | null;
}
export interface RosterQuery {
  requestId: string;
  sourceKey: string;
  retryAt: number | null;
  pendingIds: string[];
  rows: Record<string, RosterResult>;
}
export type RosterQueries = Record<'current' | 'previous', RosterQuery>;
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
  matchCount: Metric;
  sampleCount: Metric;
  elo: Metric;
  kd: Metric;
  dmr: Metric;
  winRate: Metric;
  wins: Metric;
  losses: Metric;
  updatedAt: number;
  stale: boolean;
  detailAvailability?: { matches: boolean; maps: boolean };
  analysisError?: string | null;
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
export interface HistoryMatchSummary {
  id: string;
  fid: string | null;
  map: string;
  at: number | null;
  accounts: Array<{ id: string; name: string }>;
}
export interface HistoryDeletePlan {
  token: string;
  kind: 'account' | 'match';
  target: { id: string; name: string };
  removed: HistoryMatchSummary[];
  retained: HistoryMatchSummary[];
  affectedAccounts: Array<{ id: string; name: string }>;
  backupDirectory: string;
  backupName: string;
}
export interface HistoryBackup {
  name: string;
  version: string;
  createdAt: number;
  kind: 'account' | 'match';
  target: { id: string; name: string };
  matchCount: number;
  restoredAt: number | null;
}
export interface HistoryDeleteResult {
  removed: boolean;
  removedMatches: number;
  retainedMatches: number;
  backup: HistoryBackup;
}
export interface NameRecord {
  name: string;
  firstSeen: number;
  lastSeen: number;
}
export interface Encounter {
  accountId?: Id | null;
  accountName?: string | null;
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
  lastEncounterAt?: number | null;
  unverifiedObservation?: boolean;
}
export interface BanAlertBatch {
  id: string;
  createdAt: number;
  players: Ban[];
}
export interface BanSyncStatus {
  phase: 'idle' | 'syncing' | 'success' | 'error';
  attemptId: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  error: string | null;
}
export interface PlayerProfile {
  encounterScope?: {
    accountId: Id | null;
    accountName: string | null;
    combined: boolean;
    unattributedCount: number;
  };
  unverifiedObservation?: boolean;
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
  failure?: 'http' | 'blocked' | 'timeout' | 'invalid-response' | 'network';
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
export interface DeckOperationResult {
  completed: string[];
  failed: Array<{ name: string; message: string }>;
  skipped: string[];
}
export interface DeckRestorePlan {
  token: string;
  directory: string;
  name: string;
  files: string[];
  replacements: string[];
}
export interface DeckRestoreResult extends DeckOperationResult {
  deployed: number;
  recoveryBackup: string | null;
}
export interface DeckSwitchAlert {
  pair: string;
  from: string;
  to: string;
  count: number;
  names: string[];
  fid: Id | null;
  directory: string;
  version: string;
  toKey: string;
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
  dateSource: 'recording' | 'modified';
  durationSec: Metric;
  test: boolean;
}
export interface ReplayLibrary {
  directory: string;
  recordings: Replay[];
  migration?: ReplayMoveResult | null;
}
export interface ReplayMoveResult {
  createdAt: number;
  from: string;
  to: string;
  directory: string;
  committed: boolean;
  moved: number;
  copied: string[];
  retained: string[];
  destinationCopies: string[];
  failed: Array<{ name: string; message: string }>;
}
export interface ReplayDeletePlan {
  token: string;
  directory: string;
  createdAt: number;
  days: number | null;
  recordings: Replay[];
}
export interface ReplayDeleteResult {
  directory: string;
  removed: number;
  completed: string[];
  failed: Array<{ name: string; message: string }>;
  skipped: string[];
}
export interface Display {
  id: string;
  label: string;
  thumbnail: string;
}
export interface DisplayChoice {
  id: string;
  displayId: string;
  label: string;
}
export interface RecordingDisplayTarget {
  requestedId: string;
  sourceId: string | null;
  label: string | null;
  selection: 'selected' | 'automatic' | 'fallback' | 'unavailable';
}
export interface DisplayPreview extends RecordingDisplayTarget {
  thumbnail: string | null;
  displays: DisplayChoice[];
}
export interface RecordingState {
  phase: 'idle' | 'starting' | 'recording' | 'stopping' | 'error';
  sessionId: string | null;
  fid: Id | null;
  map: string;
  sourceId: string;
  display?: RecordingDisplayTarget;
  startedAt: number | null;
  seconds: number;
  hasAudio: boolean;
  audio?: import('./recording').RecordingAudioState;
  lastSavedName?: string;
  audioRetryPending?: boolean;
  audioRetryError?: string | null;
  error: string | null;
  failure?: {
    kind: 'start' | 'capture' | 'save' | 'metadata';
    discarded: boolean;
    savedName?: string;
  } | null;
}
export interface MigrationStatus {
  completed: boolean;
  imported: Record<string, number>;
  warnings: string[];
  backupDir: string | null;
}
export interface PublicConfig {
  analyticsEnabled: boolean;
  analyticsChoiceSaved: boolean;
  logDir: string;
  decksDir: string;
  autoQueryCurrentMatch: boolean;
  banPollEnabled: boolean;
  matchSyncEnabled: boolean;
  banCardVisible: boolean;
  multiAccountBond: boolean;
  theme: Theme;
  themeMode: ThemeMode;
  lightTheme?: ColorScheme;
  darkTheme?: ColorScheme;
  eloColorScheme: 'green-up' | 'red-up';
  glassOpacity: number;
  sidebarCollapsed: boolean;
  lang: Locale;
  panelOrder: Panel[];
  hiddenPanels: Panel[];
  collapsedPanels: Panel[];
  replayEnabled: boolean;
  replayDisplayId: string;
  replayQuality: RecordingQuality;
  replayFps: number;
  replayBitrateMbps: number;
  replayAudio: 'default' | 'off';
  replayMicrophone: boolean;
  replaySaveDir: string;
}
export interface Bootstrap {
  rosters?: RosterQueries;
  banSync: BanSyncStatus;
  banAlerts: BanAlertBatch[];
  updates: import('./updates').UpdateState;
  revision: number;
  config: PublicConfig;
  session: Session;
  watcher: WatcherStatus;
  recording: RecordingState;
  health: ApiHealth;
  version: VersionInfo;
  migration: MigrationStatus;
  deckAlert: DeckSwitchAlert | null;
}
