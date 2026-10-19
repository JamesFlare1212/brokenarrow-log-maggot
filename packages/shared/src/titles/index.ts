import type { Match, MatchTitle, MatchTitleId } from '@ba/contracts';
import { object, number, text, team } from '../values';
import { awardTitles } from './engine';
import type { RawTitleMatch, RawTitlePlayer } from './types';

/** Evaluate completed matches only; lobby and live statistics cannot establish absence. */
export function matchTitles(match: Match, value?: unknown): Record<string, MatchTitle[]> {
  if (
    match.endedAt === null ||
    !match.durationSec ||
    match.durationSec <= 0 ||
    !match.players.some((p) => p.teamId === 0) ||
    !match.players.some((p) => p.teamId === 1)
  )
    return {};
  const wrapper = object(value),
    raw = object(wrapper.matchInfo ?? value);
  let data: RawTitleMatch;
  const unavailable = new Set<MatchTitleId>();
  if (raw.Data && typeof raw.Data === 'object' && !Array.isArray(raw.Data)) {
    const entries = Object.entries(object(raw.Data));
    // An ID-only roster does not contain evidence that a player was inactive.
    if (
      !entries.some(([, p]) => {
        const player = object(p);
        return number(player.DestructionScore) !== null || number(player.LossesScore) !== null;
      })
    )
      return {};
    data = {
      StartTime: number(raw.StartTime) ?? undefined,
      TotalPlayTimeInSec: match.durationSec,
      Data: Object.fromEntries(
        entries.map(([id, value]) => {
          const p = object(value);
          return [id, { ...p, Id: text(p.Id, id), TeamId: team(p.TeamId, true) ?? 100 }];
        }),
      ),
    };
  } else {
    const players = match.players.filter((p) => p.teamId === 0 || p.teamId === 1);
    if (players.some((p) => p.destructionScore === null || p.lossesScore === null)) return {};
    if (players.some((p) => p.damageDealt === null)) {
      unavailable.add('scraper');
      unavailable.add('killsteal');
    }
    if (players.some((p) => p.objectivesCaptured === null)) unavailable.add('landlord');
    // Summary records support exchange, objective and damage titles, but never infer
    // unit deaths, supply flows, refunds, friendly fire or unit composition.
    data = {
      TotalPlayTimeInSec: match.durationSec,
      Data: Object.fromEntries(
        players.map((p): [string, RawTitlePlayer] => [
          p.id,
          {
            Id: p.id,
            Name: p.name,
            TeamId: p.teamId!,
            DestructionScore: p.destructionScore!,
            LossesScore: p.lossesScore!,
            ObjectivesCaptured: p.objectivesCaptured ?? undefined,
            Destruction: p.killed ?? undefined,
            DamageDealt: p.damageDealt ?? undefined,
          },
        ]),
      ),
    };
  }
  const awards = awardTitles(data, { winnerTeam: match.winnerTeamId, excluded: unavailable });
  return Object.fromEntries(Object.entries(awards).map(([id, award]) => [id, award.titles]));
}
