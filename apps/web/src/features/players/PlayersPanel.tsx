import { useRef, useState } from 'react';
import { Search, Users, X } from 'lucide-react';
import type { PlayerReport, RpcOutputs } from '@ba/contracts';
import { formatMetric } from '@ba/shared';
import { cn } from '@/lib/utils';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
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
  const results = useRequest<RpcOutputs['players.search']>();
  const report = useRequest<PlayerReport>();
  const noResults = Boolean(results.data && !results.data.players.length && !results.pending);
  const roster = state.session.current?.players ?? state.session.lobbyPlayers;
  const selectPlayer = (id: string) => {
    setSelectedId(id);
    void report.load(() => api.invoke('players.report', { id }));
  };
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
    <section className="players-panel" aria-label={t('players')}>
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
                  <Spinner data-icon="inline-start" />
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
          'players-workspace',
          (results.data?.players.length || results.pending) && 'has-search-results',
        )}
      >
        {(results.data || results.pending) && (
          <Card
            size="sm"
            className={cn(
              'player-results-card',
              results.data?.players.length === 1 && 'is-single-result',
            )}
          >
            <CardHeader>
              <CardTitle>{t('searchResults')}</CardTitle>
              <CardAction>
                {results.pending ? (
                  <Spinner aria-label={t('loading')} />
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
              <div className="player-results-viewport" aria-busy={results.pending}>
                {results.pending && !results.data && <Loading />}
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
                              disabled={results.pending}
                              aria-pressed={selectedId === player.id}
                              onClick={() => selectPlayer(player.id)}
                            >
                              <span className="player-result-identity">
                                <span className="truncate">{player.name}</span>
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
        <div className="player-report-panel" hidden={noResults}>
          {report.pending && <Loading />}
          {report.error && (
            <Notice error>
              {report.error}
              {selectedId && <Button onClick={() => selectPlayer(selectedId)}>{t('retry')}</Button>}
            </Notice>
          )}
          {report.data ? (
            <ReportView report={report.data} />
          ) : (
            !report.pending &&
            !report.error && (
              <section className="player-report-placeholder" aria-label={t('report')}>
                <Empty
                  icon={<Users />}
                  iconSize="lg"
                  description={t(results.data ? 'selectPlayerHint' : 'playerReportHint')}
                >
                  {t(results.data ? 'selectPlayer' : 'searchLabel')}
                </Empty>
                {!results.data && !results.pending && roster.length > 0 && (
                  <div className="player-suggestions">
                    <h3>{t('currentRoomPlayers')}</h3>
                    <div className="suggestion-list">
                      {roster.map((player) => (
                        <Button
                          variant="outline"
                          key={player.id}
                          onClick={() => selectPlayer(player.id)}
                        >
                          <Avatar size="sm" aria-hidden="true">
                            <AvatarFallback>{player.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          {player.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )
          )}
        </div>
      </div>
    </section>
  );
}
