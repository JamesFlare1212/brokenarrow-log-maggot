import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatMetric, formatTime } from '@ba/shared';
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
    <Tabs defaultValue="statistics" className="profile-records">
      <div className="profile-tab-scroll">
        <TabsList variant="line" aria-label={t('profileRecords')}>
          {tabs.map(({ value, label, icon: TabIcon, count, pending }) => (
            <TabsTrigger key={value} value={value}>
              <TabIcon aria-hidden="true" />
              {label}
              <span className="profile-tab-count" aria-busy={pending}>
                {pending ? <Skeleton className="h-3 w-4" aria-hidden="true" /> : count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="statistics">
        {reportPending || (report && report.recentMatches.length > 0) ? (
          <div className="profile-table profile-statistics-table">
            <ReportMatchTable report={report} pending={reportPending} />
          </div>
        ) : (
          <Empty icon={<TableProperties />}>{t('noMatchStatistics')}</Empty>
        )}
      </TabsContent>
      <TabsContent value="encounters">
        {profilePending ? (
          <ProfileRecordLoading
            columns={['map', 'team', 'result', 'time']}
            label={t('encounters')}
          />
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
            <div className="profile-table">
              <Table>
                <TableCaption className="sr-only">{t('encounters')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('map')}</TableHead>
                    <TableHead>{t('team')}</TableHead>
                    <TableHead>{t('result')}</TableHead>
                    <TableHead>{t('time')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {encounters.map((encounter, index) => (
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
                      <TableCell className="profile-time">
                        {formatTime(encounter.at, locale)}
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
        {reportPending ? (
          <ProfileRecordLoading
            columns={['map', 'totalMatches', 'winRate']}
            label={t('mapStatistics')}
          />
        ) : report && report.mapStats.length > 0 ? (
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
                {report.mapStats.map((map) => (
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
    </Tabs>
  );
}

function ProfileRecordLoading({ columns, label }: { columns: string[]; label: string }) {
  const { t } = useI18n();
  return (
    <div className="profile-table">
      <Table aria-busy="true">
        <TableCaption className="sr-only">{label}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{t(column)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <ProfileTableSkeleton columns={columns} />
        </TableBody>
      </Table>
    </div>
  );
}
