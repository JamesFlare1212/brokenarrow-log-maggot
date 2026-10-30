import type { AppEvent, Player, RosterQueries, RosterQuery, Session } from '@ba/contracts';

const playerKey = (players: Player[]) =>
  players
    .map((player) => [player.id, player.teamId])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

export function currentRosterKey(session: Session): string {
  return JSON.stringify([
    session.generation,
    session.phase,
    session.lobbyId,
    session.current?.sessionId,
    session.current?.fid,
    playerKey(session.current?.players ?? session.lobbyPlayers),
  ]);
}

export function previousRosterKey(fid: string | null | undefined, players: Player[]): string {
  return JSON.stringify([fid ?? null, playerKey(players)]);
}

export function emptyRosterQuery(sourceKey = ''): RosterQuery {
  return { requestId: '', sourceKey, retryAt: null, pendingIds: [], rows: {} };
}

export function emptyRosterQueries(): RosterQueries {
  return { current: emptyRosterQuery(), previous: emptyRosterQuery() };
}

export function updateRosterQueries(rosters: RosterQueries, event: AppEvent): RosterQueries {
  if (event.type === 'session') {
    const sourceKey = currentRosterKey(event.session);
    return rosters.current.sourceKey === sourceKey
      ? rosters
      : { ...rosters, current: emptyRosterQuery(sourceKey) };
  }
  if (event.type !== 'rosterQuery' && event.type !== 'roster' && event.type !== 'rosterRetry')
    return rosters;
  const old = rosters[event.context];
  if (event.type === 'rosterRetry') {
    if (old.requestId !== event.requestId || old.sourceKey !== event.sourceKey) return rosters;
    return { ...rosters, [event.context]: { ...old, retryAt: event.retryAt } };
  }
  if (event.type === 'rosterQuery')
    return {
      ...rosters,
      [event.context]: {
        requestId: event.requestId,
        sourceKey: event.sourceKey,
        retryAt: null,
        pendingIds: event.pendingIds,
        rows: old.sourceKey === event.sourceKey ? old.rows : {},
      },
    };
  if (
    old.requestId !== event.requestId ||
    old.sourceKey !== event.sourceKey ||
    !old.pendingIds.includes(event.player.id)
  )
    return rosters;
  return {
    ...rosters,
    [event.context]: {
      ...old,
      pendingIds: old.pendingIds.filter((id) => id !== event.player.id),
      rows: {
        ...old.rows,
        [event.player.id]: { player: event.player, info: event.info, error: event.error },
      },
    },
  };
}
