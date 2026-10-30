import type { Locale, TeamId } from '@ba/contracts';
import { teamLabel } from '@ba/shared';
import { translate } from '../hooks/useI18n';

export function localizedTeamLabel(team: TeamId, locale: Locale): string {
  return team === 100
    ? translate(locale, 'spectator')
    : team === null
      ? translate(locale, 'unknown')
      : teamLabel(team);
}
