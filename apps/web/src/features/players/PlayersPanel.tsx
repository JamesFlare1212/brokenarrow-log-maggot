import { useState } from 'react';
import { faMagnifyingGlass, faSpinner, faUsers } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import type { PlayerReport, RpcOutputs } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Card, Field, Button, Empty, Loading, Notice } from '../../components/ui';
import { ReportView, MaggotView, MaggotProgress } from './Reports';
import { PlayerActions } from './PlayerActions';
export function PlayersPanel() {
  const { api, state, maggot } = useApp(),
    { t } = useI18n(),
    [query, setQuery] = useState(''),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const results = useRequest<RpcOutputs['players.search']>(),
    report = useRequest<PlayerReport>();
  return (
    <Card title={t('players')} icon={<Icon icon={faMagnifyingGlass} size={19} />}>
      <form
        className="search-form"
        aria-busy={results.pending}
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim() && !results.pending) {
            setSelectedId(null);
            report.invalidate();
            void results.load(() => api.invoke('players.search', { query: query.trim() }));
          }
        }}
      >
        <Field id="player-search" label={t('searchLabel')} hint={t('searchHint')}>
          <div className="search-input-wrap">
            <Icon icon={faMagnifyingGlass} size={18} aria-hidden="true" />
            <input
              id="player-search"
              type="search"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={200}
            />
          </div>
        </Field>
        <Button
          type="submit"
          disabled={results.pending || !query.trim()}
          aria-busy={results.pending}
          variant="primary"
        >
          <Icon
            icon={results.pending ? faSpinner : faMagnifyingGlass}
            spin={results.pending}
            size={16}
            aria-hidden="true"
          />
          {t('search')}
        </Button>
      </form>
      <div className="player-results-viewport" aria-busy={results.pending}>
        {results.pending && (
          <div className="results-loading">
            <Loading />
          </div>
        )}
        <div className="player-results-scroll">
          {results.error && <Notice error>{results.error}</Notice>}
          {results.data?.source === 'local' && <Notice>{t('offline')}</Notice>}
          {results.data && (
            <div className="search-results">
              {results.data.players.length ? (
                results.data.players.map((p) => (
                  <div className="search-result" key={p.id}>
                    <Button
                      disabled={results.pending}
                      onClick={() => {
                        setSelectedId(p.id);
                        void report.load(() => api.invoke('players.report', { id: p.id }));
                      }}
                    >
                      {p.name}{' '}
                      <span className="muted">
                        #{p.id} · ELO {p.rating ?? '—'}
                      </span>
                    </Button>
                    <PlayerActions player={{ ...p, teamId: null }} />
                  </div>
                ))
              ) : (
                <Empty
                  icon={<Icon icon={faMagnifyingGlass} size={24} />}
                  description={t('searchEmptyHint')}
                >
                  {t('searchEmpty')}
                </Empty>
              )}
            </div>
          )}
          {!results.data && !results.pending && !report.data && !report.pending && (
            <>
              <Empty icon={<Icon icon={faUsers} size={28} />} description={t('searchHint')}>
                {t('report')}
              </Empty>
              {!!(state.session.current?.players ?? state.session.lobbyPlayers).length && (
                <div className="player-suggestions">
                  <h3>{t('currentRoomPlayers')}</h3>
                  <div className="suggestion-list">
                    {(state.session.current?.players ?? state.session.lobbyPlayers).map((p) => (
                      <Button
                        key={p.id}
                        onClick={() => {
                          setSelectedId(p.id);
                          void report.load(() => api.invoke('players.report', { id: p.id }));
                        }}
                      >
                        <span className="player-avatar" aria-hidden="true">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        {p.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {report.pending && <Loading />}
      {report.error && <Notice error>{report.error}</Notice>}
      {report.data && <ReportView report={report.data} />}
      {selectedId && <MaggotProgress id={selectedId} />}
      {maggot.error && selectedId === maggot.id && <Notice error>{maggot.error}</Notice>}
      {maggot.data && selectedId === maggot.id && <MaggotView report={maggot.data} />}
    </Card>
  );
}
