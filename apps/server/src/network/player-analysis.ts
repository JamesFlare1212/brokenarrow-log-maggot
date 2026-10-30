import { object } from '@ba/shared';

export function playerAnalysisSections(value: unknown) {
  const data = object(value),
    trend = object(data.trend);
  const matches = Array.isArray(trend.points),
    maps = Array.isArray(data.mapPerformance);
  const invalidPoints =
    matches &&
    (trend.points as unknown[]).some((point) => {
      const entry = object(point);
      return !/^\d+$/.test(String(entry.matchId ?? ''));
    });
  const invalidMaps =
    maps &&
    (data.mapPerformance as unknown[]).some((map) => {
      const entry = object(map);
      return (
        !(typeof entry.mapName === 'string' && entry.mapName.trim()) &&
        !(typeof entry.mapId === 'number' && Number.isFinite(entry.mapId))
      );
    });
  if (
    (!matches && !maps) ||
    invalidPoints ||
    invalidMaps ||
    (trend.points !== undefined && !matches) ||
    (data.mapPerformance !== undefined && !maps) ||
    typeof data.matchCount !== 'number' ||
    !Number.isInteger(data.matchCount) ||
    data.matchCount < 0
  )
    throw new Error('BATrace returned incomplete player analysis');
  return { matches, maps };
}

export function validatePlayerAnalysis(value: unknown): unknown {
  playerAnalysisSections(value);
  return value;
}
