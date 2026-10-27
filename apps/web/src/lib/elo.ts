import type { Metric } from '@ba/contracts';

export function eloChangeClass(delta: Metric) {
  if (delta === null || delta === 0) return undefined;
  return delta > 0 ? 'elo-increase' : 'elo-decrease';
}
