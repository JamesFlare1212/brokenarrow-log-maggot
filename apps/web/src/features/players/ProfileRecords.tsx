import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { useId, useState } from 'react';
import { isOnlineMatchId } from '@ba/contracts';
import { formatMetric, formatTime } from '@ba/shared';
import { Map, Swords, TableProperties } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge, Button, Empty, Loading, Notice } from '../../components/ui';
import { hasReportSection } from '../../hooks/usePlayerReports';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { ReportMatchTable } from './Reports';
import { RecoveryAction } from '../../components/RecoveryAction';

export function ProfileRecordNavigation({
  profile,
  matchReport,
  mapReport,
  onNavigate,
}: {
  profile: PlayerProfile | null;
  matchReport?: PlayerReport | null;
  mapReport?: PlayerReport | null;
  onNavigate?: (value: string) => void;
}) {
  const { t } = useI18n();
  const tabs = [
    {
      value: 'statistics',
      label: t('matchStatistics'),
      icon: TableProperties,
      count: hasReportSection(matchReport, 'matches')
        ? matchReport?.recentMatches.length
        : undefined,
    },
    {
      value: 'encounters',
      label: t('encounters'),
      icon: Swords,
      count: profile?.encounters.length,
    },
    {
      value: 'maps',
      label: t('mapStatistics'),
      icon: Map,
      count: hasReportSection(mapReport, 'maps') ? mapReport?.mapStats.length : undefined,
    },
  ];
  return (
    <div
      className="profile-tab-scroll group/tabs"
      data-orientation="horizontal"
      onFocusCapture={(event) => {
        const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
        if (!tab) return;
        const viewport = event.currentTarget,
          bounds = viewport.getBoundingClientRect(),
          target = tab.getBoundingClientRect();
        const left = bounds.left + viewport.clientLeft + 4,
          right = bounds.left + viewport.clientLeft + viewport.clientWidth - 4;
        if (target.left < left) viewport.scrollLeft += target.left - left;
        else if (target.right > right) viewport.scrollLeft += target.right - right;
      }}
    >
      <TabsList variant="line" aria-label={t('profileRecords')}>
        {tabs.map(({ value, label, icon: TabIcon, count }) => (
          <TabsTrigger key={value} value={value} onClick={() => onNavigate?.(value)}>
            <TabIcon aria-hidden="true" />
            {label}
            <span
              className="profile-tab-count"
              aria-label={count === undefined ? t('recordCountUnavailable') : undefined}
            >
              {count ?? '—'}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}

export function ProfileRecords({
  profile,
  report,
  matchReport = report,
  mapReport = report,
  reportPending = false,
  reportError,
  encounterError,
  onRetryReport,
  onRetryProfile,
  tab,
  onTabChange,
  encounterPending = false,
  scopeLabel,
  recoveryKey,
  externalNavigation = false,
}: {
  profile: PlayerProfile | null;
  report: PlayerReport | null;
  matchReport?: PlayerReport | null;
  mapReport?: PlayerReport | null;
  reportPending?: boolean;
  reportError?: string | null;
  encounterError?: string | null;
  onRetryReport?: () => void;
  onRetryProfile?: () => void;
  tab?: string;
  onTabChange?: (tab: string) => void;
  encounterPending?: boolean;
  scopeLabel?: string;
  recoveryKey?: string;
  externalNavigation?: boolean;
}) {
  const { t, locale } = useI18n();
  const { openModal } = useApp();
  const [localTab, setLocalTab] = useState('statistics');
  const encounterId = useId();
  const encounters = profile?.encounters ?? [];
  const matchRecords = hasReportSection(matchReport, 'matches') ? matchReport : null;
  const mapRecords = hasReportSection(mapReport, 'maps') ? mapReport : null;
  const teammates = encounters.filter((encounter) => encounter.relation === 'same');
  const content = (
    <>
      <TabsContent value="statistics">
        {onRetryReport && (
          <RecoveryAction
            key={`statistics:${recoveryKey}`}
            available={!matchRecords && !reportPending}
            pending={reportPending}
            retryLabel={t('retryAnalysis')}
            refreshLabel={t('refreshAnalysis')}
            pendingLabel={t('reportLoading')}
            onRetry={onRetryReport}
          />
        )}
        {reportError && matchRecords && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('reportPreviousResult', { time: formatTime(matchRecords.updatedAt, locale) })}
          </p>
        )}
        {matchRecords && matchRecords !== report && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('reportPreviousSection', {
              section: t('matchStatistics'),
              time: formatTime(matchRecords.updatedAt, locale),
            })}
          </p>
        )}
        {!matchRecords ? (
          reportPending ? (
            <Loading />
          ) : (
            <Notice>{t('reportRecordsUnavailable')}</Notice>
          )
        ) : matchRecords.recentMatches.length > 0 ? (
          <div className="profile-table profile-statistics-table">
            <ReportMatchTable report={matchRecords} />
          </div>
        ) : (
          <Empty icon={<TableProperties />}>{t('noMatchStatistics')}</Empty>
        )}
      </TabsContent>
      <TabsContent value="encounters">
        {onRetryProfile && (
          <RecoveryAction
            key={`encounters:${recoveryKey}`}
            available={!profile && !encounterPending}
            pending={encounterPending}
            retryLabel={t('retry')}
            refreshLabel={t('refreshEncounters')}
            pendingLabel={t('encountersLoading')}
            onRetry={onRetryProfile}
          />
        )}
        {scopeLabel && (
          <p role="status" className="text-sm text-muted-foreground wrap-anywhere">
            {scopeLabel}
          </p>
        )}
        {!profile?.encounterScope?.combined && !!profile?.encounterScope?.unattributedCount && (
          <p className="text-sm text-muted-foreground">
            {t('unattributedEncounterHint', { count: profile.encounterScope.unattributedCount })}
          </p>
        )}
        {encounterPending && !profile ? (
          <Loading />
        ) : !profile ? (
          <Notice error={!!encounterError}>{t('encounterRecordsUnavailable')}</Notice>
        ) : encounters.length > 0 ? (
          <>
            <dl className="profile-encounter-summary">
              {[
                { label: t('same'), value: teammates.length },
                {
                  label: t('opponent'),
                  value: encounters.filter((encounter) => encounter.relation === 'opponent').length,
                },
                {
                  label: t('sameTeamWins'),
                  value: teammates.filter((encounter) => encounter.won === true).length,
                },
                {
                  label: t('sameTeamLosses'),
                  value: teammates.filter((encounter) => encounter.won === false).length,
                },
              ].map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
            <p id={`${encounterId}-scroll`} className="text-xs text-muted-foreground">
              {t('encounterScrollHint')}
            </p>
            <div
              className="profile-table profile-encounters"
              data-dialog-scroll="encounters"
              role="region"
              tabIndex={0}
              aria-label={t('encounters')}
              aria-describedby={`${encounterId}-scroll`}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                event.currentTarget.scrollLeft += event.key === 'ArrowRight' ? 80 : -80;
              }}
            >
              <Table>
                <TableCaption className="sr-only">{t('encounters')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('map')}</TableHead>
                    <TableHead>{t('accounts')}</TableHead>
                    <TableHead>{t('team')}</TableHead>
                    <TableHead>{t('result')}</TableHead>
                    <TableHead>{t('time')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {encounters.map((encounter, index) => (
                    <TableRow
                      key={encounter.matchId + ':' + index}
                      data-encounter-id={encounter.matchId}
                    >
                      <TableCell>
                        <div className="w-56 whitespace-normal wrap-anywhere">
                          <Button
                            variant="link"
                            size="sm"
                            aria-labelledby={`${encounterId}-${index}-map ${encounterId}-${index}-id`}
                            aria-describedby={`${encounterId}-${index}-account ${encounterId}-${index}-relation ${encounterId}-${index}-outcome ${encounterId}-${index}-time`}
                            data-dialog-focus={`encounter:${encounter.matchId}:${encounter.accountId ?? 'unknown'}`}
                            onClick={() =>
                              openModal({
                                type: 'match',
                                fid: encounter.matchId,
                                accountId: encounter.accountId ?? null,
                              })
                            }
                          >
                            <span id={`${encounterId}-${index}-map`}>
                              {encounter.map || t('unknown')}
                            </span>
                          </Button>
                          <code
                            id={`${encounterId}-${index}-id`}
                            className="block text-xs text-muted-foreground"
                          >
                            #{encounter.matchId}
                          </code>
                          {!isOnlineMatchId(encounter.matchId) && <Badge>{t('localMatch')}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell
                        id={`${encounterId}-${index}-account`}
                        className="whitespace-normal wrap-anywhere"
                      >
                        {encounter.accountId
                          ? t('accountScope', {
                              name: encounter.accountName || encounter.accountId,
                              id: encounter.accountId,
                            })
                          : t('unattributedEncounter')}
                      </TableCell>
                      <TableCell id={`${encounterId}-${index}-relation`}>
                        {t(encounter.relation)}
                      </TableCell>
                      <TableCell id={`${encounterId}-${index}-outcome`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              encounter.won === null
                                ? 'muted'
                                : encounter.won
                                  ? 'success'
                                  : 'danger'
                            }
                          >
                            {encounter.won === null
                              ? t('unknown')
                              : t(encounter.won ? 'win' : 'loss')}
                          </Badge>
                          {encounter.custom && <Badge>{t('custom')}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell id={`${encounterId}-${index}-time`} className="profile-time">
                        {encounter.at === null
                          ? t('encounterEndUnknown')
                          : formatTime(encounter.at, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <Empty icon={<Swords />} description={t('noEncountersDescription')}>
            {t('noEncounters')}
          </Empty>
        )}
      </TabsContent>
      <TabsContent value="maps">
        {onRetryReport && (
          <RecoveryAction
            key={`maps:${recoveryKey}`}
            available={!mapRecords && !reportPending}
            pending={reportPending}
            retryLabel={t('retryAnalysis')}
            refreshLabel={t('refreshAnalysis')}
            pendingLabel={t('reportLoading')}
            onRetry={onRetryReport}
          />
        )}
        {reportError && mapRecords && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('reportPreviousResult', { time: formatTime(mapRecords.updatedAt, locale) })}
          </p>
        )}
        {mapRecords && mapRecords !== report && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('reportPreviousSection', {
              section: t('mapStatistics'),
              time: formatTime(mapRecords.updatedAt, locale),
            })}
          </p>
        )}
        {!mapRecords ? (
          reportPending ? (
            <Loading />
          ) : (
            <Notice>{t('reportMapsUnavailable')}</Notice>
          )
        ) : mapRecords.mapStats.length > 0 ? (
          <div className="profile-table">
            <Table>
              <TableCaption className="sr-only">{t('mapStatistics')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('map')}</TableHead>
                  <TableHead className="numeric">{t('totalMatches')}</TableHead>
                  <TableHead className="numeric">{t('winRate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mapRecords.mapStats.map((map) => (
                  <TableRow key={map.mapId ?? map.name}>
                    <TableCell>{map.name}</TableCell>
                    <TableCell className="numeric">{formatMetric(map.matchCount, 0)}</TableCell>
                    <TableCell className="numeric">
                      {map.winRate == null ? '—' : `${formatMetric(map.winRate, 0)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty icon={<Map />}>{t('noMapStatistics')}</Empty>
        )}
      </TabsContent>
    </>
  );
  if (externalNavigation) return <div className="profile-records">{content}</div>;
  return (
    <Tabs
      value={tab ?? localTab}
      onValueChange={(value) => {
        setLocalTab(value);
        onTabChange?.(value);
      }}
      className="profile-records"
    >
      <ProfileRecordNavigation profile={profile} matchReport={matchReport} mapReport={mapReport} />
      {content}
    </Tabs>
  );
}
