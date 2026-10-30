import type { Locale, Replay } from '@ba/contracts';
import { localizedTeamLabel } from '../../lib/team-label';
export function formatReplayTime(value: number, locale: Locale): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(value);
}

export function replayIdentity(replay: Replay, locale: Locale): string {
  return [
    ...new Set(
      [replay.map, replay.uploaderName || localizedTeamLabel(replay.teamId, locale)].filter(
        Boolean,
      ),
    ),
    formatReplayTime(replay.createdAt, locale),
    replay.id,
  ].join(' · ');
}
