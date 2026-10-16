import { BATRACE_ORIGIN } from '@ba/contracts';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Archive, Plus, RefreshCw } from 'lucide-react';
import type { Match, Account } from '@ba/contracts';
import { formatTime, formatDelta, outcomeTone } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Card, Badge, Field, Loading, Notice, Empty, Menu } from '../../components/ui';
import { Pagination } from '../../components/Pagination';
const PAGE_SIZE = 50;
export function MatchArchive() {
  const { api, state, openModal, notify } = useApp(),
    { t, locale } = useI18n(),
    matches = useRequest<Match[]>(),
    [accounts, setAccounts] = useState<Account[]>([]),
    [account, setAccount] = useState(''),
    [fid, setFid] = useState(''),
    [adding, setAdding] = useState(false),
    [scanning, setScanning] = useState(false),
    [page, setPage] = useState(1),
    [outcome, setOutcome] = useState<'all' | 'win' | 'loss'>('all');
  const filtered = useMemo(
    () =>
      [...(matches.data || [])]
        .sort((a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0))
        .filter((m) => outcome === 'all' || m.outcome === outcome),
    [matches.data, outcome],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const refresh = () =>
    void matches.load(
      () => api.invoke('matches.list', account ? { accountId: account } : {}),
      true,
    );
  const scan = async () => {
    setScanning(true);
    try {
      await api.invoke('matches.scan', null);
    } catch (error) {
      notify(String(error), true);
    } finally {
      refresh();
      setScanning(false);
    }
  };
  useEffect(() => {
    refresh();
    void api
      .invoke('accounts.list', null)
      .then(setAccounts)
      .catch((e) => notify(String(e), true));
  }, [api, state.matchesRevision, account]);
  return (
    <Card title={t('archive')} showHeader={false}>
      <div className="archive-toolbar">
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\d+$/.test(fid)) return;
            setAdding(true);
            void api
              .invoke('matches.add', { fid })
              .then(() => {
                setFid('');
                notify(t('success'));
                refresh();
              })
              .catch((e) => notify(String(e), true))
              .finally(() => setAdding(false));
          }}
        >
          <Field id="match-id" label={t('matchId')}>
            <input
              id="match-id"
              inputMode="numeric"
              placeholder="8050000"
              pattern="[0-9]+"
              value={fid}
              onChange={(e) => setFid(e.target.value)}
              maxLength={32}
            />
          </Field>
          <Button variant="primary" type="submit" disabled={adding || !/^\d+$/.test(fid)}>
            <Plus size={16} aria-hidden="true" />
            {t(adding ? 'loading' : 'addMatch')}
          </Button>
        </form>
        <Field id="archive-account" label={t('account')}>
          <select
            id="archive-account"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('allAccounts')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="filter-row">
        <div
          className="sliding-filter"
          role="group"
          aria-label={t('result')}
          style={
            {
              '--segment-count': 3,
              '--segment-index': ['all', 'win', 'loss'].indexOf(outcome),
            } as CSSProperties
          }
        >
          {(['all', 'win', 'loss'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={outcome === value}
              onClick={() => {
                setOutcome(value);
                setPage(1);
              }}
            >
              {t(value === 'all' ? 'allResults' : value === 'win' ? 'winsOnly' : 'lossesOnly')}
            </button>
          ))}
        </div>
        <div className="archive-results-actions">
          <small className="muted">
            {t('samples')}: {filtered.length}
          </small>
          <Button
            disabled={matches.pending || scanning}
            onClick={() => void scan()}
            aria-busy={scanning}
          >
            <RefreshCw
              size={15}
              className={matches.pending || scanning ? 'spinner' : ''}
              aria-hidden="true"
            />
            {t(scanning ? 'scanningLogs' : 'refresh')}
          </Button>
        </div>
      </div>
      {matches.error && <Notice error>{matches.error}</Notice>}
      <div className="results-viewport archive-results-viewport" aria-busy={matches.pending}>
        {matches.pending && (
          <div className="results-loading">
            <Loading />
          </div>
        )}
        {filtered.length ? (
          <div className="table-wrap archive-table">
            <table>
              <caption className="sr-only">{t('archive')}</caption>
              <colgroup>
                <col style={{ width: 72 }} />
                <col style={{ width: 84 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 160 }} />
                <col />
                <col style={{ width: 80 }} />
              </colgroup>
              <thead>
                <tr>
                  {['result', 'mode', 'map', 'eloDelta', 'time', 'account', 'actions'].map((k) => (
                    <th key={k} className={k === 'eloDelta' ? 'elo-column' : undefined}>
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Badge tone={outcomeTone(m.outcome)}>
                        {m.restarted ? t('restarted') : t(m.outcome)}
                      </Badge>
                    </td>
                    <td>
                      <Badge>{t(m.mode)}</Badge>
                    </td>
                    <td>
                      <Button
                        onClick={() =>
                          m.fid ? openModal({ type: 'match', fid: m.fid }) : notify(t('offline'))
                        }
                      >
                        {m.map || '#' + m.id}
                      </Button>
                    </td>
                    <td className="elo-column">
                      <span
                        className={
                          m.eloAfter !== null && m.eloBefore !== null
                            ? m.eloAfter >= m.eloBefore
                              ? 'text-success'
                              : 'text-danger'
                            : ''
                        }
                      >
                        {formatDelta(
                          m.eloAfter !== null && m.eloBefore !== null
                            ? m.eloAfter - m.eloBefore
                            : null,
                        )}
                      </span>
                    </td>
                    <td>{formatTime(m.endedAt ?? m.startedAt, locale)}</td>
                    <td>{m.localPersona || '—'}</td>
                    <td>
                      <Menu label={`${t('actions')}: #${m.fid || m.id}`}>
                        {m.fid && (
                          <>
                            <Button
                              onClick={() =>
                                void api
                                  .invoke('matches.detail', { fid: m.fid || '', force: true })
                                  .then(() => refresh())
                                  .catch((e) => notify(String(e), true))
                              }
                            >
                              {t('refresh')}
                            </Button>
                            <Button
                              onClick={() =>
                                void api.invoke('external.open', {
                                  url: `${BATRACE_ORIGIN}/match/${m.fid}`,
                                })
                              }
                            >
                              {t('openBatrace')}
                            </Button>
                          </>
                        )}
                        <Button
                          variant="danger"
                          onClick={() => {
                            if (window.confirm(t('deleteConfirm')))
                              void api
                                .invoke('matches.delete', { id: m.id })
                                .then(() => refresh())
                                .catch((e) => notify(String(e), true));
                          }}
                        >
                          {t('delete')}
                        </Button>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !matches.pending && (
            <Empty
              icon={<Archive size={26} />}
              description={t('noMatchesHint')}
              action={
                outcome !== 'all' || account ? (
                  <Button
                    onClick={() => {
                      setOutcome('all');
                      setAccount('');
                      setPage(1);
                    }}
                  >
                    {t('clearFilters')}
                  </Button>
                ) : undefined
              }
            >
              {t(outcome !== 'all' || account ? 'noFilteredMatches' : 'empty')}
            </Empty>
          )
        )}
      </div>
      <Pagination
        page={currentPage}
        pageSize={PAGE_SIZE}
        total={filtered.length}
        label={t('archivePagination')}
        onPageChange={setPage}
        reserveSpace
      />
    </Card>
  );
}
