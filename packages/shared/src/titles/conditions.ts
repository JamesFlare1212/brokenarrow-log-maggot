import type { MatchTitleId } from '@ba/contracts';
import { MAX_TITLES, SPECS, titleThresholds } from './engine';

export function titleConditionDetails(id: MatchTitleId) {
  const thresholds = titleThresholds();
  const spec = SPECS.find((spec) => spec.id === id);
  const threshold = thresholds[id] ?? 0;
  return {
    key: `title.${id}.condition`,
    eligibility: spec
      ? spec.pool === 'all'
        ? 'title.condition.all'
        : 'title.condition.active'
      : id === 'glutton'
        ? 'title.condition.active'
        : null,
    selection: spec || id === 'glutton' ? 'title.condition.best' : null,
    params: {
      threshold,
      percent: Number((threshold * 100).toFixed(4)),
      limit: MAX_TITLES,
      objectiveValue: thresholds.objValue ?? 0,
    },
  };
}
