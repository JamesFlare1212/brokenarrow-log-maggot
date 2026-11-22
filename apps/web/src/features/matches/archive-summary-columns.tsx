import type { ColumnDef } from '@tanstack/react-table';
import type { Locale, Match } from '@ba/contracts';
import { formatDelta } from '@ba/shared';
import { eloChangeClass } from '@/lib/elo';
import { Badge } from '../../components/ui';
import type { ComponentType } from 'react';
import { translate } from '../../hooks/useI18n';

export function archiveSummaryColumns(
  locale: Locale,
  MapAction?: ComponentType<{ match: Match; name: string }>,
): ColumnDef<Match>[] {
  const t = (key: string) => translate(locale, key);
  return [
    {
      id: 'mode',
      accessorKey: 'mode',
      header: t('mode'),
      size: locale === 'en' ? 120 : 84,
      cell: ({ row }) => (
        <Badge>
          {t(
            !row.original.fid && row.original.mode === 'unknown'
              ? 'matchUnrecorded'
              : row.original.mode,
          )}
        </Badge>
      ),
    },
    {
      id: 'map',
      accessorKey: 'map',
      header: t('map'),
      size: 160,
      cell: ({ row }) => {
        const match = row.original;
        const name = match.map || (match.fid ? '#' + match.fid : t('matchUnrecorded'));
        return MapAction ? (
          <MapAction match={match} name={name} />
        ) : (
          <span className="archive-map-name whitespace-normal wrap-anywhere">{name}</span>
        );
      },
    },
    {
      id: 'eloDelta',
      accessorFn: (match) =>
        match.eloAfter !== null && match.eloBefore !== null
          ? match.eloAfter - match.eloBefore
          : undefined,
      header: t('eloDelta'),
      size: locale === 'en' ? 128 : 112,
      meta: { align: 'right' },
      sortUndefined: 'last',
      cell: ({ row }) => {
        const match = row.original,
          delta =
            match.eloAfter !== null && match.eloBefore !== null
              ? match.eloAfter - match.eloBefore
              : null;
        return <span className={eloChangeClass(delta)}>{formatDelta(delta)}</span>;
      },
    },
  ];
}
