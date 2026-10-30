import { describe, expect, it } from 'vitest';
import type { AppEvent, Player, Session } from '@ba/contracts';
import {
  currentRosterKey,
  previousRosterKey,
  emptyRosterQueries,
  updateRosterQueries,
} from '@ba/shared';

const players: Player[] = [
  { id: '1', name: 'First', teamId: 0 },
  { id: '2', name: 'Second', teamId: 0 },
];
const session: Session = {
  generation: 1,
  phase: 'lobby',
  localName: '',
  localPlayerId: null,
  accountKey: '',
  loginSeen: false,
  localDeck: '',
  lobbyId: 'room-a',
  lobbyPlayers: players,
  current: null,
  recovering: false,
};
const sourceKey = currentRosterKey(session);
const start = (requestId: string, key = sourceKey): AppEvent => ({
  type: 'rosterQuery',
  context: 'current',
  requestId,
  sourceKey: key,
  pendingIds: players.map((player) => player.id),
  revision: 1,
});
const result = (requestId: string, index = 0, key = sourceKey): AppEvent => ({
  type: 'roster',
  context: 'current',
  generation: 1,
  requestId,
  sourceKey: key,
  player: players[index]!,
  info: {
    elo: 2100,
    kd: null,
    winRate: null,
    matchCount: null,
    category: null,
    topUnits: '',
    stale: false,
    updatedAt: 1000,
  },
  error: null,
  revision: 2,
});

describe('room query ownership and progress', () => {
  it('associates retry timing with its current request and clears it on a new query', () => {
    let state = updateRosterQueries(emptyRosterQueries(), start('first'));
    const retry: AppEvent = {
      type: 'rosterRetry',
      context: 'current',
      requestId: 'first',
      sourceKey,
      retryAt: 5000,
      revision: 3,
    };
    state = updateRosterQueries(state, retry);
    expect(state.current.retryAt).toBe(5000);
    state = updateRosterQueries(state, start('manual'));
    expect(state.current.retryAt).toBeNull();
    expect(updateRosterQueries(state, retry)).toBe(state);
  });
  it('cancels a retry without losing rows and rejects retry metadata from an old room', () => {
    let state = updateRosterQueries(
      updateRosterQueries(emptyRosterQueries(), start('first')),
      result('first'),
    );
    const retry: AppEvent = {
      type: 'rosterRetry',
      context: 'current',
      requestId: 'first',
      sourceKey,
      retryAt: 5000,
      revision: 3,
    };
    state = updateRosterQueries(updateRosterQueries(state, retry), { ...retry, retryAt: null });
    expect(state.current.rows['1']?.info?.elo).toBe(2100);
    expect(state.current.retryAt).toBeNull();
    state = updateRosterQueries(state, {
      type: 'session',
      session: { ...session, lobbyId: 'new' },
      revision: 4,
    });
    expect(updateRosterQueries(state, retry)).toBe(state);
  });
  it('keeps completed values during a same-room refresh and settles each pending player', () => {
    let state = updateRosterQueries(emptyRosterQueries(), start('first'));
    state = updateRosterQueries(updateRosterQueries(state, result('first')), result('first', 1));
    state = updateRosterQueries(state, start('refresh'));
    expect(state.current.pendingIds).toEqual(['1', '2']);
    expect(Object.keys(state.current.rows)).toEqual(['1', '2']);
    state = updateRosterQueries(state, result('refresh'));
    expect(state.current.pendingIds).toEqual(['2']);
    state = updateRosterQueries(state, {
      ...result('refresh', 1),
      info: null,
      error: 'Offline',
    } as AppEvent);
    expect(state.current.pendingIds).toEqual([]);
    expect(state.current.rows['2']).toMatchObject({ info: null, error: 'Offline' });
  });
  for (const next of [
    { ...session, generation: 2 },
    { ...session, lobbyId: 'room-b' },
    { ...session, lobbyPlayers: players.slice(0, 1) },
  ]) {
    it(`clears retained values and ignores late results after ${currentRosterKey(next)}`, () => {
      let state = updateRosterQueries(
        updateRosterQueries(emptyRosterQueries(), start('old')),
        result('old'),
      );
      state = updateRosterQueries(state, { type: 'session', session: next, revision: 3 });
      expect(state.current.rows).toEqual({});
      expect(state.current.pendingIds).toEqual([]);
      expect(updateRosterQueries(state, result('old', 1))).toBe(state);
    });
  }
  it('ignores superseded requests and duplicate completions', () => {
    const state = updateRosterQueries(
      updateRosterQueries(emptyRosterQueries(), start('old')),
      start('new'),
    );
    expect(updateRosterQueries(state, result('old'))).toBe(state);
    const completed = updateRosterQueries(state, result('new'));
    expect(updateRosterQueries(completed, result('new'))).toBe(completed);
  });
  it('keys player membership independently of order and names but separates previous matches', () => {
    expect(
      currentRosterKey({
        ...session,
        lobbyPlayers: [...players].reverse().map((p) => ({ ...p, name: 'Renamed' })),
      }),
    ).toBe(sourceKey);
    expect(previousRosterKey('1', players)).not.toBe(previousRosterKey('2', players));
    expect(previousRosterKey('1', players)).not.toBe(previousRosterKey('1', players.slice(0, 1)));
  });
});
