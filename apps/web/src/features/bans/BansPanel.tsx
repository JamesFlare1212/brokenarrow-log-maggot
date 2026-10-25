import { useEffect, useMemo, useRef, useState } from 'react';
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
    <section className="bans-panel" aria-label={t('bans')}>
      <div className="bans-toolbar">
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
        <InputGroup className="ban-search">
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
                  <TableRow key={ban.id}>
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
                          {ban.encountered ? t('encounterTimeUnknown') : '—'}
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
                    {request.pending ? (
                      <Loading />
                    ) : (
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
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {bans.length > pageSize && (
        <div className="results-pagination">
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
      <div className="ban-list">
        {players.map((p) => (
          <Item variant="outline" className="ban-row" key={p.id}>
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
