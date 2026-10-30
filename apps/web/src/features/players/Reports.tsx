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
import { Copy } from 'lucide-react';
import type { PlayerReport } from '@ba/contracts';
import { useId, type ReactNode } from 'react';
import { formatMetric, formatDelta, formatTime, formatPercent } from '@ba/shared';
import { eloChangeClass } from '@/lib/elo';
import { Badge, Button, Stats } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { useApp } from '../../app/state';
import { useClipboard } from '../../hooks/useClipboard';
import { MaggotCard } from './MaggotCard';
import { PlayerReportStatus } from './PlayerReportStatus';
import { hasReportSection, type PlayerReportRequest } from '../../hooks/usePlayerReports';
export function ReportCopyButton({
  report,
  iconOnly = false,
}: {
  report: PlayerReport | null;
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const copy = useClipboard();
  const summary = report
    ? [
        report.name,
        `ELO ${formatMetric(report.elo, 0)}`,
        `${t(report.fallback ? 'winRate' : 'recentWinRate')} ${formatPercent(report.winRate)} (${formatMetric(report.sampleCount, 0)})`,
        report.favUnits.map((unit) => unit.name).join(', '),
        report.fallback && (report.wins === null || report.losses === null)
          ? t('reportOutcomeCountsUnavailable')
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <Button
      variant={iconOnly ? 'ghost' : undefined}
      size={iconOnly ? 'icon-sm' : undefined}
      aria-label={iconOnly ? t('copy') : undefined}
      aria-disabled={!report}
      tooltip={iconOnly && !report ? t('reportCopyUnavailable') : undefined}
      onClick={() => {
        if (!report) return;
        void copy(summary);
      }}
    >
      {iconOnly ? <Copy aria-hidden="true" /> : t('copy')}
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
  report: initialReport,
  embedded = false,
  request,
  id,
}: {
  report: PlayerReport | null;
  embedded?: boolean;
  request?: PlayerReportRequest;
  id?: string;
}) {
  const { t } = useI18n(),
    { api, openModal, notify, reports, loadReport } = useApp();
  const reportId = initialReport?.id ?? id;
  const shared = request ?? (reportId ? reports[reportId] : undefined);
  const report = shared?.data ?? initialReport;
  const matchRecords =
    shared?.details.matches ?? (hasReportSection(report, 'matches') ? report : null);
  const mapRecords = shared?.details.maps ?? (hasReportSection(report, 'maps') ? report : null);
  const ReportContainer = embedded ? 'div' : ReportCard;
  const ReportContent = embedded ? 'div' : CardContent;
  if (!report) {
    return (
      <ReportContainer className={cn('report', embedded && 'report-embedded')}>
        <ReportContent key="content" className="report-content">
          <PlayerReportStatus
            key={reportId}
            request={shared}
            onRetry={() => {
              if (reportId) void loadReport(reportId, true);
            }}
          />
        </ReportContent>
      </ReportContainer>
    );
  }
  return (
    <ReportContainer className={cn('report', embedded && 'report-embedded')}>
      {!embedded && (
        <CardHeader className="report-heading">
          <div className="min-w-0">
            <CardTitle
              className="whitespace-normal wrap-anywhere"
              role="heading"
              aria-level={3}
              aria-label={`${report.name} #${report.id}`}
            >
              {report.name}
            </CardTitle>
            <CardDescription className="report-identity-meta">
              <span>#{report.id}</span>
              <span>
                {t('totalMatches')} {formatMetric(report.matchCount, 0)}
              </span>
              <span>
                {t('samples')} {formatMetric(report.sampleCount, 0)}
              </span>
            </CardDescription>
          </div>
          <CardAction className="actions">
            <Button
              onClick={() => openModal({ type: 'profile', id: report.id, name: report.name })}
            >
              {t('investigate')}
            </Button>
            <ReportCopyButton report={report} />
          </CardAction>
        </CardHeader>
      )}
      <ReportContent key="content" className="report-content">
        <PlayerReportStatus
          key={report.id}
          request={shared}
          report={report}
          onRetry={() => void loadReport(report.id, true)}
        />
        <Stats
          items={[
            { label: 'ELO', value: formatMetric(report.elo, 0) },
            { label: t('latestKd'), value: formatMetric(report.kd) },
            { label: t('latestDmr'), value: formatMetric(report.dmr) },
            {
              label: t(report.fallback ? 'winRate' : 'recentWinRate'),
              value: formatPercent(report.winRate),
            },
            ...(embedded
              ? [
                  { label: t('totalMatches'), value: formatMetric(report.matchCount, 0) },
                  { label: t('samples'), value: formatMetric(report.sampleCount, 0) },
                ]
              : []),
          ]}
        />
        {(report.categories.length > 0 || report.favUnits.length > 0 || report.style) && (
          <div className="report-tags">
            {report.categories.length > 0 && <span>{t('preference')}</span>}
            {report.categories.map((c) => (
              <Badge key={c.key}>
                {t('cat.' + c.key.toLowerCase()) === 'cat.' + c.key.toLowerCase()
                  ? c.key
                  : t('cat.' + c.key.toLowerCase())}{' '}
                {formatPercent(c.pct)}
              </Badge>
            ))}
            {report.favUnits.length > 0 && <span>{t('units')}</span>}
            {report.favUnits.map((u) => (
              <Badge key={u.name}>
                {u.name} · {formatMetric(u.value, 0)}
              </Badge>
            ))}
            {report.style && (
              <Badge>
                {t('style')}:{' '}
                {t('style.' + report.style.toLowerCase()) === 'style.' + report.style.toLowerCase()
                  ? report.style
                  : t('style.' + report.style.toLowerCase())}
              </Badge>
            )}
          </div>
        )}
        {!embedded && <MaggotCard id={report.id} />}
        {mapRecords && mapRecords.mapStats.length > 0 && (
          <ReportDetails embedded label={t('mapStatistics')}>
            <div className="report-tags">
              {mapRecords.mapStats.map((m) => (
                <Badge key={m.mapId ?? m.name}>
                  {m.name} · {formatPercent(m.winRate)} ({m.matchCount})
                </Badge>
              ))}
            </div>
          </ReportDetails>
        )}
        {!!matchRecords?.recentMatches.length && (
          <ReportDetails embedded={embedded} label={t('matchStatistics')}>
            <ReportMatchTable
              report={matchRecords}
              label={t(embedded ? 'matchStatistics' : 'recent')}
            />
          </ReportDetails>
        )}
        {!embedded && (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() =>
              void api
                .invoke('external.open', { url: `${BATRACE_ORIGIN}/player/${report.id}` })
                .catch((e) => notify(String(e), true))
            }
          >
            {t('openBatrace')}
          </Button>
        )}
      </ReportContent>
    </ReportContainer>
  );
}
export function ReportMatchTable({ report, label }: { report: PlayerReport; label?: string }) {
  const { t, locale } = useI18n();
  const { openModal } = useApp();
  const id = useId();
  return (
    <div className="report-match-data">
      <p id={`${id}-hint`} className="report-match-hint">
        {t('reportMatchScrollHint')}
      </p>
      <div
        className="table-wrap report-match-table"
        role="region"
        aria-label={label ?? t('matchStatistics')}
        aria-describedby={`${id}-hint`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !['ArrowLeft', 'ArrowRight'].includes(event.key)
          )
            return;
          event.preventDefault();
          event.currentTarget.scrollLeft +=
            (event.key === 'ArrowLeft' ? -1 : 1) *
            Math.max(40, event.currentTarget.clientWidth / 2);
        }}
      >
        <Table>
          <TableCaption className="sr-only">{label ?? t('matchStatistics')}</TableCaption>
          <TableHeader>
            <TableRow>
              {[
                'matchId',
                'result',
                'eloDelta',
                'K/D',
                'DMR',
                'destruction',
                'losses',
                'objectives',
              ].map((k) => (
                <TableHead
                  key={k}
                  data-column={k}
                  className={k === 'eloDelta' ? 'elo-column' : undefined}
                >
                  {k === 'matchId' ? `${t(k)} · ${t('time')}` : t(k)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.recentMatches.map((m, index) => (
              <TableRow key={m.matchId}>
                <TableCell data-column="matchId">
                  <div className="report-match-identity">
                    <Button
                      variant="link"
                      size="sm"
                      aria-describedby={`${id}-${index}-time ${id}-${index}-result`}
                      data-dialog-focus={`report-match:${m.matchId}`}
                      onClick={() => openModal({ type: 'match', fid: m.matchId })}
                    >
                      #{m.matchId}
                    </Button>
                    <span
                      id={`${id}-${index}-time`}
                      data-column="time"
                      className="report-match-time"
                    >
                      {m.endTime === null ? t('matchTimeUnknown') : formatTime(m.endTime, locale)}
                    </span>
                  </div>
                </TableCell>
                <TableCell id={`${id}-${index}-result`} data-column="result">
                  <Badge tone={m.won === true ? 'success' : m.won === false ? 'danger' : 'muted'}>
                    {m.won === null ? t('unknown') : m.won ? t('win') : t('loss')}
                  </Badge>
                </TableCell>
                <TableCell
                  data-column="eloDelta"
                  className={cn('elo-column', eloChangeClass(m.eloDelta))}
                >
                  {formatDelta(m.eloDelta)}
                </TableCell>
                <TableCell data-column="K/D">{formatMetric(m.kd)}</TableCell>
                <TableCell data-column="DMR">{formatMetric(m.dmr)}</TableCell>
                <TableCell data-column="destruction">{formatMetric(m.destruction, 0)}</TableCell>
                <TableCell data-column="losses">{formatMetric(m.losses, 0)}</TableCell>
                <TableCell data-column="objectives">{formatMetric(m.objectives, 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
