import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import type { Match, Account } from '@ba/contracts';
import { formatTime, formatDelta, outcomeTone } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Card, Badge, Field, Loading, Notice, Empty, Menu } from '../../components/ui';
export function MatchArchive() {
  const { api, state, openModal, notify } = useApp(),
    { t, locale } = useI18n(),
    matches = useRequest<Match[]>(),
    [accounts, setAccounts] = useState<Account[]>([]),
    [account, setAccount] = useState(''),
    [fid, setFid] = useState(''),
    [adding, setAdding] = useState(false);
  const refresh = () =>
    void matches.load(
      () => api.invoke('matches.list', account ? { accountId: account } : {}),
      true,
    );
  useEffect(() => {
    refresh();
    void api
      .invoke('accounts.list', null)
      .then(setAccounts)
      .catch((e) => notify(String(e), true));
  }, [api, state.matchesRevision, account]);
  return (
    <Card
      title={t('archive')}
      icon={<Archive size={19} />}
      actions={
        <Button disabled={matches.pending} onClick={refresh}>
          {t('refresh')}
        </Button>
      }
    >
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
              pattern="[0-9]+"
              value={fid}
              onChange={(e) => setFid(e.target.value)}
              maxLength={32}
            />
          </Field>
          <Button type="submit" disabled={adding || !/^\d+$/.test(fid)}>
            {t('addMatch')}
          </Button>
        </form>
        <Field id="archive-account" label={t('account')}>
          <select id="archive-account" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">{t('allAccounts')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {matches.pending && !matches.data && <Loading />}
      {matches.error && <Notice error>{matches.error}</Notice>}
      {matches.data?.length ? (
        <div className="table-wrap archive-table">
          <table>
            <caption className="sr-only">{t('archive')}</caption>
            <thead>
              <tr>
                {['result', 'mode', 'map', 'eloDelta', 'time', 'account', 'actions'].map((k) => (
                  <th key={k}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matches.data.map((m) => (
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
                  <td>
                    {formatDelta(
                      m.eloAfter !== null && m.eloBefore !== null ? m.eloAfter - m.eloBefore : null,
                    )}
                  </td>
                  <td>{formatTime(m.endedAt, locale)}</td>
                  <td>{m.localPersona || '—'}</td>
                  <td>
                    <Menu>
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
                                url: `https://app.batrace.top/match/${m.fid}`,
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
        !matches.pending && <Empty>{t('empty')}</Empty>
      )}
    </Card>
  );
}
