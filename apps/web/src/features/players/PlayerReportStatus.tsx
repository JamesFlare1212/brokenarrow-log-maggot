import type { PlayerReport } from '@ba/contracts';
import { formatTime } from '@ba/shared';
import { Notice } from '../../components/ui';
import { RecoveryAction } from '../../components/RecoveryAction';
import { useI18n } from '../../hooks/useI18n';
import { hasReportSection, type PlayerReportRequest } from '../../hooks/usePlayerReports';

export function PlayerReportStatus({
  request,
  report,
  onRetry,
  actionFirst = false,
}: {
  request?: PlayerReportRequest;
  report?: PlayerReport;
  onRetry: () => void;
  actionFirst?: boolean;
}) {
  const { t, locale } = useI18n();
  const data = request?.data ?? report;
  const pending = request?.pending ?? false;
  const incomplete =
    !!data && (!hasReportSection(data, 'matches') || !hasReportSection(data, 'maps'));
  const recovery = (
    <RecoveryAction
      available={!!request?.error || incomplete}
      pending={pending}
      retryLabel={t(request?.error ? 'retry' : 'retryAnalysis')}
      refreshLabel={t('refreshAnalysis')}
      pendingLabel={t('reportLoading')}
      onRetry={onRetry}
    />
  );
  return (
    <div className="grid min-w-0 gap-2" data-report-status="">
      {actionFirst && <div className="profile-recovery-slot">{recovery}</div>}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground wrap-anywhere">
          {data
            ? t('reportRefreshingPrevious', { time: formatTime(data.updatedAt, locale) })
            : t('reportLoading')}
        </p>
      )}
      {request?.error && (
        <Notice error>
          <div className="min-w-0 flex-1 wrap-anywhere">
            <p>{t('reportRequestFailed')}</p>
            <p>
              {request.error === 'REPORT_ID_MISMATCH' ? t('reportIdentityMismatch') : request.error}
            </p>
            {data && (
              <p>{t('reportPreviousResult', { time: formatTime(data.updatedAt, locale) })}</p>
            )}
          </div>
        </Notice>
      )}
      {data?.stale && !request?.error && (
        <Notice>
          {t('stale')} · {formatTime(data.updatedAt, locale)}
        </Notice>
      )}
      {incomplete && (
        <Notice>
          <div className="min-w-0 flex-1 wrap-anywhere">
            <p>{t(data?.fallback ? 'reportBasicOnly' : 'reportPartialDetails')}</p>
            {data?.analysisError && <p>{data.analysisError}</p>}
            {(['matches', 'maps'] as const).map((section) => {
              const previous = request?.details[section];
              return (
                previous &&
                previous !== data && (
                  <p key={section}>
                    {t('reportPreviousSection', {
                      section: t(section === 'matches' ? 'matchStatistics' : 'mapStatistics'),
                      time: formatTime(previous.updatedAt, locale),
                    })}
                  </p>
                )
              );
            })}
          </div>
        </Notice>
      )}
      {data?.fallback && (data.wins === null || data.losses === null) && (
        <p role="status" className="text-sm text-muted-foreground wrap-anywhere">
          {t('reportOutcomeCountsUnavailable')}
        </p>
      )}
      {!actionFirst && recovery}
    </div>
  );
}
