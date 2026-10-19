import { MATCH_SCORE_LABEL_IDS } from '@ba/contracts';
import type {
  Match,
  MatchScoreLabel,
  MatchScoreLabelEvidence,
  MatchScoreLabelId,
  MatchTitleId,
} from '@ba/contracts';
import { array, number, object, text } from '../values';
import { normalizeMatch } from '../matches';
import { TITLES } from './engine';
import { summarizeTitleHistory, type TitleHistoryFixture } from './history';

export const MEDAL_IDS = MATCH_SCORE_LABEL_IDS;
export type ComparisonMedalId = MatchScoreLabelId;
export const MEDAL_TEAM_RATIO = 0.9;
export const SCORE_LABEL_RULE = 'match-maximum-single';
export const MAX_COMPARISON_MEDALS = 3;
export const MAX_SCORE_LABELS = 2;
export const MEDAL_SOURCE = {
  repository: 'https://github.com/Zawinzala/Broken-Arrow-Maggot',
  revision: 'f4e1d5b2cfca6944227381d973b38b4782699533',
  file: 'index.html',
};
export type ComparisonMedal = MatchScoreLabel;
export interface ComparisonMedalAward {
  candidates: ComparisonMedal[];
  medals: ComparisonMedal[];
}
export interface MedalHistoryFixture {
  version: 1;
  capturedAt: number;
  titleHistorySha256: string;
  upstream: typeof MEDAL_SOURCE & { sha256: string };
  responses: Array<{ id: string; at: number; value: unknown }>;
  requests: TitleHistoryFixture['requests'];
  failures: Array<{ id: string; error: string }>;
}

/** Independently implement the pinned upstream six-dimension, team-relative badge rule. */
export function comparisonMedals(value: unknown): Record<string, ComparisonMedalAward> | null {
  return scoreLabelAwards(value, MEDAL_TEAM_RATIO);
}

function scoreLabelAwards(
  value: unknown,
  teamRatio: number,
  maxLabels = MAX_COMPARISON_MEDALS,
  scope: 'team' | 'match' = 'team',
): Record<string, ComparisonMedalAward> | null {
  const players = array(object(value).mvpRanking).map((entry) => {
    const p = object(entry);
    const breakdown = object(p.breakdown);
    return {
      id: text(p.playerId),
      team: number(p.teamId),
      score: number(p.score),
      breakdown: Object.fromEntries(
        MEDAL_IDS.map((id) => [id, number(breakdown[id]) ?? 0]),
      ) as Record<ComparisonMedalId, number>,
    };
  });
  if (
    players.length < 10 ||
    players.some(
      (p) => !/^\d+$/.test(p.id) || (p.team !== 0 && p.team !== 1) || p.score === null,
    ) ||
    new Set(players.map((p) => p.id)).size !== players.length ||
    !players.some((p) => p.team === 0) ||
    !players.some((p) => p.team === 1)
  )
    return null;
  const result: Record<string, ComparisonMedalAward> = {};
  const pools =
    scope === 'match'
      ? [players]
      : [0, 1].map((teamId) =>
          players.filter((p) => p.team === teamId).sort((a, b) => b.score! - a.score!),
        );
  for (const pool of pools) {
    for (const p of pool) result[p.id] = { candidates: [], medals: [] };
    for (const id of MEDAL_IDS) {
      const maximum = Math.max(...pool.map((p) => p.breakdown[id]));
      if (maximum <= 0) continue;
      const threshold = maximum * teamRatio;
      for (const p of pool) {
        const score = p.breakdown[id];
        if (score >= threshold) {
          result[p.id]!.candidates.push({ id, score, threshold });
          // Global awards have one winner; preserve analysis response order on ties.
          if (scope === 'match') break;
        }
      }
    }
    for (const p of pool) {
      const award = result[p.id]!;
      award.candidates.sort((a, b) => b.score - a.score);
      award.medals = award.candidates.slice(0, maxLabels);
    }
  }
  return result;
}

/** Never attach analysis labels to live matches or a different match/roster. */
export function matchScoreLabels(
  match: Match,
  value: unknown,
  rawMatch?: unknown,
): Record<string, MatchScoreLabel[]> {
  if (
    match.endedAt === null ||
    !match.durationSec ||
    match.durationSec <= 0 ||
    !match.fid ||
    text(object(value).matchId) !== match.fid
  )
    return {};
  const awards = scoreLabelAwards(value, 1, MAX_SCORE_LABELS, 'match');
  const players = match.players.filter((player) => player.teamId === 0 || player.teamId === 1);
  const ranking = array(object(value).mvpRanking);
  if (
    !awards ||
    players.length !== ranking.length ||
    players.some(
      (player) =>
        !ranking.some((entry) => {
          const row = object(entry);
          return text(row.playerId) === player.id && number(row.teamId) === player.teamId;
        }),
    )
  )
    return {};
  return withScoreLabelEvidence(
    match,
    Object.fromEntries(Object.entries(awards).map(([id, award]) => [id, award.medals])),
    value,
    rawMatch,
  );
}

/** Keep combat quantities separate from normalized scores used to select award recipients. */
export function withScoreLabelEvidence(
  match: Match,
  labels: Record<string, MatchScoreLabel[]>,
  analysis?: unknown,
  rawMatch?: unknown,
): Record<string, MatchScoreLabel[]> {
  const wrapper = object(rawMatch),
    raw = object(wrapper.matchInfo ?? rawMatch),
    roster = object(raw.Data);
  const detailed = Object.values(roster).some((entry) => {
    const p = object(entry);
    return number(p.DestructionScore) !== null || number(p.LossesScore) !== null;
  });
  const report = text(object(analysis).matchId) === match.fid ? object(analysis) : {};
  const economy = array(object(report.economy).players);
  const damage = object(report.damageContribution);
  const damageRows = [...array(damage.teamA), ...array(damage.teamB)];
  return Object.fromEntries(
    Object.entries(labels).map(([id, awards]) => {
      const player = match.players.find((p) => p.id === id);
      const rawPlayer = object(
        roster[id] ?? Object.values(roster).find((p) => text(object(p).Id) === id),
      );
      const hasRaw = detailed && Object.keys(rawPlayer).length > 0;
      // Complete protobuf payloads omit zero scalars; ID-only rosters do not establish zero.
      const rawMetric = (key: string): number | null =>
        hasRaw ? (rawPlayer[key] === undefined ? 0 : number(rawPlayer[key])) : null;
      const economic = object(economy.find((p) => text(object(p).playerId) === id));
      const damageRow = object(damageRows.find((p) => text(object(p).playerId) === id));
      const destructionValue =
        rawMetric('DestructionScore') ?? player?.destructionScore ?? number(economic.returnValue);
      const lossValue = rawMetric('LossesScore') ?? player?.lossesScore ?? null;
      const facts: MatchScoreLabelEvidence = {
        destructionValue,
        killed: rawMetric('Destruction') ?? player?.killed ?? null,
        damageDealt:
          rawMetric('DamageDealt') ?? player?.damageDealt ?? number(damageRow.damageDealt),
        damageReceived: rawMetric('DamageReceived') ?? player?.damageReceived ?? null,
        lossValue,
        dlRatio:
          destructionValue !== null && lossValue !== null && lossValue > 0
            ? destructionValue / lossValue
            : (player?.dlRatio ?? null),
        investment: rawMetric('TotalSpawnedUnitScore') ?? number(economic.investment),
        refunded: rawMetric('TotalRefundedUnitScore') ?? number(economic.refunded),
        roi: number(economic.roi),
        objectivesCaptured: rawMetric('ObjectivesCaptured') ?? player?.objectivesCaptured ?? null,
        supplyProvided: rawMetric('SupplyPointsConsumedByAllies'),
      };
      const keys: Record<MatchScoreLabelId, Array<keyof MatchScoreLabelEvidence>> = {
        destruction: ['destructionValue', 'killed'],
        damage: ['damageDealt', 'damageReceived'],
        dlRatio: ['destructionValue', 'lossValue', 'dlRatio'],
        efficiency: ['investment', 'refunded', 'destructionValue', 'roi'],
        objectives: ['objectivesCaptured'],
        supply: ['supplyProvided'],
      };
      return [
        id,
        awards.map((award) => ({
          ...award,
          evidence: Object.fromEntries(
            keys[award.id].map((key) => [key, facts[key] ?? award.evidence?.[key] ?? null]),
          ),
        })),
      ];
    }),
  );
}

const emptyCount = () => ({
  candidates: 0,
  awarded: 0,
  matches: 0,
  localCandidates: 0,
  localAwarded: 0,
});

/** Compare only the intersection of complete match and analysis rosters. */
export function compareTitleMedals(history: TitleHistoryFixture, analyses: MedalHistoryFixture) {
  const titleReport = summarizeTitleHistory(history);
  const responseMap = new Map(analyses.responses.map((response) => [response.id, response.value]));
  if (responseMap.size !== analyses.responses.length)
    throw new Error('Medal history contains duplicate FIDs');
  const medalCounts = Object.fromEntries(MEDAL_IDS.map((id) => [id, emptyCount()])) as Record<
    ComparisonMedalId,
    ReturnType<typeof emptyCount>
  >;
  const scoreLabelCounts = Object.fromEntries(
    MEDAL_IDS.map((id) => [id, emptyCount()]),
  ) as typeof medalCounts;
  const titleIds = Object.keys(TITLES) as MatchTitleId[];
  const titleCounts = Object.fromEntries(titleIds.map((id) => [id, emptyCount()])) as Record<
    MatchTitleId,
    ReturnType<typeof emptyCount>
  >;
  const overlaps = Object.fromEntries(
    titleIds.map((id) => [
      id,
      Object.fromEntries(MEDAL_IDS.map((key) => [key, { candidates: 0, awarded: 0 }])),
    ]),
  ) as Record<MatchTitleId, Record<ComparisonMedalId, { candidates: number; awarded: number }>>;
  let players = 0,
    titlePlayers = 0,
    medalPlayers = 0,
    scoreLabelPlayers = 0;
  const matches = titleReport.matches
    .filter((match) => match.status === 'evaluated')
    .map((match) => {
      const value = responseMap.get(match.id);
      if (value === undefined) return { id: match.id, status: 'unavailable' as const };
      const medals = comparisonMedals(value);
      const awards = match.awards!;
      if (
        text(object(value).matchId) !== match.id ||
        !medals ||
        Object.keys(medals).length !== Object.keys(awards).length ||
        Object.keys(awards).some((id) => !medals[id])
      )
        return { id: match.id, status: 'incomplete' as const };
      const entry = history.matches.find((entry) => entry.id === match.id)!;
      const application = scoreLabelAwards(value, 1, MAX_SCORE_LABELS, 'match')!;
      const rawMatch = history.responses.find((response) => response.id === match.id)!;
      const applicationMatch = normalizeMatch(rawMatch.value, {
        id: match.id,
        localId: entry.localPlayerId,
      });
      const seenTitles = new Set<MatchTitleId>(),
        seenMedals = new Set<ComparisonMedalId>(),
        seenScoreLabels = new Set<ComparisonMedalId>();
      for (const [playerId, award] of Object.entries(awards)) {
        players++;
        if (award.titles.length) titlePlayers++;
        const medal = medals[playerId]!;
        const labels = application[playerId]!;
        if (medal.medals.length) medalPlayers++;
        if (labels.medals.length) scoreLabelPlayers++;
        const local = playerId === entry.localPlayerId;
        for (const id of award.candidates as MatchTitleId[]) {
          titleCounts[id].candidates++;
          if (local) titleCounts[id].localCandidates++;
          for (const tag of medal.candidates) overlaps[id][tag.id].candidates++;
        }
        for (const title of award.titles) {
          titleCounts[title.id].awarded++;
          if (local) titleCounts[title.id].localAwarded++;
          seenTitles.add(title.id);
          for (const tag of medal.medals) overlaps[title.id][tag.id].awarded++;
        }
        for (const tag of medal.candidates) {
          medalCounts[tag.id].candidates++;
          if (local) medalCounts[tag.id].localCandidates++;
        }
        for (const tag of medal.medals) {
          medalCounts[tag.id].awarded++;
          if (local) medalCounts[tag.id].localAwarded++;
          seenMedals.add(tag.id);
        }
        for (const label of labels.candidates) {
          scoreLabelCounts[label.id].candidates++;
          if (local) scoreLabelCounts[label.id].localCandidates++;
        }
        for (const label of labels.medals) {
          scoreLabelCounts[label.id].awarded++;
          if (local) scoreLabelCounts[label.id].localAwarded++;
          seenScoreLabels.add(label.id);
        }
      }
      for (const id of seenTitles) titleCounts[id].matches++;
      for (const id of seenMedals) medalCounts[id].matches++;
      for (const id of seenScoreLabels) scoreLabelCounts[id].matches++;
      return {
        id: match.id,
        status: 'compared' as const,
        awards: medals,
        scoreLabels: matchScoreLabels(applicationMatch, value, rawMatch.value),
      };
    });
  const totals = (counts: Record<string, ReturnType<typeof emptyCount>>) => ({
    triggeredKinds: Object.values(counts).filter((c) => c.candidates > 0).length,
    candidates: Object.values(counts).reduce((sum, c) => sum + c.candidates, 0),
    awarded: Object.values(counts).reduce((sum, c) => sum + c.awarded, 0),
    localCandidates: Object.values(counts).reduce((sum, c) => sum + c.localCandidates, 0),
    localAwarded: Object.values(counts).reduce((sum, c) => sum + c.localAwarded, 0),
  });
  return {
    upstream: analyses.upstream,
    scope: {
      requested: matches.length,
      compared: matches.filter((m) => m.status === 'compared').length,
      unavailable: matches.filter((m) => m.status === 'unavailable').length,
      incomplete: matches.filter((m) => m.status === 'incomplete').length,
      players,
    },
    titles: { ...totals(titleCounts), playersWithAwards: titlePlayers, counts: titleCounts },
    medals: { ...totals(medalCounts), playersWithAwards: medalPlayers, counts: medalCounts },
    scoreLabels: {
      rule: SCORE_LABEL_RULE,
      ...totals(scoreLabelCounts),
      playersWithAwards: scoreLabelPlayers,
      counts: scoreLabelCounts,
    },
    overlaps,
    matches,
  };
}
