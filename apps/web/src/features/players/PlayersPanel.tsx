import { useState } from 'react';
import { Search, Users } from 'lucide-react';
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
    [query, setQuery] = useState('');
  const results = useRequest<RpcOutputs['players.search']>(),
    report = useRequest<PlayerReport>();
  return (
    <Card title={t('players')} icon={<Search size={19} />}>
      <form
        className="search-form"
        aria-busy={results.pending}
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim())
            void results.load(() => api.invoke('players.search', { query: query.trim() }));
        }}
      >
        <Field id="player-search" label={t('searchLabel')} hint={t('searchHint')}>
          <div className="search-input-wrap">
            <Search size={18} aria-hidden="true" />
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
        <Button type="submit" disabled={results.pending || !query.trim()} variant="primary">
          <Search size={16} aria-hidden="true" />
          {t(results.pending ? 'loading' : 'search')}
        </Button>
      </form>
      {results.pending && <Loading />}
      {results.error && <Notice error>{results.error}</Notice>}
      {results.data?.source === 'local' && <Notice>{t('offline')}</Notice>}
      {results.data && (
        <div className="search-results">
          {results.data.players.length ? (
            results.data.players.map((p) => (
              <div className="search-result" key={p.id}>
                <Button
                  onClick={() => void report.load(() => api.invoke('players.report', { id: p.id }))}
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
            <Empty icon={<Search size={24} />} description={t('searchEmptyHint')}>
              {t('searchEmpty')}
            </Empty>
          )}
        </div>
      )}
      {!results.data && !results.pending && !report.data && !report.pending && (
        <>
          <Empty icon={<Users size={28} />} description={t('searchHint')}>
            {t('report')}
          </Empty>
          {!!(state.session.current?.players ?? state.session.lobbyPlayers).length && (
            <div className="player-suggestions">
              <h3>{t('currentRoomPlayers')}</h3>
              <div className="suggestion-list">
                {(state.session.current?.players ?? state.session.lobbyPlayers).map((p) => (
                  <Button
                    key={p.id}
                    onClick={() =>
                      void report.load(() => api.invoke('players.report', { id: p.id }))
                    }
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
      {report.pending && <Loading />}
      {report.error && <Notice error>{report.error}</Notice>}
      {report.data && <ReportView report={report.data} />}
      <MaggotProgress />
      {maggot.error && (!report.data || report.data.id === maggot.id) && (
        <Notice error>{maggot.error}</Notice>
      )}
      {maggot.data && (!report.data || report.data.id === maggot.id) && (
        <MaggotView report={maggot.data} />
      )}
    </Card>
  );
}
