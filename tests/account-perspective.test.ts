import { afterEach, describe, expect, it } from 'vitest';
import type { Match } from '@ba/contracts';
import { emptyMatch, emptyPlayer } from '@ba/shared';
import { Database } from '../apps/server/src/storage/database';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { TrackerService } from '../apps/server/src/players/tracker';
import { projectConfig } from '../apps/server/src/config';
import { loadRealData, seedRealData } from '../apps/server/src/dev/real-data';

const databases: Database[] = [],
  clients: BatraceClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  for (const db of databases.splice(0)) db.close();
});
function fixture(order: string[]) {
  const db = new Database(':memory:');
  databases.push(db);
  const match: Match = {
    ...emptyMatch('123'),
    fid: '123',
    source: 'log' as const,
    endedAt: 1_700_000_000_000,
    winnerTeamId: 0,
    players: [
      { ...emptyPlayer('1', 'Alpha'), teamId: 0, oldRating: 1000, newRating: 1020 },
      { ...emptyPlayer('2', 'Bravo'), teamId: 1, oldRating: 1400, newRating: 1380 },
      { ...emptyPlayer('3', 'Target'), teamId: 0 },
    ],
  };
  for (const id of order)
    db.saveMatch({
      ...match,
      localPlayerId: id,
      localPersona: id === '1' ? 'Alpha' : 'Bravo',
      outcome: id === '1' ? 'win' : 'loss',
      eloBefore: id === '1' ? 1000 : 1400,
      eloAfter: id === '1' ? 1020 : 1380,
    });
  return { db, match };
}
describe('account-scoped match and encounter evidence', () => {
  for (const order of [
    ['1', '2'],
    ['2', '1'],
  ]) {
    it.each(['cache', 'fresh', 'stale', 'fallback'] as const)(
      `${order.join(' then ')} preserves an explicit perspective through %s details`,
      async (mode) => {
        const { db } = fixture(order);
        const raw = {
          matchInfo: {
            MapId: 1,
            EndTime: 1_700_000_000,
            WinnerTeam: 0,
            Data: {
              1: { Name: 'Alpha', TeamId: 0, OldRating: 1000, NewRating: 1020 },
              2: { Name: 'Bravo', TeamId: 1, OldRating: 1400, NewRating: 1380 },
              3: { Name: 'Target', TeamId: 0 },
            },
          },
        };
        if (mode === 'cache' || mode === 'stale')
          db.saveCache('match:123', raw, mode === 'stale' ? -1 : 60_000);
        const client = new BatraceClient(
          db,
          {
            fetch: async () =>
              mode === 'fresh' ? Response.json(raw) : new Response('', { status: 403 }),
          },
          'account-test',
          Date.now,
          async () => {},
          () => 0,
          { ...projectConfig.network, requestOffsetMs: 0, maxAttempts: 1 },
        );
        clients.push(client);
        const tracker = new TrackerService(db, client, new Analyzer(client, db));
        for (const id of ['1', '2']) {
          const detail = await tracker.detail('123', mode === 'fresh', false, id);
          expect(detail).toMatchObject({
            localPlayerId: id,
            localPersona: id === '1' ? 'Alpha' : 'Bravo',
            outcome: id === '1' ? 'win' : 'loss',
            eloBefore: id === '1' ? 1000 : 1400,
            eloAfter: id === '1' ? 1020 : 1380,
          });
          expect(tracker.list(id)[0]).toMatchObject({
            localPlayerId: id,
            outcome: detail.outcome,
            eloBefore: detail.eloBefore,
            eloAfter: detail.eloAfter,
          });
        }
        expect(db.match('123')?.localPlayerId).toBe(order.at(-1));
        expect(
          db
            .accounts()
            .map((account) => account.id)
            .sort(),
        ).toEqual(['1', '2']);
        expect(db.encounters('3', { accountId: '1', combined: true })).toEqual([
          expect.objectContaining({ accountId: '1', relation: 'same', won: true }),
          expect.objectContaining({ accountId: '2', relation: 'opponent', won: false }),
        ]);
      },
    );
  }
  it('projects a known roster participant without promoting a viewed player into a local account', () => {
    const { db } = fixture(['1', '2']);
    expect(db.match('123', '3')).toMatchObject({ localPlayerId: '3', outcome: 'win' });
    expect(db.match('123', '999')).toBeNull();
    expect(
      db
        .accounts()
        .map((account) => account.id)
        .sort(),
    ).toEqual(['1', '2']);
    expect(db.encounters('3', { accountId: null, combined: false })).toEqual([]);
    expect(db.match('123')?.localPlayerId).toBe('2');
  });
  it('returns both account views for captured match facts regardless of the last saved owner', async () => {
    const { data } = await loadRealData('tests/fixtures/real');
    const db = new Database(':memory:');
    databases.push(db);
    seedRealData(db, data, '');
    const original = db.matches(data.activeAccountId!)[0]!;
    const other = original.players.find(
      (player) => player.id !== original.localPlayerId && player.teamId !== 100,
    )!;
    const target = original.players.find(
      (player) => player.id !== original.localPlayerId && player.id !== other.id,
    )!;
    const projected = db.projectMatch(original, other.id)!;
    db.saveMatch(projected, false);
    const first = db
      .encounters(target.id, { combined: true })
      .filter((row) => row.matchId === original.id);
    db.saveMatch(original, false);
    const second = db
      .encounters(target.id, { combined: true })
      .filter((row) => row.matchId === original.id);
    expect(second).toEqual(first);
    expect(first.map((row) => row.accountId).sort()).toEqual(
      [original.localPlayerId, other.id].sort(),
    );
    for (const id of [original.localPlayerId!, other.id]) {
      expect(
        db
          .encounters(target.id, { accountId: id, combined: false })
          .filter((row) => row.matchId === original.id),
      ).toEqual(first.filter((row) => row.accountId === id));
    }
  });
});
