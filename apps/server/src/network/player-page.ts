import { object } from '@ba/shared';

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
  const chunks: string[] = [];
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const call = script[1]?.match(/^\s*self\.__next_f\.push\(([\s\S]*)\)\s*;?\s*$/);
    if (!call?.[1]) continue;
    try {
      const frame: unknown = JSON.parse(call[1]);
      if (Array.isArray(frame) && frame[0] === 1 && typeof frame[1] === 'string')
        chunks.push(frame[1]);
    } catch {
      // Other scripts and incomplete frames are not player data.
    }
  }
  const find = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return;
    const data = object(object(value).playerData),
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
    for (const child of Object.values(value)) {
      const result = find(child);
      if (result) return result;
    }
  };
  // A model can span several streamed script frames; join before reading records.
  for (const record of chunks.join('').split('\n')) {
    if (!/^[\da-f]+:/i.test(record)) continue;
    try {
      const result = find(JSON.parse(record.slice(record.indexOf(':') + 1)));
      if (result) return result;
    } catch {
      // Flight also includes module, text and metadata records that are not JSON models.
    }
  }
  throw new Error('BATrace player page has no complete data for the requested player');
}
