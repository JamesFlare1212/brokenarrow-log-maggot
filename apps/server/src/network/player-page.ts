import { object } from '@ba/shared';
import { findPageData } from './page-data';

export function validatePlayerInfo(value: unknown, id: string): unknown {
  const data = object(value),
    info = object(data.info),
    stats = object(data.statInfo);
  if (
    typeof info.name !== 'string' ||
    !info.name.trim() ||
    (info.id != null && String(info.id) !== id) ||
    (stats.playerId != null && String(stats.playerId) !== id)
  )
    throw new Error('Player not found or incomplete BATrace response');
  return value;
}

/** Read JSON from Next.js server payloads without executing page scripts. */
export function parsePlayerPage(html: string, id: string): unknown {
  const result = findPageData(html, (value) => {
    const data = object(value.playerData),
      info = object(data.info),
      stats = object(data.statInfo);
    if (
      String(info.id) === id &&
      String(stats.playerId) === id &&
      ['fightsCountRt', 'winCountRt', 'lossCountRt'].every(
        (key) => typeof stats[key] === 'number' && Number.isFinite(stats[key]) && stats[key] >= 0,
      )
    ) {
      validatePlayerInfo(data, id);
      return { info, statInfo: stats };
    }
  });
  if (result) return result;
  throw new Error('BATrace player page has no complete data for the requested player');
}
