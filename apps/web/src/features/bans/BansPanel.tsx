import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import type { Ban } from '@ba/contracts';
import { formatMetric, formatTime } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Card, Loading, Notice, Empty, Badge, Dialog } from '../../components/ui';
export function BansPanel() {
  const { api, state, openModal, notify } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<Ban[]>(),
    [metOnly, setMetOnly] = useState(false),
    [syncing, setSyncing] = useState(false);
  useEffect(() => {
    void request.load(() => api.invoke('bans.list', { metOnly }));
  }, [api, metOnly, state.bansRevision]);
  return (
    <Card
      title={t('bans')}
      icon={<Shield size={19} />}
      actions={
        <>
          <Button
            variant="primary"
            disabled={syncing}
            onClick={() => {
              setSyncing(true);
              void api
                .invoke('bans.sync', null)
                .then(() => request.load(() => api.invoke('bans.list', { metOnly })))
                .catch((e) => notify(String(e), true))
                .finally(() => setSyncing(false));
            }}
          >
            {t('sync')}
          </Button>
        </>
      }
    >
      <div className="segmented-control" role="group" aria-label={t('bans')}>
        <Button aria-pressed={!metOnly} onClick={() => setMetOnly(false)}>
          {t('allBans')}
        </Button>
        <Button aria-pressed={metOnly} onClick={() => setMetOnly(true)}>
          {t('metBans')}
        </Button>
      </div>
      {request.pending && <Loading />}
      {request.error && <Notice error>{request.error}</Notice>}
      {request.data?.length ? (
        <div className="ban-list">
          {request.data.map((b) => (
            <div className="ban-row" key={b.id}>
              <Button onClick={() => openModal({ type: 'profile', id: b.id, name: b.name })}>
                {b.name} <small>#{b.id}</small>
              </Button>
              <span>ELO {formatMetric(b.rating, 0)}</span>
              {b.encountered && <Badge tone="warning">{t('encounters')}</Badge>}
              <time>{formatTime(b.firstSeenAt, locale)}</time>
            </div>
          ))}
        </div>
      ) : (
        !request.pending && (
          <Empty icon={<Shield size={28} />} description={t('bansDescription')}>
            {t('empty')}
          </Empty>
        )
      )}
    </Card>
  );
}
export function BanAlertDialog({ players }: { players: Ban[] }) {
  const { openModal, closeModal } = useApp(),
    { t } = useI18n();
  return (
    <Dialog open onClose={closeModal} title={t('banAlert')}>
      <div className="ban-list">
        {players.map((p) => (
          <div className="ban-row" key={p.id}>
            <strong>{p.name}</strong>
            <Badge tone="danger">{t('banned')}</Badge>
            <Button onClick={() => openModal({ type: 'profile', id: p.id, name: p.name })}>
              {t('investigate')}
            </Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
