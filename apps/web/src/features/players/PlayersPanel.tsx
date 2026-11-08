import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { usePageBreadcrumb } from '../../hooks/usePageBreadcrumb';
import { ArrowLeft, Search, Users, X } from 'lucide-react';
import type { PlayerReport, RpcOutputs } from '@ba/contracts';
import { formatMetric } from '@ba/shared';
import { cn } from '@/lib/utils';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Empty, Notice } from '../../components/ui';
import { LoadingStatus, ListSkeletonRows } from '../../components/LoadingState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Item, ItemActions, ItemContent, ItemGroup } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { ReportView } from './Reports';
import { PlayerActions } from './PlayerActions';

export function PlayersPanel() {
  const { api, state } = useApp(),
    { t } = useI18n();
  const [query, setQuery] = useState('');
  const [completedQuery, setCompletedQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const reportPanel = useRef<HTMLDivElement>(null);
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const returningToPlayers = useRef(false);
  const results = useRequest<RpcOutputs['players.search']>();
  const report = useRequest<PlayerReport>();
  const noResults = Boolean(results.data && !results.data.players.length && !results.pending);
  const roster = state.session.current?.players ?? state.session.lobbyPlayers;
  useLayoutEffect(() => {
    if (selectedId) {
      reportPanel.current?.focus({ preventScroll: true });
      if (panel.current && panel.current.clientWidth <= 880)
        reportPanel.current?.scrollIntoView?.({ block: 'start' });
    } else if (returningToPlayers.current) {
      returningToPlayers.current = false;
      const trigger = Array.from(
        panel.current?.querySelectorAll<HTMLButtonElement>('[data-player-select]') ?? [],
      ).find(
        (button) => button.dataset.playerSelect === selectionTrigger.current?.dataset.playerSelect,
      );
      (trigger ?? searchInput.current)?.focus();
    }
  }, [selectedId]);
  const selectPlayer = (id: string, trigger?: HTMLButtonElement) => {
    if (trigger) selectionTrigger.current = trigger;
    setSelectedId(id);
    void report.load(() => api.invoke('players.report', { id }));
  };
  const backToPlayers = useCallback(() => {
    returningToPlayers.current = true;
    setSelectedId(null);
    report.invalidate();
  }, [report.invalidate]);
  const selectedName =
    results.data?.players.find((player) => player.id === selectedId)?.name ??
    roster.find((player) => player.id === selectedId)?.name;
  usePageBreadcrumb(
    'players',
    selectedId ? `${selectedName || t('report')} #${selectedId}` : null,
    backToPlayers,
  );
  const search = async () => {
    const value = query.trim();
    if (!value || results.pending) return;
    setSelectedId(null);
    report.invalidate();
    const data = await results.load(() => api.invoke('players.search', { query: value }), true);
    if (data) setCompletedQuery(value);
  };
  const clearSearch = () => {
    setQuery('');
    setCompletedQuery('');
    setSelectedId(null);
    results.invalidate();
    report.invalidate();
    searchInput.current?.focus();
  };
  return (
    <section
      ref={panel}
      className="players-panel flex min-w-0 flex-col gap-(--content-gap) @container/players"
      aria-label={t('players')}
    >
      <form
        className="player-search-form"
        aria-busy={results.pending}
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(results.error) || undefined}>
            <FieldLabel htmlFor="player-search" className="sr-only">
              {t('searchLabel')}
            </FieldLabel>
            <div className="player-search-controls flex min-w-0 items-center gap-3">
              <InputGroup className="h-10 min-w-0 flex-1">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  id="player-search"
                  ref={searchInput}
                  type="search"
                  placeholder={t('searchPlaceholder')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(results.error) || undefined}
                  aria-describedby={results.error ? 'player-search-error' : 'player-search-hint'}
                />
                {(query || results.data || results.pending) && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t('clearSearch')}
                      onClick={clearSearch}
                    >
                      <X aria-hidden="true" />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <Button
                size="lg"
                className="h-10"
                type="submit"
                disabled={results.pending || !query.trim()}
                aria-busy={results.pending}
              >
                {results.pending ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Search data-icon="inline-start" />
                )}
                {t('search')}
              </Button>
            </div>
            {results.error ? (
              <FieldError id="player-search-error">{results.error}</FieldError>
            ) : (
              <FieldDescription id="player-search-hint">{t('searchHint')}</FieldDescription>
            )}
          </Field>
        </FieldGroup>
      </form>
      <div
        className={cn(
          'players-workspace grid min-w-0 gap-5 [align-items:start]',
          (results.data?.players.length || results.pending) &&
            'has-search-results [.players-workspace&]:grid-cols-[minmax(14rem,_16rem)_minmax(0,_1fr)] players-max-55:[.players-workspace&]:grid-cols-1',
        )}
      >
        {(results.data || results.pending) && (
          <Card
            size="sm"
            className={cn(
              'player-results-card min-w-0 sticky top-0 players-max-55:static',
              results.data?.players.length === 1 &&
                'is-single-result players-max-55:[.player-results-card&]:grid players-max-55:[.player-results-card&]:grid-cols-[minmax(10rem,_0.65fr)_minmax(0,_1.35fr)] players-max-55:[.player-results-card&]:items-center players-max-55:[.player-results-card&]:gap-0 players-max-30:[.player-results-card&]:grid-cols-1 players-max-30:[.player-results-card&]:gap-2',
            )}
          >
            <CardHeader>
              <CardTitle>{t('searchResults')}</CardTitle>
              <CardAction>
                {results.pending ? (
                  <Spinner aria-hidden="true" />
                ) : (
                  <Badge variant="secondary">{results.data?.players.length}</Badge>
                )}
              </CardAction>
              <CardDescription role="status" aria-live="polite" aria-atomic="true">
                {results.pending
                  ? t('searchingPlayers')
                  : t('searchResultSummary', {
                      count: results.data?.players.length ?? 0,
                      query: completedQuery,
                    })}
                {results.data?.source === 'local' && !results.pending && ` · ${t('offline')}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="player-results-viewport min-h-16" aria-busy={results.pending}>
                <div className="player-results-scroll max-h-128 overflow-auto players-max-55:max-h-60">
                  {results.pending && !results.data && (
                    <>
                      <ListSkeletonRows
                        rows={5}
                        className="search-results flex flex-col gap-1"
                        rowClassName="player-result-loading min-h-16"
                      />
                    </>
                  )}
                  <ItemGroup className="search-results flex flex-col gap-1">
                    {results.data?.players.length ? (
                      results.data.players.map((player) => (
                        <Item
                          key={player.id}
                          variant={selectedId === player.id ? 'muted' : 'default'}
                          size="xs"
                          className="search-result gap-1 flex-nowrap px-1 [&_[data-slot='item-content']]:min-w-0"
                        >
                          <ItemContent>
                            <Button
                              variant="ghost"
                              className="player-result-button h-auto min-w-0 w-full justify-start p-2"
                              disabled={results.pending}
                              data-player-select={player.id}
                              aria-pressed={selectedId === player.id}
                              onClick={(event) => selectPlayer(player.id, event.currentTarget)}
                            >
                              <span className="player-result-identity flex min-w-0 flex-1 flex-col items-start gap-1">
                                <span className="player-result-name max-w-full wrap-anywhere">
                                  {player.name}
                                </span>
                                <span className="player-result-meta text-muted-foreground text-[0.75rem] font-normal">
                                  #{player.id} · ELO {formatMetric(player.rating, 0)}
                                </span>
                              </span>
                            </Button>
                          </ItemContent>
                          <ItemActions>
                            <PlayerActions player={{ ...player, teamId: null }} />
                          </ItemActions>
                        </Item>
                      ))
                    ) : !results.pending ? (
                      <Empty
                        icon={<Search />}
                        iconSize="lg"
                        description={t('searchEmptyHint')}
                        action={<Button onClick={clearSearch}>{t('clearSearch')}</Button>}
                      >
                        {t('searchEmpty')}
                      </Empty>
                    ) : null}
                  </ItemGroup>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        <div
          ref={reportPanel}
          className="player-report-panel flex min-w-0 flex-col gap-(--content-gap) [scroll-margin-block:1rem] rounded-lg [&:focus-visible]:outline-2 [&:focus-visible]:outline-solid [&:focus-visible]:outline-ring [&:focus-visible]:outline-offset-[4px]"
          hidden={noResults}
          tabIndex={-1}
          role="region"
          aria-label={t('report')}
        >
          {selectedId && (
            <div className="player-report-navigation flex -mb-2">
              <Button variant="ghost" size="sm" onClick={backToPlayers}>
                <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                {t('backToPlayers')}
              </Button>
            </div>
          )}
          {report.pending && <LoadingStatus />}
          {report.error && (
            <Notice error>
              {report.error}
              {selectedId && <Button onClick={() => selectPlayer(selectedId)}>{t('retry')}</Button>}
            </Notice>
          )}
          {report.data || (report.pending && selectedId) ? (
            <ReportView
              report={report.data}
              pending={report.pending && !report.data}
              id={selectedId ?? undefined}
              name={
                results.data?.players.find((player) => player.id === selectedId)?.name ??
                roster.find((player) => player.id === selectedId)?.name
              }
            />
          ) : (
            !report.pending &&
            !report.error && (
              <section
                className="player-report-placeholder [&_[data-slot='empty']]:min-h-52"
                aria-label={t('report')}
              >
                {(results.data || !roster.length) && (
                  <Empty
                    icon={<Users />}
                    iconSize="lg"
                    description={t(results.data ? 'selectPlayerHint' : 'playerReportHint')}
                  >
                    {t(results.data ? 'selectPlayer' : 'searchLabel')}
                  </Empty>
                )}
                {!results.data && !results.pending && roster.length > 0 && (
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle role="heading" aria-level={2}>
                        {t('currentRoomPlayers')}
                      </CardTitle>
                      <CardDescription>{t('chooseRoomPlayer')}</CardDescription>
                    </CardHeader>
                    <CardContent className="suggestion-list flex flex-wrap gap-2 [&>button]:min-w-0 [&>button]:max-w-full [&>button]:min-h-9 [&>button]:h-auto [&>button]:justify-start [&>button]:whitespace-normal [&>button]:text-left">
                      {roster.map((player) => (
                        <Button
                          variant="outline"
                          key={player.id}
                          data-player-select={player.id}
                          onClick={(event) => selectPlayer(player.id, event.currentTarget)}
                        >
                          <Avatar size="sm" aria-hidden="true">
                            <AvatarFallback>{player.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="suggestion-name min-w-0 wrap-anywhere">
                            {player.name}
                          </span>
                        </Button>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </section>
            )
          )}
        </div>
      </div>
    </section>
  );
}
