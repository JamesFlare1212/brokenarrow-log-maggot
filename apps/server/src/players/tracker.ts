import type { Match, PlayerProfile } from '@ba/contracts';
import { isOnlineMatchId } from '@ba/contracts';
import {
  array,
  object,
  text,
  normalizeMatch,
  winnerFromAnalysis,
  determineOutcome,
  matchTitles,
  matchScoreLabels,
  withScoreLabelEvidence,
  SCORE_LABEL_RULE,
  MAX_SCORE_LABELS,
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
    const recorded = this.client.offline && this.db.state('offlineBatraceFixture', null);
    return this.db.matches(accountId).map((match) => {
      const raw =
        recorded && match.fid ? this.db.cache(`match:${match.fid}`, true)?.value : undefined;
      const complete = raw
        ? normalizeMatch(raw, {
            id: match.id,
            previous: match,
            localId: match.localPlayerId,
            now: match.updatedAt,
          })
        : match;
      return this.withAwards(complete, raw);
    });
  }
  private withAwards(match: Match, raw?: unknown, analysis?: unknown): Match {
    const cached =
      raw ?? (match.fid ? this.db.cache(`match:${match.fid}`, true)?.value : undefined);
    const scores =
      analysis ?? (match.fid ? this.db.cache(`amatch:${match.fid}`, true)?.value : undefined);
    return {
      ...match,
      titles: cached ? matchTitles(match, cached) : (match.titles ?? matchTitles(match)),
      scoreLabels:
        match.endedAt === null
          ? {}
          : scores
            ? matchScoreLabels(match, scores, cached)
            : match.scoreLabelRule === SCORE_LABEL_RULE
              ? withScoreLabelEvidence(
                  match,
                  Object.fromEntries(
                    Object.entries(match.scoreLabels ?? {}).map(([id, labels]) => [
                      id,
                      labels.slice(0, MAX_SCORE_LABELS),
                    ]),
                  ),
                  undefined,
                  cached,
                )
              : {},
      scoreLabelRule: SCORE_LABEL_RULE,
    };
  }
  private perspective(match: Match, accountId?: string | null): Match {
    if (!accountId) return match;
    const projected = this.db.projectMatch(match, accountId);
    if (!projected) throw new Error('MATCH_PERSPECTIVE_UNAVAILABLE');
    return projected;
  }
  async detail(
    fid: string,
    force = false,
    restore = false,
    accountId?: string | null,
  ): Promise<Match> {
    const previous = this.db.match(fid);
    if (!isOnlineMatchId(fid)) {
      if (!previous) throw new Error('LOCAL_MATCH_UNAVAILABLE');
      const match = this.withAwards(this.perspective(previous, accountId));
      delete match.warning;
      delete match.warningCode;
      return match;
    }
    const version = this.db.historyVersion(fid);
    const unchanged = () => {
      if (this.db.historyVersion(fid) !== version) throw new Error('HISTORY_TARGET_CHANGED');
    };
    let result;
    try {
      result = await this.client.match(fid, force);
    } catch (error) {
      unchanged();
      if (!force && previous)
        return {
          ...this.withAwards(this.perspective(previous, accountId)),
          warning: error instanceof Error ? error.message : String(error),
        };
      throw error;
    }
    unchanged();
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
    let analysis: unknown;
    if (
      result.source !== 'stale' &&
      ((match.endedAt !== null && match.durationSec) ||
        (match.mode === 'custom' && match.outcome === 'unknown'))
    ) {
      try {
        analysis = (await this.client.analysisMatch(fid, force)).value;
        if (match.mode === 'custom' && match.outcome === 'unknown') {
          const winner = winnerFromAnalysis(analysis),
            outcome = determineOutcome(match.players, match.localPlayerId, match.mode, winner);
          match = { ...match, winnerTeamId: outcome.winner, outcome: outcome.outcome };
        }
      } catch {
        /* Match facts and cached awards remain useful when analysis is unavailable. */
      }
    }
    match = this.withAwards(match, result.value, analysis);
    unchanged();
    if (result.source === 'stale')
      return {
        ...this.perspective(match, accountId),
        warning: 'Cached match data; BATrace is unavailable',
        warningCode: 'batrace-cache',
      };
    delete match.warning;
    delete match.warningCode;
    const projected = this.perspective(match, accountId);
    const locals = new Set(this.db.accounts().map((account) => account.id));
    const observe =
      previous?.source === 'log' ||
      previous?.source === 'legacy' ||
      match.players.some((player) => locals.has(player.id));
    if (restore) this.db.restoreMatch(match, observe);
    else {
      if (this.db.matchDeleted(match)) throw new Error('HISTORY_TARGET_CHANGED');
      this.db.saveMatch(match, observe);
    }
    return projected;
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
      matches: matches.map((match) => this.withAwards(match)),
      stale: result.source === 'stale',
    };
  }
  async profile(
    id: string,
    force = false,
    scope: { accountId?: string | null; combined?: boolean } = {},
  ): Promise<PlayerProfile> {
    const encounters = this.db.encounterViews(id, scope);
    const local = this.db.player(id, this.client.offline),
      snapshot = this.db.snapshot(id),
      profile: PlayerProfile = {
        id,
        name: local?.name || snapshot?.name || this.db.searchedPlayer(id)?.name || id,
        names: local?.names || [],
        firstSeen: local?.firstSeen ?? null,
        lastSeen: local?.lastSeen ?? null,
        unverifiedObservation: local?.unverifiedObservation ?? false,
        encounters: encounters.encounters,
        encounterScope: encounters.scope,
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
    const version = this.db.historyVersion();
    const id = this.db.state<string | null>('activeAccountId', null);
    if (!id) return;
    const result = await this.recent(id);
    if (result.stale || this.db.historyVersion() !== version) return;
    const pending = this.db
      .matches()
      .filter((m) => m.fid && m.outcome === 'unknown')
      .slice(0, 20);
    // Save the recent snapshot before fetching richer, potentially newer details.
    this.db.transaction(() => {
      const locals = new Set(this.db.accounts().map((account) => account.id));
      for (const match of result.matches)
        this.db.saveMatch(
          match,
          match.players.some((player) => locals.has(player.id)),
        );
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
