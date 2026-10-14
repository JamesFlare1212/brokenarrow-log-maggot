import { useEffect, useRef, useState } from 'react';
import { RefreshCw, MapPin, Copy, History } from 'lucide-react';
import type { Match, Player } from '@ba/contracts';
import { formatMetric, teamLabel } from '@ba/shared';
import { useApp } from '../../app/state';
import { Card, Button, Empty, Badge, Notice } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { PlayerActions } from '../players/PlayerActions';
export function SessionPanel() {
  const { state, api, openModal, notify, patchConfig } = useApp(),
    { t } = useI18n();
  const [previous, setPrevious] = useState<Match | null>(null),
    [view, setView] = useState<'current' | 'previous'>('current'),
    [pending, setPending] = useState(false);
  const lastPrevious = useRef<string | null>(null);
  useEffect(() => {
    void api
      .invoke('matches.list', {})
      .then((matches) => setPrevious(matches.find((m) => m.fid !== null) || null))
      .catch((e) => notify(String(e), true));
  }, [api, state.matchesRevision]);
  const players: Player[] =
      view === 'previous'
        ? previous?.players || []
        : (state.session.current?.players ?? state.session.lobbyPlayers),
    match = view === 'previous' ? previous : state.session.current;
  const query = async (context: 'current' | 'previous') => {
    if (pending) return;
    setPending(true);
    try {
      await api.invoke('session.query', {
        requestId: crypto.randomUUID(),
        context,
        ...(context === 'previous' ? { players, fid: previous?.fid || undefined } : {}),
      });
    } catch (e) {
      notify(String(e), true);
    } finally {
      setPending(false);
    }
  };
  const previousView = () => {
    if (view === 'previous') {
      setView('current');
      return;
    }
    if (!previous) return;
    setView('previous');
    if (lastPrevious.current !== previous.id) {
      lastPrevious.current = previous.id;
      setPending(true);
      void api
        .invoke('session.query', {
          requestId: crypto.randomUUID(),
          context: 'previous',
          players: previous.players,
          fid: previous.fid || undefined,
        })
        .catch((e) => notify(String(e), true))
        .finally(() => setPending(false));
    }
  };
  const rows = state.rosters[view].rows,
    collapsed = state.config.collapsedPanels.includes('current');
  return (
    <Card
      title={view === 'previous' ? t('previous') : t('current')}
      icon={<MapPin size={19} />}
      collapsed={collapsed}
      onToggle={() =>
        void patchConfig({
          collapsedPanels: collapsed
            ? state.config.collapsedPanels.filter((p) => p !== 'current')
            : [...state.config.collapsedPanels, 'current'],
        })
      }
      actions={
        <>
          <Button disabled={!previous || pending} onClick={previousView}>
            <History size={15} />
            {view === 'previous' ? t('back') : t('previous')}
          </Button>
          <Button disabled={pending || !players.length} onClick={() => void query(view)}>
            <RefreshCw size={15} />
            {pending ? t('loading') : t('query')}
          </Button>
        </>
      }
    >
      <div className="match-meta">
        <Badge tone={state.session.phase === 'match' ? 'success' : 'muted'}>
          {view === 'previous'
            ? t('previous')
            : state.session.phase === 'match'
              ? t('current')
              : t('waiting')}
        </Badge>
        {match?.map && (
          <span>
            {t('map')}: {match.map}
          </span>
        )}
        {match?.fid && <span>#{match.fid}</span>}
        {state.session.localName && (
          <span>
            {t('account')}: {state.session.localName}
          </span>
        )}
        {match?.localDeck && <span>{match.localDeck}</span>}
      </div>
      {!players.length ? (
        <Empty>{t('waiting')}</Empty>
      ) : (
        <div className="team-grid">
          {([0, 1, 100, null] as const).map((team) => {
            const list = players.filter((p) => p.teamId === team);
            if (!list.length) return null;
            return (
              <div className="team-column" key={String(team)}>
                <div className="team-title">
                  <h3>
                    {teamLabel(team)} <small>{list.length}</small>
                  </h3>
                  <Button
                    aria-label={t('copy') + ' ' + teamLabel(team)}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(
                          list
                            .map(
                              (p) => `${p.name} ${formatMetric(rows[p.id]?.info?.elo ?? null, 0)}`,
                            )
                            .join(', '),
                        )
                        .then(() => notify(t('copied')))
                        .catch((e) => notify(String(e), true))
                    }
                  >
                    <Copy size={14} />
                  </Button>
                </div>
                {list.map((p) => {
                  const row = rows[p.id],
                    info = row?.info;
                  return (
                    <div
                      className="player-card"
                      key={p.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.currentTarget
                          .querySelector<HTMLButtonElement>('[data-menu-trigger]')
                          ?.click();
                      }}
                    >
                      <button
                        className="player-main"
                        onClick={() => openModal({ type: 'profile', id: p.id, name: p.name })}
                      >
                        <strong>
                          {p.name}
                          {p.id === state.session.localPlayerId && <Badge tone="info">●</Badge>}
                          {state.toolUsers.includes(p.id) && <Badge tone="success">BA</Badge>}
                        </strong>
                        <span className="muted">
                          ID {p.id} · ELO {formatMetric(info?.elo ?? null, 0)}
                        </span>
                        {info && (
                          <span className="muted">
                            {t('winRate')} {formatMetric(info.winRate, 0)}% · K/D{' '}
                            {formatMetric(info.kd)}
                          </span>
                        )}
                        {row?.error && <span className="text-danger">{row.error}</span>}
                      </button>
                      <PlayerActions player={p} info={info} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      <Notice>{t('historical')}</Notice>
    </Card>
  );
}
