import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, RefreshCw, Search } from 'lucide-react';
import type { Ban } from '@ba/contracts';
import { formatMetric, formatTime } from '@ba/shared';
import { cn } from '@/lib/utils';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Notice, Empty, Badge, Dialog } from '../../components/ui';
import { LoadingStatus, TableSkeletonRows } from '../../components/LoadingState';
import { Pagination } from '../../components/Pagination';
import { OverflowHint } from '../../components/OverflowHint';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Item } from '@/components/ui/item';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
const PAGE_SIZE = 20;
export function BansPanel() {
  const { api, state, openModal, notify } = useApp(),
    { t, locale } = useI18n();
  const request = useRequest<Ban[]>();
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(PAGE_SIZE),
    [metOnly, setMetOnly] = useState(false),
    [query, setQuery] = useState(''),
    [syncing, setSyncing] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const measuredPageSize = useRef(PAGE_SIZE);
  const bans = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return (request.data ?? []).filter(
      (ban) => !value || ban.name.toLocaleLowerCase().includes(value) || ban.id.includes(value),
    );
  }, [request.data, query]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(bans.length / pageSize)));
  const visible = bans.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const loading = !request.data && (request.pending || !request.error);
  useEffect(() => {
    const viewport = list.current;
    if (!viewport) return;
    const measure = () => {
      const header = viewport.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const row = viewport.querySelector('tbody tr')?.getBoundingClientRect().height ?? 0;
      if (!row || !viewport.clientHeight) return;
      const next = Math.max(PAGE_SIZE, Math.ceil((viewport.clientHeight - header) / row));
      if (next !== measuredPageSize.current) {
        measuredPageSize.current = next;
        setPageSize(next);
        setPage(1);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (bans.length) measure();
    return () => observer.disconnect();
  }, [bans.length]);
  useEffect(() => {
    void request.load(() => api.invoke('bans.list', { metOnly }), true);
  }, [api, metOnly, state.bansRevision]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [currentPage, metOnly, query]);
  return (
    <section className="bans-panel flex flex-1 flex-col min-h-0 gap-3.5" aria-label={t('bans')}>
      <div className="bans-toolbar flex flex-wrap items-center gap-3 justify-between">
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label={t('metBans')}
          value={metOnly ? 'met' : 'all'}
          onValueChange={(value) => {
            if (value) {
              setMetOnly(value === 'met');
              setPage(1);
            }
          }}
        >
          <ToggleGroupItem value="all">{t('allBans')}</ToggleGroupItem>
          <ToggleGroupItem value="met">{t('metBans')}</ToggleGroupItem>
        </ToggleGroup>
        <InputGroup className="ban-search [flex:1_1_12rem] w-auto min-w-[min(12rem,_100%)] max-w-68 ml-auto viewport-max-767:flex-1 viewport-max-767:ml-0 viewport-max-767:max-w-none viewport-max-767:min-w-40">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            maxLength={200}
            aria-label={t('filterPlayers')}
            placeholder={t('filterPlayers')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </InputGroup>
        <Button
          variant="default"
          disabled={syncing}
          aria-busy={syncing}
          onClick={() => {
            setSyncing(true);
            void api
              .invoke('bans.sync', null)
              .then(() => request.load(() => api.invoke('bans.list', { metOnly }), true))
              .catch((e) => notify(String(e), true))
              .finally(() => setSyncing(false));
          }}
        >
          <RefreshCw
            data-icon="inline-start"
            className={cn(syncing && 'animate-spin')}
            aria-hidden="true"
          />
          {t('sync')}
        </Button>
      </div>
      {request.error && <Notice error>{request.error}</Notice>}
      {loading && <LoadingStatus />}
      <div className="data-table-surface flex min-h-0 flex-1 flex-col overflow-hidden border border-border rounded-lg bg-card">
        <div
          className="table-wrap [.report_&]:max-h-120 min-w-0 overflow-auto [&:focus-visible]:outline-2 [&:focus-visible]:outline-solid [&:focus-visible]:outline-ring [&:focus-visible]:outline-offset-[-2px] data-table-scroll flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable] [scroll-padding-block:3rem_1rem] [&>[data-slot='table-container']]:overflow-visible [&_[data-slot='table-header']]:sticky [&_[data-slot='table-header']]:top-0 [&_[data-slot='table-header']]:z-[1] [&_[data-slot='table-header']]:bg-card [&_[data-slot='table-head']]:px-4 [&_[data-slot='table-cell']]:px-4 [&_[data-slot='table-cell']]:py-2.5 [&:focus-visible]:outline-2 [&:focus-visible]:outline-solid [&:focus-visible]:outline-ring [&:focus-visible]:outline-offset-[-2px] bans-table [&_table]:min-w-192 [&_table]:table-fixed [&_[data-slot='table-header']]:z-[3] [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[1] [&_th:first-child]:bg-card [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-[1] [&_td:first-child]:bg-card ban-list-paged flex-1 min-h-0 overflow-auto [&:focus-visible]:outline-2 [&:focus-visible]:outline-solid [&:focus-visible]:outline-ring [&:focus-visible]:outline-offset-[2px]"
          ref={list}
          tabIndex={0}
          role="region"
          aria-label={`${t('bans')} · ${t('tableScrollHint')}`}
          aria-busy={request.pending}
        >
          <Table aria-label={t('bans')} aria-busy={request.pending || loading}>
            <colgroup>
              <col />
              <col className="ban-id-column w-24" />
              <col className="ban-rating-column w-24" />
              <col className="ban-time-column w-50" />
              <col className="ban-time-column w-50" />
            </colgroup>
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
                  <TableRow key={ban.id}>
                    <TableCell>
                      <Button
                        variant="link"
                        size="sm"
                        className="ban-player-button min-w-0 justify-start max-w-full min-h-8 h-auto whitespace-normal wrap-anywhere text-left"
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
                        <span className="muted text-muted-foreground">
                          {ban.encountered ? t('encounterTimeUnknown') : '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <time>{formatTime(ban.firstSeenAt, locale)}</time>
                    </TableCell>
                  </TableRow>
                ))
              ) : loading ? (
                <TableSkeletonRows
                  columns={['player', 'id', 'elo', 'encounter', 'firstSeen']}
                  alignRight={['elo']}
                />
              ) : (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Empty
                      icon={<ShieldCheck />}
                      description={t('bansDescription')}
                      action={
                        query ? (
                          <Button onClick={() => setQuery('')}>{t('clearFilters')}</Button>
                        ) : undefined
                      }
                    >
                      {t('empty')}
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <OverflowHint viewport={list} />
      </div>
      {bans.length > pageSize && (
        <div className="results-pagination shrink-0 mt-auto [&_[data-slot='pagination']]:py-0.5">
          <Pagination
            page={currentPage}
            pageSize={pageSize}
            total={bans.length}
            label={t('bans')}
            onPageChange={(value) => {
              setPage(value);
              if (list.current) list.current.scrollTop = 0;
            }}
          />
        </div>
      )}
    </section>
  );
}
export function BanAlertDialog({ players }: { players: Ban[] }) {
  const { openModal, closeModal, backModal } = useApp(),
    { t } = useI18n();
  return (
    <Dialog open onClose={closeModal} onBack={backModal} title={t('banAlert')}>
      <div className="ban-list flex flex-col gap-2 p-3">
        {players.map((p) => (
          <Item
            variant="outline"
            className="ban-row grid grid-cols-[minmax(12rem,_1fr)_6rem_7rem_10rem] items-center gap-4 [&_time]:text-muted-foreground [&_time]:text-[0.75rem] [&_time]:text-right workspace-max-48:grid-cols-[minmax(0,_1fr)_5rem] workspace-max-48:[&_time]:text-left"
            key={p.id}
          >
            <strong>{p.name}</strong>
            <Badge tone="danger">{t('banned')}</Badge>
            <Button onClick={() => openModal({ type: 'profile', id: p.id, name: p.name })}>
              {t('investigate')}
            </Button>
          </Item>
        ))}
      </div>
    </Dialog>
  );
}
