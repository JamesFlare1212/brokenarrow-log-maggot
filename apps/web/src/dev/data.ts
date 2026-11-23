import type {
  Account,
  Ban,
  Bootstrap,
  Bridge,
  CacheStats,
  DeckList,
  Match,
  PlayerReport,
  Replay,
} from '@ba/contracts';
import { emptyMatch, emptyPlayer } from '@ba/shared';

export const developmentPreview = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#152522"/><path d="M0 80H640M0 160H640M0 240H640M0 320H640M80 0V360M160 0V360M240 0V360M320 0V360M400 0V360M480 0V360M560 0V360" stroke="#263c35"/><path d="M0 280Q200 80 640 200" fill="none" stroke="#376171" stroke-width="45"/><g fill="#60a5fa"><circle cx="160" cy="130" r="10"/><circle cx="215" cy="245" r="10"/><circle cx="290" cy="140" r="10"/></g><g fill="#fb7185"><circle cx="440" cy="85" r="10"/><circle cx="470" cy="240" r="10"/><circle cx="530" cy="150" r="10"/></g><text x="24" y="36" fill="#ecfdf5" font-family="sans-serif" font-size="18">Broken Arrow · Development preview</text></svg>')}`;

export interface DevelopmentData {
  bootstrap: Bootstrap;
  matches: Match[];
  reports: Record<string, PlayerReport>;
  accounts: Account[];
  bans: Ban[];
  replays: Replay[];
  decks: DeckList;
  cache: CacheStats;
}

const numericId = /^\d{1,32}$/;

function isCompleteFiveVsFive(match: Match): boolean {
  const players = match.players;
  return (
    match.endedAt !== null &&
    match.fid !== null &&
    numericId.test(match.fid) &&
    players.length === 10 &&
    players.every((p) => numericId.test(p.id) && p.name.trim()) &&
    new Set(players.map((p) => p.id)).size === 10 &&
    players.filter((p) => p.teamId === 0).length === 5 &&
    players.filter((p) => p.teamId === 1).length === 5
  );
}

function selectSeed(matches: Match[], accountIds: (string | null)[]) {
  const candidates = matches.filter(isCompleteFiveVsFive);
  for (const id of new Set(accountIds)) {
    if (!id) continue;
    const includesLocal = (m: Match) => m.players.some((p) => p.id === id);
    const match =
      candidates.find((m) => m.localPlayerId === id && includesLocal(m)) ??
      candidates.find(includesLocal);
    if (match) return { match, localPlayerId: id };
  }
  const match =
    candidates.find((m) => m.players.some((p) => p.id === m.localPlayerId)) ?? candidates[0];
  if (!match) return null;
  const localPlayerId = match.players.find((p) => p.id === match.localPlayerId)?.id ?? null;
  return { match, localPlayerId };
}

function resetScene(base: Bootstrap, empty: boolean): DevelopmentData {
  const bootstrap = structuredClone(base);
  bootstrap.revision = 0;
  bootstrap.config = {
    ...bootstrap.config,
    analyticsEnabled: false,
    analyticsChoiceSaved: true,
    autoQueryCurrentMatch: !empty,
    replayEnabled: !empty,
    hiddenPanels: [],
  };
  bootstrap.session = {
    generation: 1,
    phase: 'idle',
    localName: '',
    localPlayerId: null,
    accountKey: '',
    loginSeen: false,
    localDeck: '',
    lobbyId: '',
    lobbyPlayers: [],
    current: null,
    recovering: false,
  };
  if (empty) {
    bootstrap.activeAccountId = null;
    bootstrap.health = { state: 'unknown', at: 0, checks: [] };
  }
  bootstrap.watcher = {
    dir: bootstrap.config.logDir,
    file: null,
    listening: false,
    recovering: false,
    error: null,
    live: false,
  };
  bootstrap.recording = {
    phase: 'idle',
    sessionId: null,
    fid: null,
    map: '',
    sourceId: '',
    startedAt: null,
    seconds: 0,
    hasAudio: false,
    error: null,
  };
  bootstrap.deckAlert = null;
  return {
    bootstrap,
    matches: [],
    reports: {},
    accounts: [],
    bans: [],
    replays: [],
    decks: { found: false, decksDir: '', backupsDir: '', decks: [], backups: [] },
    cache: {
      api: { entries: 0, expired: 0, bytes: 0 },
      snapshots: { entries: 0, expired: 0, bytes: 0 },
    },
  };
}

export async function loadDevelopmentData(
  base: Bridge,
  bootstrap: Bootstrap,
  empty: boolean,
  now: number,
): Promise<DevelopmentData> {
  const scene = resetScene(bootstrap, empty);
  if (empty) return scene;

  [scene.matches, scene.accounts, scene.bans, scene.decks, scene.replays, scene.cache] =
    structuredClone(
      await Promise.all([
        base.invoke('matches.list', {}),
        base.invoke('accounts.list', null),
        base.invoke('bans.list', { metOnly: false }),
        base.invoke('decks.list', null),
        base.invoke('replays.list', null),
        base.invoke('cache.stats', null),
      ]),
    );
  const seed = selectSeed(scene.matches, [
    bootstrap.activeAccountId,
    bootstrap.session.localPlayerId,
    ...scene.accounts.map((account) => account.id),
  ]);
  if (!seed) return scene;

  const { match, localPlayerId } = seed;
  const local = match.players.find((p) => p.id === localPlayerId);
  const sameAccount = !!local && local.id === match.localPlayerId;
  const localName = (sameAccount && match.localPersona) || local?.name || '';
  const current: Match = {
    ...emptyMatch(match.id, now),
    fid: match.fid,
    sessionId: match.sessionId,
    map: match.map,
    mapId: match.mapId,
    scenario: match.scenario,
    mode: match.mode,
    source: match.source,
    localPlayerId,
    localPersona: localName,
    localDeck: sameAccount ? match.localDeck : '',
    eloBefore: local?.oldRating ?? null,
    players: match.players.map(({ id, name, teamId, oldRating }) => ({
      ...emptyPlayer(id, name),
      teamId,
      oldRating,
    })),
  };
  const lobbyOrder = (p: Match['players'][number]) =>
    p.id === localPlayerId ? 0 : p.teamId === (local?.teamId ?? 0) ? 1 : 2;
  scene.bootstrap.session = {
    ...scene.bootstrap.session,
    phase: 'match',
    localName,
    localPlayerId,
    accountKey: localName ? 'persona:' + localName : '',
    loginSeen: !!local,
    localDeck: current.localDeck,
    lobbyPlayers: [...current.players]
      .sort((a, b) => lobbyOrder(a) - lobbyOrder(b))
      .map(({ id, name, teamId }) => ({ id, name, teamId })),
    current,
  };
  scene.bootstrap.activeAccountId = localPlayerId ?? bootstrap.activeAccountId;
  scene.bootstrap.watcher = { ...scene.bootstrap.watcher, listening: true, live: true };

  await Promise.allSettled(
    current.players.map(async ({ id }) => {
      const report = await base.invoke('players.report', { id });
      if (report.id === id) scene.reports[id] = structuredClone(report);
    }),
  );
  return scene;
}
