import type { Match, MatchPlayer } from '@ba/contracts';
export function mergePlayers(
  old: MatchPlayer[],
  incoming: MatchPlayer[],
  fillOnly = false,
): MatchPlayer[] {
  const players = new Map(old.map((p) => [p.id, { ...p }]));
  for (const next of incoming) {
    const previous = players.get(next.id);
    if (!previous) {
      players.set(next.id, { ...next });
      continue;
    }
    const merged = { ...previous };
    for (const key of Object.keys(next) as Array<keyof MatchPlayer>) {
      const value = next[key];
      if (
        value !== null &&
        value !== '' &&
        (!fillOnly || previous[key] === null || previous[key] === '')
      )
        Object.assign(merged, { [key]: value });
    }
    players.set(next.id, merged);
  }
  return [...players.values()];
}
export function mergeMatch(previous: Match, incoming: Match, fillOnly = false): Match {
  const olderApi =
    previous.source === 'api' &&
    incoming.source === 'api' &&
    incoming.updatedAt < previous.updatedAt;
  const lower = fillOnly || olderApi || (previous.source === 'api' && incoming.source !== 'api'),
    merged = { ...previous };
  for (const key of Object.keys(incoming) as Array<keyof Match>) {
    if (key === 'players') continue;
    const value = incoming[key];
    const existing = previous[key];
    const useful = value !== null && value !== '' && value !== undefined && value !== 'unknown';
    if (
      useful &&
      (!lower ||
        existing === null ||
        existing === '' ||
        existing === 'unknown' ||
        existing === undefined)
    )
      Object.assign(merged, { [key]: value });
  }
  merged.players = mergePlayers(previous.players, incoming.players, lower);
  if (
    incoming.durationSource === 'log' &&
    (previous.durationSource === 'estimated' || previous.durationSec === null)
  ) {
    merged.durationSec = incoming.durationSec;
    merged.durationSource = 'log';
  }
  if (incoming.source === 'api' && !olderApi) {
    merged.restarted = incoming.restarted;
    merged.updatedAt = incoming.updatedAt;
  }
  if (previous.source === 'api' && incoming.source !== 'api') {
    merged.source = 'api';
    merged.updatedAt = previous.updatedAt;
  }
  merged.id = incoming.fid || previous.fid || previous.id;
  merged.fid = incoming.fid || previous.fid;
  return merged;
}
