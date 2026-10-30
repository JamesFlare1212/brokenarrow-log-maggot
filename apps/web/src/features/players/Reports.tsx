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
import type { ReactNode } from 'react';
import { formatMetric, formatDelta, formatTime } from '@ba/shared';
import { eloChangeClass } from '@/lib/elo';
import { Badge, Button, Notice, Stats } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { useApp } from '../../app/state';
import { MaggotCard } from './MaggotCard';
import { ProfileTableSkeleton } from './ProfileTableSkeleton';

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
}: {
  report: PlayerReport;
  embedded?: boolean;
}) {
  const { t, locale } = useI18n(),
    { api, openModal, notify } = useApp();
  const ReportContainer = embedded ? 'div' : ReportCard;
  const ReportContent = embedded ? 'div' : CardContent;
  return (
    <ReportContainer className={cn('report', embedded && 'report-embedded')}>
      {!embedded && (
        <CardHeader className="report-heading">
          <div className="min-w-0">
            <CardTitle role="heading" aria-level={3} aria-label={`${report.name} #${report.id}`}>
              {report.name}
            </CardTitle>
            <CardDescription className="report-identity-meta">
              <span>#{report.id}</span>
              <span>
                {t('totalMatches')} {report.matchCount}
              </span>
              <span>
                {t('samples')} {report.sampleCount}
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
      <ReportContent className="report-content">
        {report.stale && (
          <Notice>
            {t('stale')} · {formatTime(report.updatedAt, locale)}
          </Notice>
        )}
        <Stats
          items={[
            { label: 'ELO', value: formatMetric(report.elo, 0) },
            { label: t('latestKd'), value: formatMetric(report.kd) },
            { label: t('latestDmr'), value: formatMetric(report.dmr) },
            {
              label: t(report.fallback ? 'winRate' : 'recentWinRate'),
              value: formatMetric(report.winRate, 0) + '%',
            },
            ...(embedded
              ? [
                  { label: t('totalMatches'), value: report.matchCount },
                  { label: t('samples'), value: report.sampleCount },
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
                {formatMetric(c.pct, 0)}%
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
        {report.mapStats.length > 0 && (
          <ReportDetails embedded label={t('mapStatistics')}>
            <div className="report-tags">
              {report.mapStats.map((m) => (
                <Badge key={m.mapId ?? m.name}>
                  {m.name} · {formatMetric(m.winRate, 0)}% ({m.matchCount})
                </Badge>
              ))}
            </div>
          </ReportDetails>
        )}
        {!!report.recentMatches.length && (
          <ReportDetails embedded={embedded} label={t('matchStatistics')}>
            <ReportMatchTable report={report} label={t(embedded ? 'matchStatistics' : 'recent')} />
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
  const columns = [
    'matchId',
    'result',
    'eloDelta',
    'K/D',
    'DMR',
    'destruction',
    'losses',
    'objectives',
    'time',
  ];
  return (
    <div className="table-wrap report-match-table">
      <Table aria-busy={pending}>
        <TableCaption className="sr-only">{label ?? t('matchStatistics')}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((k) => (
              <TableHead
                key={k}
                data-column={k}
                className={k === 'eloDelta' ? 'elo-column' : undefined}
              >
                {t(k)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pending && !report && <ProfileTableSkeleton columns={columns} />}
          {report?.recentMatches.map((m) => (
            <TableRow key={m.matchId}>
              <TableCell data-column="matchId">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => openModal({ type: 'match', fid: m.matchId })}
                >
                  #{m.matchId}
                </Button>
              </TableCell>
              <TableCell data-column="result">
                <Badge tone={m.won === true ? 'success' : m.won === false ? 'danger' : 'muted'}>
                  {m.won === null ? t('unknown') : m.won ? t('win') : t('loss')}
                </Badge>
              </TableCell>
              <TableCell className={cn('elo-column', eloChangeClass(m.eloDelta))}>
                {formatDelta(m.eloDelta)}
              </TableCell>
              <TableCell>{formatMetric(m.kd)}</TableCell>
              <TableCell data-column="DMR">{formatMetric(m.dmr)}</TableCell>
              <TableCell>{formatMetric(m.destruction, 0)}</TableCell>
              <TableCell>{formatMetric(m.losses, 0)}</TableCell>
              <TableCell>{formatMetric(m.objectives, 0)}</TableCell>
              <TableCell data-column="time">{formatTime(m.endTime, locale)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
