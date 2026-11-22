import type { AppEvent, CacheStats, Match, RpcMethod, RpcOutputs } from '@ba/contracts';

const matchWarning = 'Cached match data; BATrace is unavailable';
const recentWarning = 'Recent matches are cached';

export function previewCacheStats(stats: CacheStats, showExpired: boolean): CacheStats {
  const copy = structuredClone(stats);
  for (const usage of Object.values(copy)) usage.expired = showExpired ? usage.entries : 0;
  return copy;
}

function setMatchWarning(match: Match, showExpired: boolean) {
  if (showExpired && match.fid && match.mode !== 'pve') match.warning ||= matchWarning;
  else if (match.warning === matchWarning) delete match.warning;
}

function setSource(
  result: RpcOutputs['players.search'] | RpcOutputs['matches.timeline'],
  showExpired: boolean,
) {
  if (result.source !== 'local')
    result.source = showExpired ? 'stale' : result.source === 'stale' ? 'cache' : result.source;
}

const projections: { [K in RpcMethod]?: (result: RpcOutputs[K], showExpired: boolean) => void } = {
  'matches.detail': setMatchWarning,
  'matches.add': setMatchWarning,
  'matches.local': (match) => setMatchWarning(match, false),
  'matches.list': (matches, showExpired) =>
    matches.forEach((match) => setMatchWarning(match, showExpired)),
  'matches.timeline': setSource,
  'players.search': setSource,
  'players.report': (report, showExpired) => {
    report.stale = showExpired;
  },
  'players.profile': (profile, showExpired) => {
    if (profile.info) profile.info.stale = showExpired;
    if (showExpired && profile.recentMatches.length) profile.recentError ||= recentWarning;
    else if (profile.recentError === recentWarning) profile.recentError = null;
    profile.recentMatches.forEach((match) => setMatchWarning(match, showExpired));
  },
};

export function previewResponse<K extends RpcMethod>(
  method: K,
  result: RpcOutputs[K],
  showExpired: boolean,
) {
  const copy = structuredClone(result);
  projections[method]?.(copy, showExpired);
  return copy;
}

export function previewEvent(event: AppEvent, showExpired: boolean) {
  const copy = structuredClone(event);
  if (copy.type === 'roster' && copy.info) copy.info.stale = showExpired;
  return copy;
}
