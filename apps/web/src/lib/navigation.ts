import type { Panel } from '@ba/contracts';

export function panelLabelKey(panel: Panel) {
  return panel === 'current' ? 'overview' : panel;
}
