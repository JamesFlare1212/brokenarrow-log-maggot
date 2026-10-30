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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useHistoryDeletion, historyError } from '../history/useHistoryDeletion';
import { HistoryOperationResult } from '../history/HistoryOperationResult';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import {
  Button,
  Badge,
  Field,
  Notice,
  Empty,
  Menu,
  Toggle,
  Dialog,
  Loading,
} from '../../components/ui';
import { Pagination } from '../../components/Pagination';
import { MatchArchiveCard } from './MatchArchiveCard';
const PAGE_SIZE = 50;
interface ArchiveSnapshot {
  accountId: string;
  rows: Match[];
  signature: string;
}
const SORT_COLUMNS = ['time', 'map', 'result', 'mode', 'eloDelta', 'duration', 'account'] as const;
export function MatchArchive() {
  const deletion = useHistoryDeletion();
  const { api, state, openModal, notify } = useApp(),
    { t, locale } = useI18n(),
    matches = useRequest<ArchiveSnapshot>(),
    accountRequest = useRequest<Account[]>(),
    [displayed, setDisplayed] = useState<ArchiveSnapshot | null>(null),
    [account, setAccount] = useState(''),
    [fid, setFid] = useState(''),
    [adding, setAdding] = useState(false),
    [addError, setAddError] = useState<string | null>(null),
    [addedMatch, setAddedMatch] = useState<Match | null>(null),
    [addDialog, setAddDialog] = useState(false),
    [scanning, setScanning] = useState(false),
    [hideUnknown, setHideUnknown] = useState(true),
    [view, setView] = useState<'grid' | 'list'>('list'),
    [page, setPage] = useState(1),
    [sorting, setSorting] = useState<SortingState>([{ id: 'time', desc: true }]),
    [outcome, setOutcome] = useState<'all' | 'win' | 'loss'>('all');
  const table = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const selectedAccount = useRef(account);
  selectedAccount.current = account;
  const displayedRef = useRef(displayed);
  const requestGeneration = useRef(0);
  const applyRequested = useRef(false);
  const observedRevision = useRef(state.matchesRevision);
  const [queryAccount, setQueryAccount] = useState(account);
  const publish = useCallback((snapshot: ArchiveSnapshot | null) => {
    displayedRef.current = snapshot;
    setDisplayed(snapshot);
  }, []);
  const refresh = useCallback(
    async (apply = true) => {
      const accountId = selectedAccount.current,
        generation = ++requestGeneration.current;
      if (apply || displayedRef.current?.accountId !== accountId) applyRequested.current = true;
      setQueryAccount(accountId);
      const snapshot = await matches.load(async () => {
        const rows = await api.invoke('matches.list', accountId ? { accountId } : {});
        return { accountId, rows, signature: JSON.stringify(rows) };
      }, true);
      if (generation !== requestGeneration.current || accountId !== selectedAccount.current) return;
      if (!snapshot) {
        applyRequested.current = false;
        return;
      }
      if (applyRequested.current) {
        publish(snapshot);
        applyRequested.current = false;
      }
    },
    [api, matches.load, publish],
  );
  const active = displayed?.accountId === account ? displayed : null;
  const error = queryAccount === account ? matches.error : null;
  const loading = !active && !error;
  const accounts = accountRequest.data ?? [];
  const hasUpdates =
    !!active && matches.data?.accountId === account && active.signature !== matches.data.signature;
  const availableIds = useMemo(
    () =>
      new Set(
        (matches.data?.accountId === account ? matches.data.rows : (active?.rows ?? [])).map(
          (match) => match.id,
        ),
      ),
    [matches.data, active, account],
  );
  const available = useRef(availableIds);
  available.current = availableIds;
  const deletionBusy = useRef(deletion.busy);
  deletionBusy.current = deletion.busy;
  const validFid = /^\d+$/.test(fid.trim());
  const fidError = fid.trim() && !validFid ? t('matchIdInvalid') : null;
  const filtered = useMemo(
    () =>
      (active?.rows || []).filter(
        (m) =>
          (outcome === 'all' || m.outcome === outcome) && (!hideUnknown || m.outcome !== 'unknown'),
      ),
    [active, outcome, hideUnknown],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  useLayoutEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);
  useLayoutEffect(() => {
    if (table.current) table.current.scrollTop = 0;
  }, [currentPage, account, outcome, hideUnknown, sorting, view]);
  const scan = async () => {
    setScanning(true);
    try {
      await api.invoke('matches.scan', null);
    } catch (error) {
      notify(String(error), true);
    } finally {
      await refresh();
      setScanning(false);
    }
  };
  useEffect(() => {
    requestGeneration.current++;
    matches.invalidate();
    publish(null);
    void refresh(true);
  }, [api, account, refresh, publish]);
  useEffect(() => {
    if (observedRevision.current === state.matchesRevision) return;
    observedRevision.current = state.matchesRevision;
    void refresh(false);
  }, [state.matchesRevision, refresh]);
  useEffect(() => {
    if (state.accountsSnapshot) {
      accountRequest.invalidate();
      accountRequest.setData(state.accountsSnapshot);
      return;
    }
    void accountRequest.load(() => api.invoke('accounts.list', null), true);
  }, [api, state.matchesRevision, state.accountsRevision]);
  useLayoutEffect(() => {
    if (
      accountRequest.data &&
      account &&
      !accountRequest.data.some((item) => item.id === account)
    ) {
      setAccount('');
      setPage(1);
    }
  }, [accountRequest.data, account]);
  const renderActions = useCallback(
    (match: Match) => (
      <Menu
        label={`${t('actions')}: #${match.fid || match.id}`}
        disabled={deletionBusy.current || !available.current.has(match.id)}
      >
        {match.fid && (
          <>
            <Button
              disabled={!available.current.has(match.id)}
              onClick={() =>
                void api
                  .invoke('matches.detail', {
                    fid: match.fid!,
                    force: true,
                    accountId: match.localPlayerId,
                  })
                  .then(() => refresh())
                  .catch((error) => notify(historyError(error, locale), true))
              }
            >
              {t('refresh')}
            </Button>
            <Button
              disabled={!available.current.has(match.id)}
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
          disabled={!available.current.has(match.id)}
          onClick={async () => {
            const result = await deletion.run('match', match.id);
            if (result === undefined) return;
            if (result && displayedRef.current) {
              const rows = displayedRef.current.rows.filter((item) => item.id !== match.id);
              publish({ ...displayedRef.current, rows, signature: JSON.stringify(rows) });
            }
            await refresh();
          }}
        >
          {t('delete')}
        </Button>
      </Menu>
    ),
    [api, locale, notify, deletion.run, refresh, publish],
  );
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
            disabled={!available.current.has(row.original.id)}
            aria-describedby={
              !available.current.has(row.original.id) ? 'archive-updates-status' : undefined
            }
            onClick={() =>
              row.original.fid
                ? openModal({
                    type: 'match',
                    fid: row.original.fid,
                    accountId: row.original.localPlayerId,
                  })
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
        cell: ({ row }) => renderActions(row.original),
      },
    ],
    [locale, openModal, notify, renderActions],
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
  const sortLabel = (id: string) => t(id === 'duration' ? 'duration' : id);
  const sortDescription = sorting.length
    ? sorting
        .map(
          (sort, index) =>
            `${index + 1}. ${sortLabel(sort.id)} ${t(sort.desc ? 'sortDescending' : 'sortAscending')}`,
        )
        .join(' · ')
    : t('sortOriginal');
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
          <small className="muted">
            {t('samples')}: {active ? filtered.length : '—'}
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
            aria-label={t(scanning ? 'scanningLogs' : 'refresh')}
            aria-describedby="archive-updates-status"
          >
            <Icon
              icon={faArrowsRotate}
              size={15}
              spin={matches.pending || scanning}
              aria-hidden="true"
            />
            {t(scanning ? 'scanningLogs' : 'refresh')}
            <span aria-hidden="true" className={hasUpdates ? 'visible' : 'invisible'}>
              <Badge>{t('archiveUpdates')}</Badge>
            </span>
          </Button>
          <Button ref={addButton} variant="default" onClick={() => setAddDialog(true)}>
            <Icon icon={faPlus} />
            {t('addMatch')}
          </Button>
          <Button onClick={() => openModal({ type: 'historyRecovery' })}>
            {t('historyRecovery')}
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="w-40 min-w-0">
          <Field id="archive-sort" label={t('archiveSortBy')} labelHidden>
            <NativeSelect
              id="archive-sort"
              value={sorting[0]?.id ?? 'none'}
              onChange={(event) => {
                const id = event.target.value;
                setSorting(
                  id === 'none'
                    ? []
                    : [{ id, desc: id === 'time' || id === 'eloDelta' || id === 'duration' }],
                );
                setPage(1);
              }}
            >
              <NativeSelectOption value="none">{t('sortOriginal')}</NativeSelectOption>
              {SORT_COLUMNS.map((id) => (
                <NativeSelectOption key={id} value={id}>
                  {sortLabel(id)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Button
          disabled={!sorting.length}
          aria-label={t('archiveSortDirection')}
          aria-describedby="archive-sort-summary"
          onClick={() => {
            setSorting((current) =>
              current.map((sort, index) => (index === 0 ? { ...sort, desc: !sort.desc } : sort)),
            );
            setPage(1);
          }}
        >
          {t(sorting[0]?.desc ? 'sortDescending' : 'sortAscending')}
        </Button>
        <p
          id="archive-sort-summary"
          className="min-w-0 text-sm wrap-anywhere"
          data-archive-sort-summary
        >
          {t('archiveSortOrder')} {sortDescription}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">{t('archiveUpdateHint')}</p>
      <span id="archive-updates-status" className="sr-only" role="status">
        {t(
          matches.pending || loading
            ? 'loading'
            : error
              ? 'archiveUpdatesUnavailable'
              : hasUpdates
                ? 'archiveUpdatesAvailable'
                : 'archiveUpdatesCurrent',
        )}
      </span>
      {error && (
        <Notice error>
          {error}
          <Button onClick={() => void refresh()}>{t('retry')}</Button>
        </Notice>
      )}
      {accountRequest.error && (
        <Notice error>
          {accountRequest.error}
          <Button
            onClick={() => void accountRequest.load(() => api.invoke('accounts.list', null), true)}
          >
            {t('retry')}
          </Button>
        </Notice>
      )}
      {deletion.error && <Notice error>{deletion.error}</Notice>}
      <HistoryOperationResult result={deletion.result} />
      {addedMatch && (
        <Notice>
          <span>{t('archiveAddedMatch', { id: addedMatch.fid || addedMatch.id })}</span>
          {addedMatch.fid && (
            <Button
              onClick={() =>
                openModal({
                  type: 'match',
                  fid: addedMatch.fid!,
                  accountId: addedMatch.localPlayerId,
                })
              }
            >
              {t('openAddedMatch')}
            </Button>
          )}
        </Notice>
      )}
      {view === 'grid' ? (
        <div
          className="archive-grid-viewport scroll-fade scroll-fade-4"
          ref={table}
          tabIndex={0}
          aria-busy={matches.pending || loading}
        >
          {dataTable.getRowModel().rows.length ? (
            <ul className="archive-grid" aria-label={t('archive')}>
              {dataTable.getRowModel().rows.map((row) => (
                <li key={row.id}>
                  <MatchArchiveCard
                    match={row.original}
                    disabled={!availableIds.has(row.original.id)}
                    actions={renderActions(row.original)}
                  />
                </li>
              ))}
            </ul>
          ) : loading ? (
            <Loading />
          ) : error ? null : (
            empty
          )}
        </div>
      ) : (
        <div className="data-table-surface">
          <DataTable
            table={dataTable}
            label={t('archive')}
            pending={matches.pending || loading}
            scrollRef={table}
            className="archive-table"
            empty={error ? null : empty}
            sortDescription={sortDescription}
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
          focusFallback={table}
        />
      </div>
      <Dialog
        open={addDialog}
        title={t('addMatch')}
        dismissible={!adding}
        opener={addButton.current}
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
              .then((match) => {
                setAddedMatch(match);
                setFid('');
                setAddDialog(false);
                notify(t('success'));
                void refresh();
              })
              .catch((e) => setAddError(String(e)))
              .finally(() => setAdding(false));
          }}
        >
          {addError && <Notice error>{addError}</Notice>}
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
                <Spinner data-icon="inline-start" />
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
