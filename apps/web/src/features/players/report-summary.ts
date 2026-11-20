import { BATRACE_ORIGIN, type Locale, type PlayerReport } from '@ba/contracts';
import { formatMetric, formatTime } from '@ba/shared';
import { translate } from '../../hooks/useI18n';

type SummaryData = Pick<
  PlayerReport,
  | 'name'
  | 'id'
  | 'elo'
  | 'winRate'
  | 'wins'
  | 'losses'
  | 'sampleCount'
  | 'fallback'
  | 'kd'
  | 'dmr'
  | 'favUnits'
  | 'stale'
  | 'updatedAt'
>;

const singleLine = (value: string) => value.trim().replace(/\s+/g, ' ');

export function formatPlayerSummary(report: SummaryData, locale: Locale): string {
  const title = [singleLine(report.name), `#${report.id}`].filter(Boolean).join(' ');
  const lines = [report.elo === null ? title : `${title} · ELO ${formatMetric(report.elo, 0)}`];
  if (report.winRate !== null && report.sampleCount > 0) {
    lines.push(
      translate(locale, report.fallback ? 'summaryWinRate' : 'summaryRecentWinRate', {
        rate: formatMetric(report.winRate),
        wins: report.wins,
        losses: report.losses,
      }),
    );
  }
  const latest = [
    report.kd !== null && `K/D ${formatMetric(report.kd)}`,
    report.dmr !== null && `DMR ${formatMetric(report.dmr)}`,
  ].filter(Boolean);
  if (latest.length)
    lines.push(translate(locale, 'summaryLatestMatch', { stats: latest.join(' · ') }));
  const units = [...new Set(report.favUnits.map((unit) => singleLine(unit.name)).filter(Boolean))];
  if (units.length)
    lines.push(
      translate(locale, 'summaryHighlightUnits', {
        units:
          units.slice(0, 3).join(locale === 'zh' ? '、' : ', ') + (units.length > 3 ? '…' : ''),
      }),
    );
  if (report.stale)
    lines.push(
      [translate(locale, 'stale'), report.updatedAt > 0 && formatTime(report.updatedAt, locale)]
        .filter(Boolean)
        .join(' · '),
    );
  lines.push(`${BATRACE_ORIGIN}/player/${encodeURIComponent(report.id)}`);
  return lines.join('\n');
}
