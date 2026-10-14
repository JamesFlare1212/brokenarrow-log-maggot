import { useState } from 'react';
import { Search } from 'lucide-react';
import type { PlayerReport, RpcOutputs } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Card, Field, Button, Empty, Loading, Notice } from '../../components/ui';
import { ReportView, MaggotView, MaggotProgress } from './Reports';
import { PlayerActions } from './PlayerActions';
export function PlayersPanel() {
  const { api, maggot } = useApp(),
    { t } = useI18n(),
    [query, setQuery] = useState('');
  const results = useRequest<RpcOutputs['players.search']>(),
    report = useRequest<PlayerReport>();
  return (
    <Card title={t('players')} icon={<Search size={19} />}>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim())
            void results.load(() => api.invoke('players.search', { query: query.trim() }));
        }}
      >
        <Field id="player-search" label={t('searchLabel')}>
          <input
            id="player-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
          />
        </Field>
        <Button type="submit" disabled={results.pending || !query.trim()} variant="primary">
          {t('search')}
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
            <Empty>{t('empty')}</Empty>
          )}
        </div>
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
