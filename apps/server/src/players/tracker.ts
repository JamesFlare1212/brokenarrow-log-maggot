import type { Match, PlayerProfile } from '@ba/contracts';
import {
  array,
  object,
  text,
  normalizeMatch,
  winnerFromAnalysis,
  determineOutcome,
  matchTitles,
} from '@ba/shared';
import type { Database } from '../storage/database';
import type { BatraceClient } from '../network/client';
import type { Analyzer } from './analyzer';
export class TrackerService {
  constructor(
    private db: Database,
    private client: BatraceClient,
    private analyzer: Analyzer,
  ) {}
  list(accountId?: string): Match[] {
    return this.db.matches(accountId).map((match) => this.withTitles(match));
  }
  private withTitles(match: Match, raw?: unknown): Match {
    const cached =
      raw ?? (match.fid ? this.db.cache(`match:${match.fid}`, true)?.value : undefined);
    return {
      ...match,
      titles: cached ? matchTitles(match, cached) : (match.titles ?? matchTitles(match)),
    };
  }
  async detail(fid: string, force = false): Promise<Match> {
    const previous = this.db.match(fid);
    let result;
    try {
      result = await this.client.match(fid, force);
    } catch (error) {
      if (!force && previous)
        return {
          ...this.withTitles(previous),
          warning: error instanceof Error ? error.message : String(error),
        };
      throw error;
    }
    const raw = object(result.value),
      data = object(raw.matchInfo);
    if (!raw.matchInfo || data.Data == null)
      throw new Error('Match not found or incomplete BATrace response');
    if (
      typeof data.Data === 'string'
        ? !/\d+\s*=/.test(data.Data)
        : Object.keys(object(data.Data)).length === 0
    )
      throw new Error('Match has no valid roster');
    let match = normalizeMatch(result.value, {
      id: fid,
      previous: previous || undefined,
      localId: previous?.localPlayerId ?? this.db.state<string | null>('activeAccountId', null),
      now: result.at,
    });
    if (match.mode === 'custom' && match.outcome === 'unknown' && result.source !== 'stale') {
      try {
        const analysis = await this.client.analysisMatch(fid),
          winner = winnerFromAnalysis(analysis.value),
          outcome = determineOutcome(match.players, match.localPlayerId, match.mode, winner);
        match = { ...match, winnerTeamId: outcome.winner, outcome: outcome.outcome };
      } catch {
        /* The detail remains useful when winner evidence is unavailable. */
      }
    }
    match = this.withTitles(match, result.value);
    if (result.source === 'stale')
      return { ...match, warning: 'Cached match data; BATrace is unavailable' };
    this.db.saveMatch(match);
    return match;
  }
  async recent(id: string, force = false): Promise<{ matches: Match[]; stale: boolean }> {
    const result = await this.client.playerMatches(id, force),
      list = array(object(result.value).matches);
    const matches = list
      .map((v) => {
        const raw = object(v),
          fid = text(raw.matchId);
        return normalizeMatch(raw.data, {
          id: fid,
          localId: id,
          previous: this.db.match(fid, id) || undefined,
          now: result.at,
        });
      })
      .filter((m) => /^\d+$/.test(m.id));
    if (result.source !== 'stale')
      for (const match of matches) {
        if (match.mode !== 'custom' || match.outcome !== 'unknown') continue;
        try {
          const result = await this.client.analysisMatch(match.id),
            winner = winnerFromAnalysis(result.value),
            outcome = determineOutcome(match.players, id, match.mode, winner);
          match.winnerTeamId = winner;
          match.outcome = outcome.outcome;
        } catch {
          /* Keep the local and recent data even if winner evidence is unavailable. */
        }
      }
    return {
      matches,
      stale: result.source === 'stale',
    };
  }
  async profile(id: string, force = false): Promise<PlayerProfile> {
    const local = this.db.player(id),
      snapshot = this.db.snapshot(id),
      profile: PlayerProfile = {
        id,
        name: local?.name || snapshot?.name || id,
        names: local?.names || [],
        firstSeen: local?.firstSeen ?? null,
        lastSeen: local?.lastSeen ?? null,
        encounters: this.db.encounters(id),
        banned: this.db.bans().find((b) => b.id === id) || null,
        recentMatches: [],
        recentError: null,
        latestElo: null,
        info: snapshot,
      };
    const results = await Promise.allSettled([
      this.recent(id, force),
      this.analyzer.report(id, force),
    ]);
    if (results[0].status === 'fulfilled') {
      profile.recentMatches = results[0].value.matches;
      profile.latestElo =
        profile.recentMatches.find((m) => m.mode === 'ranked' && m.eloAfter !== null)?.eloAfter ??
        null;
      if (results[0].value.stale) profile.recentError = 'Recent matches are cached';
    } else
      profile.recentError =
        results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason);
    if (results[1].status === 'fulfilled') {
      profile.info = this.analyzer.mini(results[1].value);
      profile.name = results[1].value.name || profile.name;
    }
    return profile;
  }
  async sync(): Promise<void> {
    const id = this.db.state<string | null>('activeAccountId', null);
    if (!id) return;
    const result = await this.recent(id);
    if (result.stale) return;
    const pending = this.db
      .matches()
      .filter((m) => m.fid && m.outcome === 'unknown')
      .slice(0, 20);
    // Save the recent snapshot before fetching richer, potentially newer details.
    this.db.transaction(() => {
      for (const match of result.matches) this.db.saveMatch(match);
    });
    for (const match of pending) {
      try {
        await this.detail(match.fid!);
      } catch {
        /* A future sync or manual refresh can retry. */
      }
    }
    this.db.transaction(() => {
      this.db.setState('lastMatchSync', Date.now());
    });
  }
}
