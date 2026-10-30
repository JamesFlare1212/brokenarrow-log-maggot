import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ShieldCheck, RefreshCw, Search } from 'lucide-react';
import type { Ban } from '@ba/contracts';
import { formatMetric, formatTime } from '@ba/shared';
import { cn } from '@/lib/utils';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Loading, Notice, Empty, Badge, Dialog } from '../../components/ui';
import { Pagination } from '../../components/Pagination';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Item } from '@/components/ui/item';
import { Button as PrimitiveButton } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { BanAlertsContext } from './ban-alerts-context';
import { BanSyncIndicator } from './BanSyncIndicator';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
const PAGE_SIZE = 20;
type BanSnapshot = {
  rows: Ban[];
  signature: string;
  loadedAt: number;
  encounteredOrder?: string[];
};
const banSignature = (rows: Ban[]) =>
  JSON.stringify(
    rows.map(
      ({ id, name, rating, firstSeenAt, lastEncounterAt, encountered, unverifiedObservation }) => ({
        id,
        name,
        rating,
        firstSeenAt,
        lastEncounterAt,
        encountered,
        unverifiedObservation,
      }),
    ),
  );
export function BansPanel() {
  const { api, state, openModal, banSynchronization } = useApp(),
    { t, locale } = useI18n();
  const request = useRequest<BanSnapshot>();
  const [displayed, setDisplayed] = useState<BanSnapshot | null>(null);
  const displayedRef = useRef(displayed);
  const generation = useRef(0);
  const applyRequested = useRef(false);
  const updatesId = useId();
  const publish = useCallback((snapshot: BanSnapshot, preserveEncounterOrder = false) => {
    const eligible = snapshot.rows.filter((row) => row.encountered).map((row) => row.id);
    const previous = preserveEncounterOrder ? (displayedRef.current?.encounteredOrder ?? []) : [];
    const encounteredOrder = [
      ...previous.filter((id) => eligible.includes(id)),
      ...eligible.filter((id) => !previous.includes(id)),
    ];
    const next = { ...snapshot, encounteredOrder };
    displayedRef.current = next;
    setDisplayed(next);
  }, []);
  const hasUpdates =
    !!displayed &&
    !!request.data &&
    (displayed.signature !== request.data.signature ||
      JSON.stringify(displayed.encounteredOrder) !==
        JSON.stringify(request.data.rows.filter((row) => row.encountered).map((row) => row.id)));
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(PAGE_SIZE),
    [metOnly, setMetOnly] = useState(false),
    [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const allFilter = useRef<HTMLButtonElement>(null);
  const measuredPageSize = useRef(PAGE_SIZE);
  const filtered = useMemo(
    () =>
      metOnly
        ? (displayed?.encounteredOrder ?? []).map((id) =>
            displayed!.rows.find((row) => row.id === id)!,
          )
        : (displayed?.rows ?? []),
    [displayed, metOnly],
  );
  const bans = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return filtered.filter(
      (ban) => !value || ban.name.toLocaleLowerCase().includes(value) || ban.id.includes(value),
    );
  }, [filtered, query]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(bans.length / pageSize)));
  useLayoutEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);
  const visible = bans.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const position = useRef({ bans, currentPage, pageSize });
  position.current = { bans, currentPage, pageSize };
  const restore = useRef<{ id: string; focused: Element | null; pageLink: boolean } | null>(null);
  useLayoutEffect(() => {
    const target = restore.current;
    if (!target) return;
    restore.current = null;
    const viewport = list.current;
    const row = viewport?.querySelector<HTMLElement>(`[data-ban-id="${target.id}"]`);
    if (viewport && row) {
      const header = viewport.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      viewport.scrollTop +=
        row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - header;
    }
    if (
      target.pageLink &&
      (document.activeElement === target.focused || document.activeElement === document.body)
    ) {
      (panel.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? viewport)?.focus({
        preventScroll: true,
      });
    }
  }, [pageSize, currentPage]);
  useEffect(() => {
    const viewport = list.current;
    if (!viewport) return;
    const measure = () => {
      const header = viewport.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const row = viewport.querySelector('[data-ban-id]')?.getBoundingClientRect().height ?? 0;
      if (!row || !viewport.clientHeight) return;
      const next = Math.max(PAGE_SIZE, Math.floor((viewport.clientHeight - header) / row));
      if (next !== measuredPageSize.current) {
        const current = position.current;
        const focused = document.activeElement;
        const focusedRow = viewport.contains(focused)
          ? focused?.closest<HTMLElement>('[data-ban-id]')
          : null;
        const firstVisible = [...viewport.querySelectorAll<HTMLElement>('[data-ban-id]')].find(
          (element) =>
            element.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top + header,
        );
        const id = (focusedRow ?? firstVisible)?.dataset.banId;
        const index = id
          ? current.bans.findIndex((ban) => ban.id === id)
          : (current.currentPage - 1) * current.pageSize;
        const anchor = Math.max(0, index);
        restore.current = {
          id: current.bans[anchor]?.id ?? '',
          focused,
          pageLink:
            !!focused?.matches('[aria-current="page"]') && !!panel.current?.contains(focused),
        };
        measuredPageSize.current = next;
        setPageSize(next);
        setPage(Math.floor(anchor / next) + 1);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (bans.length) measure();
    return () => observer.disconnect();
  }, [bans.length]);
  const reload = useCallback(
    async (apply = true) => {
      const current = ++generation.current;
      if (apply || !displayedRef.current) applyRequested.current = true;
      const snapshot = await request.load(async () => {
        const rows = await api.invoke('bans.list', { metOnly: false });
        const signature = banSignature(rows);
        return { rows, signature, loadedAt: Date.now() };
      }, true);
      if (current !== generation.current) return;
      if (snapshot && applyRequested.current) publish(snapshot);
      else if (snapshot && displayedRef.current) {
        const previous = displayedRef.current;
        const latest = new Map(snapshot.rows.map((row) => [row.id, row]));
        const rows = previous.rows.map((row) => {
          const next = latest.get(row.id);
          return next
            ? {
                ...row,
                encountered: next.encountered,
                lastEncounterAt: next.lastEncounterAt,
                unverifiedObservation: next.unverifiedObservation,
              }
            : row;
        });
        const signature = banSignature(rows);
        if (signature !== previous.signature) publish({ ...previous, rows, signature }, true);
      }
      applyRequested.current = false;
    },
    [api, request.load, publish],
  );
  useEffect(() => {
    void reload(false);
  }, [reload, state.bansRevision]);
  const resetPosition = () => {
    setPage(1);
    if (list.current) list.current.scrollTop = 0;
  };
  const clearQuery = () => {
    setQuery('');
    resetPosition();
    search.current?.focus();
  };
  const emptyKey = !displayed?.rows.length
    ? 'banSourceEmpty'
    : !filtered.length
      ? 'banMetEmpty'
      : 'banQueryEmpty';
  return (
    <section ref={panel} className="bans-panel" aria-label={t('bans')}>
      <div className="bans-toolbar">
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label={t('metBans')}
          value={metOnly ? 'met' : 'all'}
          onValueChange={(value) => {
            if (value) {
              setMetOnly(value === 'met');
              resetPosition();
            }
          }}
        >
          <ToggleGroupItem ref={allFilter} value="all">
            {t('allBans')}
          </ToggleGroupItem>
          <ToggleGroupItem value="met">{t('metBans')}</ToggleGroupItem>
        </ToggleGroup>
        <InputGroup className="ban-search">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={search}
            type="search"
            maxLength={200}
            aria-label={t('filterPlayers')}
            placeholder={t('filterPlayers')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              resetPosition();
            }}
          />
        </InputGroup>
        <BanSyncIndicator
          loading={request.pending}
          readError={request.error}
          loaded={displayed !== null}
          hasUpdates={hasUpdates}
          snapshotTime={displayed?.loadedAt}
          reload={reload}
        />
        <Button
          variant="default"
          aria-disabled={banSynchronization.pending}
          aria-busy={banSynchronization.pending}
          onClick={() => {
            if (!banSynchronization.pending)
              void banSynchronization.synchronize().then((success) => {
                if (success) void reload(false);
              });
          }}
        >
          <RefreshCw
            data-icon="inline-start"
            className={cn(banSynchronization.pending && 'animate-spin')}
            aria-hidden="true"
          />
          {t('sync')}
        </Button>
        <Button
          aria-describedby={updatesId}
          aria-disabled={!hasUpdates || request.pending}
          onClick={() => {
            if (!hasUpdates || request.pending || !request.data) return;
            publish(request.data);
            resetPosition();
          }}
        >
          {t('banListApplyUpdates')}
          <span aria-hidden="true" className={hasUpdates ? 'visible' : 'invisible'}>
            <Badge>{t('archiveUpdates')}</Badge>
          </span>
        </Button>
      </div>
      <span id={updatesId} className="sr-only" role="status">
        {t(hasUpdates ? 'banListUpdatesAvailable' : 'banListUpdatesCurrent')}
      </span>
      <div className="data-table-surface">
        <div
          className="table-wrap data-table-scroll bans-table ban-list-paged"
          ref={list}
          tabIndex={0}
          aria-busy={request.pending}
        >
          <Table aria-label={t('bans')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('banPlayer')}</TableHead>
                <TableHead>ID</TableHead>
                <TableHead className="text-right">ELO</TableHead>
                <TableHead>{t('lastEncounterTime')}</TableHead>
                <TableHead>{t('banFirstSeen')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length ? (
                visible.map((ban) => (
                  <TableRow key={ban.id} data-ban-id={ban.id}>
                    <TableCell>
                      <Button
                        variant="link"
                        size="sm"
                        className="ban-player-button"
                        aria-label={`${ban.name} #${ban.id}`}
                        onClick={() => openModal({ type: 'profile', id: ban.id, name: ban.name })}
                      >
                        {ban.name}
                      </Button>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      #{ban.id}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMetric(ban.rating, 0)}
                    </TableCell>
                    <TableCell>
                      {ban.lastEncounterAt != null ? (
                        <time dateTime={new Date(ban.lastEncounterAt).toISOString()}>
                          {formatTime(ban.lastEncounterAt, locale)}
                        </time>
                      ) : (
                        <span className="muted">
                          {ban.unverifiedObservation
                            ? t('unverifiedEncounter')
                            : ban.encountered
                              ? t('encounterTimeUnknown')
                              : '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <time>{formatTime(ban.firstSeenAt, locale)}</time>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5}>
                    {(request.pending && displayed === null) ||
                    (displayed === null && !request.error) ? (
                      <Loading />
                    ) : (
                      <Empty
                        icon={<ShieldCheck />}
                        description={t(
                          request.error
                            ? displayed === null
                              ? 'banListUnknownHint'
                              : 'banListRetainedHint'
                            : `${emptyKey}Hint`,
                        )}
                        action={
                          request.error ? (
                            <Button
                              aria-disabled={request.pending}
                              onClick={() => {
                                if (!request.pending) {
                                  list.current?.focus();
                                  void reload();
                                }
                              }}
                            >
                              {t('banListReload')}
                            </Button>
                          ) : emptyKey === 'banQueryEmpty' ? (
                            <Button onClick={clearQuery}>{t('clearFilters')}</Button>
                          ) : emptyKey === 'banMetEmpty' ? (
                            <Button
                              onClick={() => {
                                setMetOnly(false);
                                resetPosition();
                                allFilter.current?.focus();
                              }}
                            >
                              {t('allBans')}
                            </Button>
                          ) : undefined
                        }
                      >
                        {t(request.error ? 'banListReadIssue' : emptyKey)}
                      </Empty>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <div className="results-pagination">
        <Pagination
          reserveSpace
          page={currentPage}
          pageSize={pageSize}
          total={bans.length}
          label={t('bans')}
          focusFallback={list}
          onPageChange={(value) => {
            setPage(value);
            if (list.current) list.current.scrollTop = 0;
          }}
        />
      </div>
    </section>
  );
}
export function BanAlertDialog({ batchId, players }: { batchId: string; players: Ban[] }) {
  const { openModal, closeModal, backModal } = useApp(),
    { t } = useI18n();
  const inbox = useContext(BanAlertsContext)!;
  const region = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const identityPrefix = useId();
  const pending = inbox.pending.has(batchId);
  const dismiss = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      if (await inbox.acknowledge(batchId)) closeModal();
    } finally {
      closing.current = false;
    }
  };
  const action = (
    <Button aria-disabled={pending} onClick={() => void dismiss()}>
      {t(pending ? 'settingsSaving' : inbox.errors[batchId] ? 'retry' : 'banAlertsDismiss')}
    </Button>
  );
  return (
    <Dialog
      open
      onClose={() => void dismiss()}
      onBack={backModal}
      title={t('banAlert')}
      initialFocus={() => region.current}
      footer={action}
      className="ban-alert-dialog"
    >
      <div
        ref={region}
        role="region"
        tabIndex={0}
        aria-label={t('banAlertsDetails')}
        className="ban-list min-w-0 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {players.map((p) => (
          <Item variant="outline" className="ban-row" key={p.id}>
            <div id={`${identityPrefix}-${p.id}`} className="min-w-0 wrap-anywhere">
              <strong className="block">{p.name}</strong>
              <span className="text-sm text-muted-foreground">
                #{p.id} · <Badge tone="danger">{t('banned')}</Badge>
              </span>
            </div>
            <PrimitiveButton
              variant="outline"
              aria-label={t('banAlertsInvestigate', { name: p.name, id: p.id })}
              data-dialog-focus={`ban-player:${p.id}`}
              aria-describedby={`${identityPrefix}-${p.id}`}
              aria-disabled={pending}
              onClick={() => {
                if (!pending) openModal({ type: 'profile', id: p.id, name: p.name });
              }}
            >
              {t('investigate')}
            </PrimitiveButton>
          </Item>
        ))}
      </div>
      {inbox.errors[batchId] && (
        <Notice error>
          {t('banAlertsSaveFailed')} {inbox.errors[batchId]}
        </Notice>
      )}
    </Dialog>
  );
}
