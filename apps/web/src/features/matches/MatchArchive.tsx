import {
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { DataTable } from '../../components/DataTable';
import { Input } from '@/components/ui/input';
import {
  Field as FormField,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Archive as faBoxArchive,
  Plus as faPlus,
  RefreshCw as faArrowsRotate,
  LayoutGrid,
  List,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { Match, Account } from '@ba/contracts';
import { formatTime, formatDelta, formatDuration, outcomeTone } from '@ba/shared';
import { eloChangeClass } from '@/lib/elo';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Badge, Field, Notice, Empty, Menu, Toggle, Dialog } from '../../components/ui';
import { Pagination } from '../../components/Pagination';
import { MatchArchiveCard, MatchArchiveCardSkeleton } from './MatchArchiveCard';
import { LoadingStatus } from '../../components/LoadingState';
import { Skeleton } from '@/components/ui/skeleton';
const PAGE_SIZE = 50;
export function MatchArchive() {
  const confirm = useConfirmation();
  const { api, state, openModal, notify } = useApp(),
    { t, locale } = useI18n(),
    matches = useRequest<Match[]>(),
    [accounts, setAccounts] = useState<Account[]>([]),
    [account, setAccount] = useState(''),
    [fid, setFid] = useState(''),
    [adding, setAdding] = useState(false),
    [addError, setAddError] = useState<string | null>(null),
    [addDialog, setAddDialog] = useState(false),
    [scanning, setScanning] = useState(false),
    [hideUnknown, setHideUnknown] = useState(true),
    [view, setView] = useState<'grid' | 'list'>('list'),
    [page, setPage] = useState(1),
    [sorting, setSorting] = useState<SortingState>([{ id: 'time', desc: true }]),
    [outcome, setOutcome] = useState<'all' | 'win' | 'loss'>('all');
  const table = useRef<HTMLDivElement>(null);
  const validFid = /^\d+$/.test(fid.trim());
  const fidError = addError || (fid.trim() && !validFid ? t('matchIdInvalid') : null);
  const filtered = useMemo(
    () =>
      [...(matches.data || [])]
        .sort((a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0))
        .filter(
          (m) =>
            (outcome === 'all' || m.outcome === outcome) &&
            (!hideUnknown || m.outcome !== 'unknown'),
        ),
    [matches.data, outcome, hideUnknown],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const loading = !matches.data && (matches.pending || !matches.error);
  useLayoutEffect(() => {
    if (table.current) table.current.scrollTop = 0;
  }, [currentPage, account, outcome, hideUnknown, sorting, view]);
  const refresh = () =>
    void matches.load(
      () => api.invoke('matches.list', account ? { accountId: account } : {}),
      true,
    );
  const scan = async () => {
    setScanning(true);
    try {
      await api.invoke('matches.scan', null);
    } catch (error) {
      notify(String(error), true);
    } finally {
      refresh();
      setScanning(false);
    }
  };
  useEffect(() => {
    refresh();
    void api
      .invoke('accounts.list', null)
      .then(setAccounts)
      .catch((e) => notify(String(e), true));
  }, [api, state.matchesRevision, account]);
  const columns = useMemo<ColumnDef<Match>[]>(
    () => [
      {
        id: 'result',
        accessorKey: 'outcome',
        header: t('result'),
        size: 76,
        cell: ({ row }) => (
          <Badge tone={outcomeTone(row.original.outcome)}>
            {row.original.restarted ? t('restarted') : t(row.original.outcome)}
          </Badge>
        ),
      },
      {
        id: 'mode',
        accessorKey: 'mode',
        header: t('mode'),
        size: 84,
        cell: ({ row }) => <Badge>{t(row.original.mode)}</Badge>,
      },
      {
        id: 'map',
        accessorKey: 'map',
        header: t('map'),
        size: 160,
        cell: ({ row }) => (
          <Button
            variant="link"
            size="sm"
            className="archive-open-match"
            onClick={() =>
              row.original.fid
                ? openModal({ type: 'match', fid: row.original.fid })
                : notify(t('offline'))
            }
          >
            {row.original.map || '#' + row.original.id}
          </Button>
        ),
      },
      {
        id: 'eloDelta',
        accessorFn: (match) =>
          match.eloAfter !== null && match.eloBefore !== null
            ? match.eloAfter - match.eloBefore
            : undefined,
        header: t('eloDelta'),
        size: 110,
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
      {
        id: 'duration',
        accessorKey: 'durationSec',
        header: t('duration'),
        size: 100,
        cell: ({ row }) => formatDuration(row.original.durationSec),
      },
      {
        id: 'time',
        accessorFn: (match) => match.endedAt ?? match.startedAt ?? 0,
        header: t('time'),
        size: 160,
        cell: ({ row }) => formatTime(row.original.endedAt ?? row.original.startedAt, locale),
      },
      {
        id: 'account',
        accessorKey: 'localPersona',
        header: t('account'),
        size: 150,
        cell: ({ row }) => row.original.localPersona || '—',
      },
      {
        id: 'actions',
        header: t('actions'),
        size: 64,
        enableSorting: false,
        cell: ({ row }) => {
          const match = row.original;
          return (
            <Menu label={`${t('actions')}: #${match.fid || match.id}`}>
              {match.fid && (
                <>
                  <Button
                    onClick={() =>
                      void api
                        .invoke('matches.detail', { fid: match.fid || '', force: true })
                        .then(() => refresh())
                        .catch((error) => notify(String(error), true))
                    }
                  >
                    {t('refresh')}
                  </Button>
                  <Button
                    onClick={() =>
                      void api
                        .invoke('external.open', { url: `${BATRACE_ORIGIN}/match/${match.fid}` })
                        .catch((error) => notify(String(error), true))
                    }
                  >
                    {t('openBatrace')}
                  </Button>
                </>
              )}
              <Button
                variant="destructive"
                onClick={async () => {
                  if (
                    await confirm({
                      title: t('confirmation.deleteMatch'),
                      description: t('confirmation.deleteHint'),
                      detail: `${match.map} · #${match.fid || match.id}`,
                      confirmLabel: t('delete'),
                    })
                  )
                    void api
                      .invoke('matches.delete', { id: match.id })
                      .then(() => refresh())
                      .catch((error) => notify(String(error), true));
                }}
              >
                {t('delete')}
              </Button>
            </Menu>
          );
        },
      },
    ],
    [api, account, locale, openModal, notify, confirm, matches.load],
  );
  const dataTable = useReactTable({
    data: filtered,
    columns,
    getRowId: (match) => match.id,
    state: { sorting, pagination: { pageIndex: currentPage - 1, pageSize: PAGE_SIZE } },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1);
    },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex: currentPage - 1, pageSize: PAGE_SIZE })
          : updater;
      setPage(next.pageIndex + 1);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const empty = (
    <Empty
      icon={<Icon icon={faBoxArchive} size={26} />}
      description={t('noMatchesHint')}
      action={
        outcome !== 'all' || account || hideUnknown ? (
          <Button
            onClick={() => {
              setOutcome('all');
              setAccount('');
              setHideUnknown(false);
              setPage(1);
            }}
          >
            {t('clearFilters')}
          </Button>
        ) : undefined
      }
    >
      {t(outcome !== 'all' || account || hideUnknown ? 'noFilteredMatches' : 'empty')}
    </Empty>
  );
  return (
    <section className="archive-panel" aria-label={t('archive')}>
      <div className="archive-toolbar">
        <div className="archive-filters">
          <Field id="archive-account" label={t('account')} labelHidden>
            <NativeSelect
              id="archive-account"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                setPage(1);
              }}
            >
              <NativeSelectOption value="">{t('allAccounts')}</NativeSelectOption>
              {accounts.map((a) => (
                <NativeSelectOption key={a.id} value={a.id}>
                  {a.name} · #{a.id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <ToggleGroup
            type="single"
            variant="outline"
            value={outcome}
            onValueChange={(value) => {
              if (value) {
                setOutcome(value as typeof outcome);
                setPage(1);
              }
            }}
            aria-label={t('result')}
          >
            {(['all', 'win', 'loss'] as const).map((value) => (
              <ToggleGroupItem value={value} key={value}>
                {t(value === 'all' ? 'allResults' : value === 'win' ? 'winsOnly' : 'lossesOnly')}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Toggle
            id="archive-hide-unknown"
            label={t('hideUnknownResults')}
            checked={hideUnknown}
            onChange={(value) => {
              setHideUnknown(value);
              setPage(1);
            }}
          />
        </div>
        <div className="archive-results-actions">
          <small className="muted inline-flex items-center gap-2">
            {t('samples')}:{' '}
            {loading ? <Skeleton className="h-4 w-8" aria-hidden="true" /> : filtered.length}
          </small>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-label={t('archiveView')}
            value={view}
            onValueChange={(value) => {
              if (value === 'grid' || value === 'list') setView(value);
            }}
          >
            <ToggleGroupItem value="grid" aria-label={t('gridView')}>
              <LayoutGrid aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label={t('listView')}>
              <List aria-hidden="true" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            disabled={matches.pending || scanning}
            onClick={() => void scan()}
            aria-busy={scanning}
          >
            <Icon
              icon={faArrowsRotate}
              size={15}
              spin={matches.pending || scanning}
              aria-hidden="true"
            />
            {t(scanning ? 'scanningLogs' : 'refresh')}
          </Button>
          <Button variant="default" onClick={() => setAddDialog(true)}>
            <Icon icon={faPlus} />
            {t('addMatch')}
          </Button>
        </div>
      </div>
      {matches.error && <Notice error>{matches.error}</Notice>}
      {view === 'grid' ? (
        <div
          className="archive-grid-viewport scroll-fade scroll-fade-4"
          ref={table}
          tabIndex={0}
          aria-busy={matches.pending}
        >
          {dataTable.getRowModel().rows.length ? (
            <ul className="archive-grid" aria-label={t('archive')}>
              {dataTable.getRowModel().rows.map((row) => (
                <li key={row.id}>
                  <MatchArchiveCard match={row.original} />
                </li>
              ))}
            </ul>
          ) : loading ? (
            <>
              <LoadingStatus />
              <ul className="archive-grid" aria-label={t('archive')} aria-busy="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <li key={index}>
                    <MatchArchiveCardSkeleton />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            empty
          )}
        </div>
      ) : (
        <div className="data-table-surface">
          <DataTable
            table={dataTable}
            label={t('archive')}
            pending={matches.pending || loading}
            loading={loading}
            scrollRef={table}
            className="archive-table"
            empty={empty}
          />
        </div>
      )}
      <div className="results-pagination">
        <Pagination
          page={currentPage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          label={t('archivePagination')}
          onPageChange={(value) => dataTable.setPageIndex(value - 1)}
          showSinglePage
          pending={loading}
        />
      </div>
      <Dialog
        open={addDialog}
        title={t('addMatch')}
        dismissible={!adding}
        onClose={() => {
          if (!adding) {
            setAddDialog(false);
            setAddError(null);
          }
        }}
      >
        <form
          className="add-match-form"
          aria-busy={adding}
          onSubmit={(e) => {
            e.preventDefault();
            if (adding || !validFid) return;
            setAdding(true);
            setAddError(null);
            void api
              .invoke('matches.add', { fid: fid.trim() })
              .then(() => {
                setFid('');
                setAddDialog(false);
                notify(t('success'));
                refresh();
              })
              .catch((e) => setAddError(String(e)))
              .finally(() => setAdding(false));
          }}
        >
          <FieldGroup>
            <FormField
              data-invalid={Boolean(fidError) || undefined}
              data-disabled={adding || undefined}
            >
              <FieldLabel htmlFor="match-id">{t('matchId')}</FieldLabel>
              <Input
                id="match-id"
                autoFocus
                autoComplete="off"
                disabled={adding}
                inputMode="numeric"
                placeholder="8050000"
                value={fid}
                onChange={(e) => {
                  setFid(e.target.value);
                  setAddError(null);
                }}
                maxLength={32}
                aria-invalid={Boolean(fidError) || undefined}
                aria-describedby={fidError ? 'match-id-error' : 'match-id-hint'}
              />
              {fidError ? (
                <FieldError id="match-id-error">{fidError}</FieldError>
              ) : (
                <FieldDescription id="match-id-hint">{t('matchIdHint')}</FieldDescription>
              )}
            </FormField>
          </FieldGroup>
          <div className="actions">
            <Button
              variant="default"
              type="submit"
              disabled={adding || !validFid}
              aria-busy={adding}
            >
              {adding ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Icon icon={faPlus} data-icon="inline-start" />
              )}
              {t(adding ? 'loading' : 'addMatch')}
            </Button>
            <Button
              disabled={adding}
              onClick={() => {
                setAddDialog(false);
                setAddError(null);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
