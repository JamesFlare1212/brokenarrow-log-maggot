import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatTime } from '@ba/shared';
import { Map, Swords, TableProperties } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge, Button, Empty } from '../../components/ui';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { ReportMatchTable } from './Reports';
import { ProfileTableSkeleton } from './ProfileTableSkeleton';
import { MapPerformanceGrid } from './MapPerformanceGrid';

export function ProfileRecords({
  profile,
  report,
  profilePending,
  reportPending,
}: {
  profile: PlayerProfile | null;
  report: PlayerReport | null;
  profilePending: boolean;
  reportPending: boolean;
}) {
  const { t, locale } = useI18n();
  const { openModal } = useApp();
  const encounters = profile?.encounters ?? [];
  const teammates = encounters.filter((encounter) => encounter.relation === 'same');
  const tabs = [
    {
      value: 'statistics',
      label: t('matchStatistics'),
      icon: TableProperties,
      count: report?.recentMatches.length ?? 0,
      pending: reportPending,
    },
    {
      value: 'encounters',
      label: t('encounters'),
      icon: Swords,
      count: encounters.length,
      pending: profilePending,
    },
    {
      value: 'maps',
      label: t('mapStatistics'),
      icon: Map,
      count: report?.mapStats.length ?? 0,
      pending: reportPending,
    },
  ];

  return (
    <Tabs
      defaultValue="statistics"
      className="profile-records min-w-0 gap-4 [&>[data-slot='tabs-content'][data-state='active']]:flex [&>[data-slot='tabs-content'][data-state='active']]:min-w-0 [&>[data-slot='tabs-content'][data-state='active']]:flex-col [&>[data-slot='tabs-content'][data-state='active']]:gap-3"
    >
      <div className="profile-tab-scroll min-w-0 overflow-x-auto overflow-y-hidden pb-0.5 border-b border-b-border [&>[data-slot='tabs-list']]:h-11 [&>[data-slot='tabs-list']]:gap-4 viewport-max-767:[&>[data-slot='tabs-list']]:gap-2">
        <TabsList variant="line" aria-label={t('profileRecords')}>
          {tabs.map(({ value, label, icon: TabIcon, count, pending }) => (
            <TabsTrigger key={value} value={value}>
              <TabIcon aria-hidden="true" />
              {label}
              <span
                className="profile-tab-count inline-flex min-w-4 min-h-4 items-center justify-center text-muted-foreground text-[0.6875rem] tabular-nums"
                aria-busy={pending}
              >
                {pending ? <Skeleton className="h-3 w-4" aria-hidden="true" /> : count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="statistics">
        {reportPending || (report && report.recentMatches.length > 0) ? (
          <div className="profile-table profile-statistics-table min-w-0 overflow-hidden rounded-(--radius) border border-border">
            <ReportMatchTable report={report} pending={reportPending} />
          </div>
        ) : (
          <Empty icon={<TableProperties />}>{t('noMatchStatistics')}</Empty>
        )}
      </TabsContent>
      <TabsContent value="encounters">
        {profilePending || encounters.length > 0 ? (
          <>
            <dl
              className="profile-encounter-summary [&_dt]:text-muted-foreground [&_dt]:text-[0.75rem] grid grid-cols-4 gap-4 pt-1 px-0 pb-3 [&_dd]:flex [&_dd]:min-h-7.5 [&_dd]:items-center [&_dd]:mt-1 [&_dd]:text-[1.25rem] [&_dd]:font-semibold [&_dd]:tabular-nums viewport-max-767:grid-cols-2"
              aria-busy={profilePending}
            >
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
                  <dd>
                    {profilePending ? (
                      <Skeleton className="h-5 w-8" aria-hidden="true" />
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="profile-table min-w-0 overflow-hidden border border-border rounded-(--radius) [&_table]:min-w-128 [&_th]:bg-muted [&_th]:text-[0.75rem] [&_th]:py-2.5 [&_th]:px-4 [&_td]:py-2.5 [&_td]:px-4 [&_td:first-child_[data-slot='button']]:min-h-6 [&_td:first-child_[data-slot='button']]:h-auto [&_td:first-child_[data-slot='button']]:justify-start [&_td:first-child_[data-slot='button']]:p-0 [&_td:first-child_[data-slot='button']]:whitespace-normal [&_td:first-child_[data-slot='button']]:text-left profile-encounters-table [&_table]:table-fixed [&_th[data-column='team']]:w-24 [&_th[data-column='result']]:w-32 [&_th[data-column='time']]:w-50">
              <Table aria-busy={profilePending}>
                <TableCaption className="sr-only">{t('encounters')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    {['map', 'team', 'result', 'time'].map((column) => (
                      <TableHead key={column} data-column={column}>
                        {t(column)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profilePending ? (
                    <ProfileTableSkeleton columns={['map', 'team', 'result', 'time']} />
                  ) : (
                    encounters.map((encounter, index) => (
                      <TableRow key={encounter.matchId + ':' + index}>
                        <TableCell>
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => openModal({ type: 'match', fid: encounter.matchId })}
                          >
                            {encounter.map || encounter.matchId}
                          </Button>
                        </TableCell>
                        <TableCell>{t(encounter.relation)}</TableCell>
                        <TableCell>
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
                        <TableCell className="profile-time text-muted-foreground text-[0.8125rem] whitespace-nowrap">
                          {formatTime(encounter.at, locale)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
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
        {reportPending || (report && report.mapStats.length > 0) ? (
          <MapPerformanceGrid maps={report?.mapStats ?? []} pending={reportPending} />
        ) : (
          <Empty icon={<Map />}>{t('noMapStatistics')}</Empty>
        )}
      </TabsContent>
    </Tabs>
  );
}
