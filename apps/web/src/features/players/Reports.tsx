import {
  Card as ReportCard,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { BATRACE_ORIGIN } from '@ba/contracts';
import type { PlayerReport } from '@ba/contracts';
import { useRef, type ReactNode } from 'react';
import { formatMetric, formatDelta, formatTime } from '@ba/shared';
import { eloChangeClass } from '@/lib/elo';
import { Badge, Button, Notice, Stats } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { useApp } from '../../app/state';
import { PlayerPreferences } from './PlayerPreferences';
import { MaggotCard } from './MaggotCard';
import { ProfileTableSkeleton } from './ProfileTableSkeleton';
import { MapPerformanceGrid } from './MapPerformanceGrid';
import { Skeleton } from '@/components/ui/skeleton';
import { OverflowHint } from '../../components/OverflowHint';

export function ReportCopyButton({ report }: { report: PlayerReport | null }) {
  const { t } = useI18n(),
    { notify } = useApp();
  return (
    <Button
      disabled={!report}
      onClick={() =>
        report &&
        void navigator.clipboard
          .writeText(
            `${report.name} · ELO ${formatMetric(report.elo, 0)} · ${t(report.fallback ? 'winRate' : 'recentWinRate')} ${formatMetric(report.winRate, 0)}% (${report.sampleCount}) · ${report.favUnits.map((u) => u.name).join(', ')}`,
          )
          .then(() => notify(t('copied')))
          .catch((e) => notify(String(e), true))
      }
    >
      {t('copy')}
    </Button>
  );
}
function ReportDetails({
  embedded,
  label,
  children,
}: {
  embedded: boolean;
  label: string;
  children: ReactNode;
}) {
  return embedded ? (
    <Accordion type="single" collapsible className="profile-report-details">
      <AccordionItem value="details">
        <AccordionTrigger>{label}</AccordionTrigger>
        <AccordionContent>{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  ) : (
    children
  );
}
export function ReportView({
  report,
  embedded = false,
  pending = false,
  id,
  name,
}: {
  report: PlayerReport | null;
  embedded?: boolean;
  pending?: boolean;
  id?: string;
  name?: string;
}) {
  const { t, locale } = useI18n(),
    { api, openModal, notify } = useApp();
  const playerId = report?.id ?? id ?? '';
  const ReportContainer = embedded ? 'div' : ReportCard;
  const ReportContent = embedded ? 'div' : CardContent;
  return (
    <ReportContainer
      className={cn('report min-w-0', embedded && 'report-embedded')}
      aria-busy={pending}
    >
      {!embedded && (
        <CardHeader className="report-heading flex flex-wrap items-start justify-between gap-3 [&>[data-slot='card-action']]:ml-auto [&_[data-slot='card-title']]:wrap-anywhere">
          <div className="min-w-0">
            <CardTitle
              role="heading"
              aria-level={3}
              aria-label={report ? `${report.name} #${report.id}` : undefined}
            >
              {report?.name ?? name ?? <Skeleton className="h-6 w-40" aria-hidden="true" />}
            </CardTitle>
            <CardDescription className="report-identity-meta flex flex-wrap gap-y-1 gap-x-3 mt-1">
              <span>#{playerId}</span>
              <span>
                {t('totalMatches')}{' '}
                {report ? (
                  report.matchCount
                ) : (
                  <Skeleton className="inline-block h-3 w-8" aria-hidden="true" />
                )}
              </span>
              <span>
                {t('samples')}{' '}
                {report ? (
                  report.sampleCount
                ) : (
                  <Skeleton className="inline-block h-3 w-8" aria-hidden="true" />
                )}
              </span>
            </CardDescription>
          </div>
          <CardAction className="actions flex items-center gap-2 flex-wrap [.add-match-form_&]:justify-end [.dialog-body>&:last-child]:justify-end viewport-max-767:[.profile-toolbar>&]:gap-1.5">
            <Button
              disabled={!report}
              onClick={() =>
                report && openModal({ type: 'profile', id: report.id, name: report.name })
              }
            >
              {t('investigate')}
            </Button>
            <ReportCopyButton report={report} />
          </CardAction>
        </CardHeader>
      )}
      <ReportContent className="report-content flex min-w-0 flex-col gap-4 @container/profile-overview [.report-embedded_&]:p-0">
        {report?.stale && (
          <Notice>
            {t('stale')} · {formatTime(report.updatedAt, locale)}
          </Notice>
        )}
        <Stats
          items={[
            { label: 'ELO', value: formatMetric(report?.elo ?? null, 0), pending },
            { label: t('latestKd'), value: formatMetric(report?.kd ?? null), pending },
            { label: t('latestDmr'), value: formatMetric(report?.dmr ?? null), pending },
            {
              label: t(report?.fallback ? 'winRate' : 'recentWinRate'),
              value: report?.winRate == null ? '—' : formatMetric(report.winRate, 0) + '%',
              pending,
            },
            ...(embedded
              ? [
                  { label: t('totalMatches'), value: report?.matchCount ?? '—', pending },
                  { label: t('samples'), value: report?.sampleCount ?? '—', pending },
                ]
              : []),
          ]}
        />
        <PlayerPreferences id={playerId} report={report} pending={pending} showMaggot={false} />
        {!embedded && <MaggotCard id={playerId} enabled={Boolean(report)} />}
        {(pending || Boolean(report?.mapStats.length)) && (
          <ReportDetails embedded label={t('mapStatistics')}>
            <MapPerformanceGrid maps={report?.mapStats ?? []} pending={pending} />
          </ReportDetails>
        )}
        {(pending || Boolean(report?.recentMatches.length)) && (
          <ReportDetails embedded={embedded} label={t('matchStatistics')}>
            <ReportMatchTable
              report={report}
              pending={pending}
              label={t(embedded ? 'matchStatistics' : 'recent')}
            />
          </ReportDetails>
        )}
        {!embedded && (
          <Button
            variant="ghost"
            className="self-start"
            disabled={!report}
            onClick={() =>
              report &&
              void api
                .invoke('external.open', { url: `${BATRACE_ORIGIN}/player/${report.id}` })
                .catch((error) => notify(String(error), true))
            }
          >
            {t('openBatrace')}
          </Button>
        )}
      </ReportContent>
    </ReportContainer>
  );
}
export function ReportMatchTable({
  report,
  label,
  pending = false,
}: {
  report: PlayerReport | null;
  label?: string;
  pending?: boolean;
}) {
  const { t, locale } = useI18n();
  const { openModal } = useApp();
  const scroll = useRef<HTMLDivElement>(null);
  const columns = [
    { key: 'matchId', minWidth: 'min-w-[clamp(6rem,12cqi,8rem)]' },
    {
      key: 'result',
      minWidth:
        locale === 'en'
          ? 'min-w-22 @[60rem]/report-matches:min-w-24'
          : 'min-w-16 @[60rem]/report-matches:min-w-18',
    },
    { key: 'eloDelta', minWidth: 'min-w-[clamp(5.5rem,11cqi,7rem)]' },
    { key: 'K/D', minWidth: 'min-w-[clamp(3.5rem,7cqi,4.5rem)]' },
    { key: 'DMR', minWidth: 'min-w-[clamp(3.5rem,7cqi,4.5rem)]' },
    { key: 'destruction', minWidth: 'min-w-[clamp(5.5rem,11cqi,8rem)]' },
    { key: 'losses', minWidth: 'min-w-[clamp(5.5rem,11cqi,8rem)]' },
    {
      key: 'objectives',
      minWidth:
        locale === 'en'
          ? 'min-w-[clamp(5.5rem,11cqi,6.5rem)]'
          : 'min-w-[clamp(3.5rem,7cqi,4.5rem)]',
    },
    { key: 'time', minWidth: 'min-w-38' },
  ];
  return (
    <div className="report-match-region @container/report-matches min-w-0">
      <div
        ref={scroll}
        className="table-wrap report-match-table relative min-w-0 overflow-auto [.report_&]:max-h-120 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:-outline-offset-2 [&>[data-slot='table-container']]:overflow-visible"
        tabIndex={0}
        role="region"
        aria-label={`${label ?? t('matchStatistics')} · ${t('tableScrollHint')}`}
      >
        <Table
          aria-busy={pending}
          className="table-auto [&_th]:px-2 [&_th]:py-2.5 [&_td]:px-2 [&_td]:py-2.5 [&_[data-slot='skeleton']]:w-full @[60rem]/report-matches:[&_th]:px-3 @[60rem]/report-matches:[&_td]:px-3"
        >
          <TableCaption className="sr-only">{label ?? t('matchStatistics')}</TableCaption>
          <colgroup>
            {columns.map(({ key }) => (
              <col key={key} className={cn(key !== 'time' && 'w-px')} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              {columns.map(({ key, minWidth }) => (
                <TableHead
                  key={key}
                  data-column={key}
                  className={cn(
                    'text-xs',
                    minWidth,
                    key === 'matchId' && 'sticky left-0 z-1 bg-card',
                    key === 'result' && 'text-center',
                    !['matchId', 'result', 'time'].includes(key) && 'text-right tabular-nums',
                  )}
                >
                  {t(key)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending && !report && <ProfileTableSkeleton columns={columns.map(({ key }) => key)} />}
            {report?.recentMatches.map((m) => (
              <TableRow key={m.matchId}>
                <TableCell data-column="matchId" className="sticky left-0 z-1 bg-card">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto min-h-6 max-w-full justify-start p-0 whitespace-normal text-left wrap-anywhere"
                    onClick={() => openModal({ type: 'match', fid: m.matchId })}
                  >
                    #{m.matchId}
                  </Button>
                </TableCell>
                <TableCell data-column="result" className="text-center">
                  <Badge tone={m.won === true ? 'success' : m.won === false ? 'danger' : 'muted'}>
                    {m.won === null ? t('unknown') : m.won ? t('win') : t('loss')}
                  </Badge>
                </TableCell>
                <TableCell
                  data-column="eloDelta"
                  className={cn('elo-column text-right tabular-nums', eloChangeClass(m.eloDelta))}
                >
                  {formatDelta(m.eloDelta)}
                </TableCell>
                <TableCell data-column="K/D" className="text-right tabular-nums">
                  {formatMetric(m.kd)}
                </TableCell>
                <TableCell data-column="DMR" className="text-right tabular-nums">
                  {formatMetric(m.dmr)}
                </TableCell>
                <TableCell data-column="destruction" className="text-right tabular-nums">
                  {formatMetric(m.destruction, 0)}
                </TableCell>
                <TableCell data-column="losses" className="text-right tabular-nums">
                  {formatMetric(m.losses, 0)}
                </TableCell>
                <TableCell data-column="objectives" className="text-right tabular-nums">
                  {formatMetric(m.objectives, 0)}
                </TableCell>
                <TableCell data-column="time" className="tabular-nums">
                  {formatTime(m.endTime, locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <OverflowHint viewport={scroll} />
    </div>
  );
}
