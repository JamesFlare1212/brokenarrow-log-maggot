import { useEffect, useRef, useState } from 'react';
import { faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import type { Ban } from '@ba/contracts';
import { formatMetric, formatTime } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Loading, Notice, Empty, Badge, Dialog } from '../../components/ui';
import { Pagination } from '../../components/Pagination';
const PAGE_SIZE = 20;
export function BansPanel() {
  const { api, state, openModal, notify } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<Ban[]>(),
    [page, setPage] = useState(1),
    [metOnly, setMetOnly] = useState(false),
    [syncing, setSyncing] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const bans = request.data ?? [];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(bans.length / PAGE_SIZE)));
  const visible = bans.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => {
    void request.load(() => api.invoke('bans.list', { metOnly }), true);
  }, [api, metOnly, state.bansRevision]);
  return (
    <section className="bans-panel" aria-label={t('bans')}>
      <div className="bans-toolbar">
        <button
          type="button"
          role="switch"
          className="sliding-filter ban-filter-switch"
          aria-label={t('metBans')}
          aria-checked={metOnly}
          onClick={() => {
            setMetOnly((value) => !value);
            setPage(1);
          }}
        >
          <span aria-hidden="true" data-selected={!metOnly}>
            {t('allBans')}
          </span>
          <span aria-hidden="true" data-selected={metOnly}>
            {t('metBans')}
          </span>
        </button>
        <Button
          variant="primary"
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
          {t('sync')}
        </Button>
      </div>
      {request.error && <Notice error>{request.error}</Notice>}
      <div className="results-viewport bans-results-viewport" aria-busy={request.pending}>
        {request.pending && (
          <div className="results-loading">
            <Loading />
          </div>
        )}
        {request.data?.length ? (
          <div
            className="ban-list ban-list-paged"
            ref={list}
            role="list"
            aria-label={t('bans')}
            tabIndex={0}
          >
            {visible.map((b) => (
              <div className="ban-row" key={b.id} role="listitem">
                <Button
                  className="button-borderless ban-player-button"
                  onClick={() => openModal({ type: 'profile', id: b.id, name: b.name })}
                >
                  <span>{b.name}</span> <small>#{b.id}</small>
                </Button>
                <span className="ban-rating">ELO {formatMetric(b.rating, 0)}</span>
                <span className="ban-encounter">
                  {b.encountered && <Badge tone="warning">{t('encounters')}</Badge>}
                </span>
                <time>{formatTime(b.firstSeenAt, locale)}</time>
              </div>
            ))}
          </div>
        ) : (
          !request.pending && (
            <Empty
              icon={<Icon icon={faShieldHalved} size={28} />}
              description={t('bansDescription')}
            >
              {t('empty')}
            </Empty>
          )
        )}
      </div>
      <Pagination
        page={currentPage}
        pageSize={PAGE_SIZE}
        total={bans.length}
        label={t('bans')}
        onPageChange={(value) => {
          setPage(value);
          if (list.current) list.current.scrollTop = 0;
        }}
        reserveSpace
      />
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
