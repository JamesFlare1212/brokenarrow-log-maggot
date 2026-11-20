import type { Moment } from './model';

export const eventKindLabels = { highlight: '高光', loss: '损失', recon: '侦察' };

export function markerLabels(moments: Moment[]): string[] {
  const first = moments[0];
  if (!first) return [];
  if (moments.length === 1) {
    if (!first.playerId) return [`${first.sorties.length}阵亡`];
    if (first.unit.startsWith('Unit #')) return [first.unit.replace('Unit ', '')];
    return [first.unit.split(/\s+/)[0]!];
  }
  const counts = new Map<Moment['kind'], number>();
  for (const moment of moments) counts.set(moment.kind, (counts.get(moment.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${eventKindLabels[kind]}×${count}`);
}
