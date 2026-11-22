import { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { Match } from '@ba/contracts';
import { DataTable } from '../../components/DataTable';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { archiveSummaryColumns } from '../matches/archive-summary-columns';

function RecentMapAction({ match, name }: { match: Match; name: string }) {
  const { openModal } = useApp();
  return (
    <Button
      variant="link"
      size="sm"
      className="flex h-auto min-h-5 max-w-full justify-start border-0 whitespace-normal wrap-anywhere p-0 text-left"
      aria-haspopup="dialog"
      onClick={() => openModal({ type: 'match', fid: match.fid || match.id })}
    >
      {name}
    </Button>
  );
}

export function RecentMatchTable({ matches, loading }: { matches: Match[]; loading: boolean }) {
  const { openModal } = useApp();
  const { locale, t } = useI18n();
  const open = useCallback(
    (match: Match) => openModal({ type: 'match', fid: match.fid || match.id }),
    [openModal],
  );
  const columns = useMemo(() => archiveSummaryColumns(locale, RecentMapAction), [locale]);
  const table = useReactTable({
    data: matches,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false,
  });
  return (
    <DataTable
      className="recent-matches [--table-skeleton-content-height:1.25rem] [scrollbar-gutter:auto] [&_[data-slot='badge']]:flex [&_[data-slot='table-cell']]:px-2 [&_[data-slot='table-head']]:px-2"
      table={table}
      label={t('recent')}
      pending={loading}
      loading={loading}
      loadingRows={3}
      empty={null}
      onRowOpen={open}
    />
  );
}
