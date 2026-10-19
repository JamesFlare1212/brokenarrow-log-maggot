import type { MatchTitleId } from '@ba/contracts';
import { normalizeMatch } from '../matches';
import { TITLES } from './engine';
import { matchTitleAwards } from './index';

export interface TitleHistoryFixture {
  version: 1;
  capturedAt: number;
  source: { historyMatches: number; withoutFid: number };
  matches: Array<{ id: string; localPlayerId: string | null; winnerTeamId: 0 | 1 | null }>;
  responses: Array<{
    id: string;
    at: number;
    source: 'cache' | 'network';
    value: unknown;
  }>;
  requests: Array<{
    path: string;
    at: number;
    status: number | null;
    contentType: string | null;
    body: string | null;
    error?: string;
  }>;
  failures: Array<{ id: string; error: string }>;
}

/** Count player-title occurrences; each FID is evaluated once, including every participant. */
export function summarizeTitleHistory(fixture: TitleHistoryFixture) {
  const counts = Object.fromEntries(
    (Object.keys(TITLES) as MatchTitleId[]).map((id) => [
      id,
      { candidates: 0, awarded: 0, matches: 0, localCandidates: 0, localAwarded: 0 },
    ]),
  ) as Record<
    MatchTitleId,
    {
      candidates: number;
      awarded: number;
      matches: number;
      localCandidates: number;
      localAwarded: number;
    }
  >;
  const responses = new Map(fixture.responses.map((response) => [response.id, response]));
  if (
    responses.size !== fixture.responses.length ||
    new Set(fixture.matches.map((m) => m.id)).size !== fixture.matches.length
  )
    throw new Error('Title history contains duplicate FIDs');
  const matches = fixture.matches.map((entry) => {
    const response = responses.get(entry.id);
    if (!response) return { id: entry.id, status: 'unavailable' as const };
    const match = normalizeMatch(response.value, {
      id: entry.id,
      localId: entry.localPlayerId,
      now: response.at,
    });
    match.winnerTeamId ??= entry.winnerTeamId;
    const awards = matchTitleAwards(match, response.value);
    if (!Object.keys(awards).length) return { id: entry.id, status: 'incomplete' as const };
    const awardedIds = new Set<MatchTitleId>();
    for (const [playerId, award] of Object.entries(awards)) {
      for (const id of award.candidates as MatchTitleId[]) {
        counts[id].candidates++;
        if (playerId === entry.localPlayerId) counts[id].localCandidates++;
      }
      for (const title of award.titles) {
        counts[title.id].awarded++;
        awardedIds.add(title.id);
        if (playerId === entry.localPlayerId) counts[title.id].localAwarded++;
      }
    }
    for (const id of awardedIds) counts[id].matches++;
    return { id: entry.id, status: 'evaluated' as const, winnerTeamId: match.winnerTeamId, awards };
  });
  return {
    scope: {
      ...fixture.source,
      withFid: fixture.matches.length,
      evaluated: matches.filter((m) => m.status === 'evaluated').length,
      unavailable: matches.filter((m) => m.status === 'unavailable').length,
      incomplete: matches.filter((m) => m.status === 'incomplete').length,
      unknownWinner: matches.filter((m) => m.status === 'evaluated' && m.winnerTeamId === null)
        .length,
      players: matches.reduce((sum, match) => sum + Object.keys(match.awards ?? {}).length, 0),
    },
    triggeredTitles: Object.values(counts).filter((count) => count.candidates > 0).length,
    awardedTitles: Object.values(counts).filter((count) => count.awarded > 0).length,
    counts,
    matches,
  };
}
