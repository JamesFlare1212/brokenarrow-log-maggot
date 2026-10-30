import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Users, X } from 'lucide-react';
import { formatMetric } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { usePlayerSearch } from './usePlayerSearch';
import { Empty, Loading, Notice } from '../../components/ui';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Item, ItemActions, ItemContent, ItemGroup } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ReportView } from './Reports';
import { PlayerActions } from './PlayerActions';

export function PlayersPanel() {
  const { api, state, reports, loadReport } = useApp(),
    { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const results = usePlayerSearch(api);
  const { query, setQuery, completedQuery, attemptedQuery } = results;
  const report = selectedId ? reports[selectedId] : undefined;
  const roster = state.session.current?.players ?? state.session.lobbyPlayers;
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const selectedSource = useRef<HTMLElement | null>(null);
  const selectPlayer = (id: string, source: HTMLButtonElement) => {
    selectedSource.current = source;
    setSelectedId(id);
    setSelectionVersion((version) => version + 1);
    void loadReport(id);
  };
  useLayoutEffect(() => {
    if (!selectedId || reportHeading.current?.closest('[hidden],[inert]')) return;
    reportHeading.current?.focus({ preventScroll: true });
    reportHeading.current?.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: 'instant',
    });
  }, [selectedId, selectionVersion]);
  const search = async (value = query) => {
    if (!value.trim() || (results.pending && value.trim() === attemptedQuery)) return;
    setSelectedId(null);
    await results.search(value);
  };
  const clearSearch = () => {
    setSelectedId(null);
    results.clear();
    searchInput.current?.focus();
  };
  return (
    <section className="players-panel" aria-label={t('players')}>
      <section className="player-room-picker" aria-labelledby="player-room-heading">
        <Collapsible className="flex min-w-0 flex-col gap-3">
          <h3>
            <CollapsibleTrigger asChild>
              <Button
                id="player-room-heading"
                variant="outline"
                aria-label={t('currentRoomPlayers')}
                aria-describedby="player-room-count"
              >
                {t('currentRoomPlayers')}
                <Badge variant="secondary" className="min-w-8 tabular-nums" aria-hidden="true">
                  {roster.length}
                </Badge>
                <ChevronDown data-icon="inline-end" aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
          </h3>
          <span id="player-room-count" className="sr-only">
            {t('playersCount', { n: roster.length })}
          </span>
          <CollapsibleContent>
            <div className="player-suggestions">
              <div className="suggestion-list">
                {roster.map((player) => (
                  <Button
                    variant="outline"
                    key={player.id}
                    className="h-auto min-w-0 max-w-full whitespace-normal text-left"
                    aria-label={`${player.name} #${player.id}`}
                    onClick={(event) => selectPlayer(player.id, event.currentTarget)}
                  >
                    <Avatar size="sm" aria-hidden="true">
                      <AvatarFallback>{player.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 wrap-anywhere">
                      {player.name}
                      <span className="block text-xs text-muted-foreground">#{player.id}</span>
                    </span>
                  </Button>
                ))}
              </div>
              {roster.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('roomPlayersEmpty')}</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
      <form
        className="player-search-form"
        aria-busy={results.pending}
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="player-search" className="sr-only">
              {t('searchLabel')}
            </FieldLabel>
            <div className="player-search-controls">
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
                  aria-describedby="player-search-hint"
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
                aria-disabled={results.submitDisabled}
                aria-busy={results.pending}
              >
                {results.pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Search data-icon="inline-start" />
                )}
                {t('search')}
              </Button>
            </div>
            <FieldDescription id="player-search-hint">{t('searchHint')}</FieldDescription>
          </Field>
        </FieldGroup>
      </form>
      <div className="players-workspace has-search-results">
        <Card
          size="sm"
          className="player-results-card"
          role="region"
          aria-labelledby="player-results-heading"
        >
          <CardHeader>
            <CardTitle id="player-results-heading">{t('searchResults')}</CardTitle>
            <CardAction>
              {results.pending ? (
                <Spinner aria-label={t('loading')} />
              ) : (
                <Badge variant="secondary">{results.data?.players.length ?? '—'}</Badge>
              )}
            </CardAction>
            <CardDescription
              className="player-results-summary"
              tabIndex={0}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={t('searchResults')}
            >
              {results.pending
                ? t('searchingPlayers')
                : results.data
                  ? t('searchResultSummary', {
                      count: results.data?.players.length ?? 0,
                      query: completedQuery,
                    })
                  : t('searchHint')}
              {results.data?.source === 'local' && !results.pending && ` · ${t('offline')}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="player-results-content">
            <div className="player-results-viewport" aria-busy={results.pending}>
              <div className="player-results-scroll">
                <ItemGroup className="search-results">
                  {results.data?.players.length ? (
                    results.data.players.map((player) => (
                      <Item
                        key={player.id}
                        variant={selectedId === player.id ? 'muted' : 'default'}
                        size="xs"
                        className="search-result"
                      >
                        <ItemContent>
                          <Button
                            variant="ghost"
                            className="player-result-button"
                            aria-pressed={selectedId === player.id}
                            onClick={(event) => selectPlayer(player.id, event.currentTarget)}
                          >
                            <span className="player-result-identity">
                              <span className="whitespace-normal wrap-anywhere text-left">
                                {player.name}
                              </span>
                              <span className="player-result-meta">
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
                  ) : results.data && !results.pending ? (
                    <Empty
                      icon={<Search />}
                      iconSize="lg"
                      description={t('searchEmptyHint')}
                      action={<Button onClick={clearSearch}>{t('clearSearch')}</Button>}
                    >
                      {t('searchEmpty')}
                    </Empty>
                  ) : results.pending ? (
                    <Loading />
                  ) : (
                    <p className="text-sm text-muted-foreground wrap-anywhere">{t('searchHint')}</p>
                  )}
                </ItemGroup>
              </div>
              <div className="player-search-feedback">
                <div
                  className="player-search-messages"
                  tabIndex={0}
                  role="region"
                  aria-label={t('searchStatus')}
                >
                  {results.pending && (
                    <p className="text-sm wrap-anywhere" role="status">
                      {t('playerSearchActiveQuery', { query: attemptedQuery })}
                    </p>
                  )}
                  {results.data && results.pending && (
                    <p className="text-sm text-muted-foreground wrap-anywhere">
                      {t('playerSearchRetainedQuery', { query: completedQuery })}
                    </p>
                  )}
                  {results.error && (
                    <Notice error>
                      <p>{t('playerSearchFailedQuery', { query: attemptedQuery })}</p>
                      <p className="wrap-anywhere">{results.error}</p>
                      {results.data && (
                        <p>{t('playerSearchRetainedQuery', { query: completedQuery })}</p>
                      )}
                    </Notice>
                  )}
                </div>
                <div className="player-search-retry">
                  {results.error && (
                    <Button
                      onClick={() => {
                        setQuery(attemptedQuery);
                        searchInput.current?.focus();
                        void search(attemptedQuery);
                      }}
                    >
                      {t('retry')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="player-report-panel">
          {selectedId && (
            <div className="player-report-navigation">
              <h2 ref={reportHeading} tabIndex={-1} className="player-report-heading">
                {t('report')} · #{selectedId}
              </h2>
              <Button
                variant="outline"
                onClick={() => {
                  const source =
                    selectedSource.current?.isConnected &&
                    !selectedSource.current.matches('[disabled],[aria-disabled="true"]') &&
                    !selectedSource.current.closest('[hidden],[inert]')
                      ? selectedSource.current
                      : searchInput.current;
                  source?.focus({ preventScroll: true });
                  source?.scrollIntoView({
                    block: 'nearest',
                    inline: 'nearest',
                    behavior: 'instant',
                  });
                }}
              >
                {t('backToPlayerSelection')}
              </Button>
            </div>
          )}
          {selectedId ? (
            <ReportView
              key={selectedId}
              id={selectedId}
              report={report?.data ?? null}
              request={report}
            />
          ) : (
            !selectedId && (
              <section className="player-report-placeholder" aria-label={t('report')}>
                <Empty
                  icon={<Users />}
                  iconSize="lg"
                  description={t(results.data ? 'selectPlayerHint' : 'playerReportHint')}
                >
                  {t(results.data ? 'selectPlayer' : 'searchLabel')}
                </Empty>
              </section>
            )
          )}
        </div>
      </div>
    </section>
  );
}
