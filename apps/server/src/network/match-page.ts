import { object } from '@ba/shared';
import { findPageData } from './page-data';

export function validateMatchInfo(value: unknown): unknown {
  const info = object(object(value).matchInfo);
  if (
    typeof info.Data === 'string'
      ? !/\d+\s*=/.test(info.Data)
      : Object.keys(object(info.Data)).length === 0
  )
    throw new Error('Match not found or incomplete BATrace response');
  return value;
}

export function parseMatchPage(html: string, id: string): unknown {
  const result = findPageData(html, (value) => {
    if (String(value.matchId) !== id) return;
    return validateMatchInfo(value.initialMatchData);
  });
  if (result) return result;
  throw new Error('BATrace match page has no complete data for the requested match');
}
