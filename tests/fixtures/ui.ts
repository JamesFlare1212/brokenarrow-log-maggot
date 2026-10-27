import { initialApmState } from '@ba/contracts';
import { resolve } from 'node:path';
import type { Bootstrap, Match, PlayerProfile, PlayerReport } from '@ba/contracts';
import { configSchema, initialUpdateState } from '@ba/contracts';
import { loadRealData, seedRealData } from '../../apps/server/src/dev/real-data';
import { BatraceClient } from '../../apps/server/src/network/client';
import { Analyzer } from '../../apps/server/src/players/analyzer';
import { Database } from '../../apps/server/src/storage/database';
import { TrackerService } from '../../apps/server/src/players/tracker';
import { seedRecordedMatchCaches } from '../../apps/server/src/dev/match-fixtures';
import { seedOfflineFixtureCaches } from '../../apps/server/src/dev/offline-fixtures';

// Load the checksum-verified capture once, using only an in-memory database and offline responses.
const { data } = await loadRealData(resolve('tests/fixtures/real'));
const captured = await (async () => {
  const db = new Database(':memory:');
  const client = new BatraceClient(
    db,
    {
      offline: true,
      fetch: async () => {
        throw new Error('UI fixtures must remain offline');
      },
    },
    '4.0.0',
  );
  try {
    seedRealData(db, data, '');
    await seedRecordedMatchCaches(db, resolve('tests/fixtures/batrace/history'));
    const originals = db.matches(data.activeAccountId!);
    await seedOfflineFixtureCaches(db, resolve('tests/fixtures/batrace/offline'), {
      playerIds: new Set(originals.flatMap((match) => match.players.map((player) => player.id))),
      matchIds: new Set(originals.flatMap((match) => (match.fid ? [match.fid] : []))),
    });
    const analyzer = new Analyzer(client, db);
    const tracker = new TrackerService(db, client, analyzer);
    const matches = tracker.list(data.activeAccountId!);
    const reports: Record<string, PlayerReport> = {};
    const profiles: Record<string, PlayerProfile> = {};
    for (const player of matches[0]!.players) {
      profiles[player.id] = await tracker.profile(player.id);
      reports[player.id] = await analyzer.report(player.id);
    }
    return {
      matches,
      accounts: db.accounts(),
      report: reports[data.activeAccountId!]!,
      reports,
      profiles,
    };
  } finally {
    await client.close();
    db.close();
  }
})();

export const capturedMatches = captured.matches;
export const capturedAccounts = captured.accounts;
export const capturedReports = captured.reports;
export const capturedProfiles = captured.profiles;
const match = capturedMatches[0]!;
export const capturedPlayers = match.players.map((player) => ({
  id: player.id,
  name: player.name,
  level: captured.reports[player.id]?.level ?? null,
  rating: player.newRating,
}));

/** Overrides describe only the edge case under test; the roster and statistics stay captured. */
export function matchFixture(overrides: Partial<Match> = {}): Match {
  return { ...structuredClone(match), ...overrides };
}

export function reportFixture(overrides: Partial<PlayerReport> = {}): PlayerReport {
  return { ...structuredClone(captured.report), ...overrides };
}

// Native lifecycle state is controlled by UI tests; ordinary game data comes from the capture.
export const fixtureBootstrap: Bootstrap = {
  updates: initialUpdateState('4.0.0'),
  revision: 0,
  config: configSchema.parse({
    ...data.preferences,
    logDir: 'test-profile/GameLogs',
    telemetryEnabled: false,
    telemetryConsentConfirmed: true,
    telemetryConsentVersion: 4,
  }),
  session: {
    generation: 1,
    phase: 'match',
    localName: capturedAccounts[0]!.name,
    localPlayerId: data.activeAccountId,
    accountKey: `persona:${capturedAccounts[0]!.persona}`,
    loginSeen: true,
    localDeck: match.localDeck,
    lobbyId: '',
    lobbyPlayers: [],
    current: matchFixture({ endedAt: null }),
    recovering: false,
  },
  watcher: {
    dir: 'test-profile/GameLogs',
    file: data.logs.at(-1)!.path,
    listening: true,
    recovering: false,
    error: null,
    live: true,
  },
  recording: {
    phase: 'idle',
    sessionId: null,
    fid: null,
    map: '',
    sourceId: '',
    startedAt: null,
    seconds: 0,
    hasAudio: false,
    error: null,
  },
  apm: initialApmState(),
  health: { state: 'ok', at: data.capturedAt, checks: [] },
  version: { current: '4.0.0' },
  migration: { completed: true, imported: {}, warnings: [], backupDir: null },
  deckAlert: null,
};
