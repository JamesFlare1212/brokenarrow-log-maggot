import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatMetric } from '@ba/shared';
import { Stats } from '../../components/ui';
import { PlayerPreferences } from './PlayerPreferences';
import { RatingTrendChart } from './RatingTrendChart';
import { useI18n } from '../../hooks/useI18n';

export function ProfileOverview({
  id,
  profile,
  report,
  profilePending,
  reportPending,
}: {
  id: string;
  profile: PlayerProfile | null;
  report: PlayerReport | null;
  profilePending: boolean;
  reportPending: boolean;
}) {
  const { t } = useI18n();
  const info = report ?? profile?.info;
  const metricsPending = !info && (profilePending || reportPending);
  const preferencesPending = reportPending || (!report && profilePending);

  return (
    <div className="profile-overview">
      <Stats
        items={[
          {
            label: 'ELO',
            value: formatMetric(info?.elo ?? profile?.latestElo ?? null, 0),
            pending: metricsPending && profile?.latestElo == null,
          },
          {
            label: t(info?.fallback ? 'winRate' : 'recentWinRate'),
            value: info?.winRate == null ? '—' : `${formatMetric(info.winRate, 0)}%`,
            pending: metricsPending,
          },
          {
            label: t('latestKd'),
            value: formatMetric(info?.kd ?? null),
            pending: metricsPending,
          },
          {
            label: t('latestDmr'),
            value: formatMetric(report?.dmr ?? null),
            pending: reportPending,
          },
        ]}
      />
      <RatingTrendChart report={report} pending={reportPending} />
      <PlayerPreferences id={id} profile={profile} report={report} pending={preferencesPending} />
    </div>
  );
}
