import { useEffect, useRef, useState } from 'react';
import { RefreshCw, MapPin, Copy, History, Clock3, Users, Crosshair } from 'lucide-react';
import type { Match, Player } from '@ba/contracts';
import { formatDuration, formatMetric, teamLabel } from '@ba/shared';
import { useApp } from '../../app/state';
import { Card, Button, Empty, Badge } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { PlayerActions } from '../players/PlayerActions';
export function SessionPanel() {
  const { state, api, openModal, notify, patchConfig } = useApp(),
    { t } = useI18n();
  const [previous, setPrevious] = useState<Match | null>(null),
    [view, setView] = useState<'current' | 'previous'>('current'),
    [pending, setPending] = useState(false),
    [now, setNow] = useState(Date.now());
  const lastPrevious = useRef<string | null>(null);
  useEffect(() => {
    if (state.session.phase !== 'match' || view !== 'current') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.session.phase, view]);
  useEffect(() => {
    void api
      .invoke('matches.list', {})
      .then((matches) =>
        setPrevious(
          matches.find((m) => m.fid !== null && m.fid !== state.session.current?.fid) || null,
        ),
      )
      .catch((e) => notify(String(e), true));
  }, [api, state.matchesRevision, state.session.current?.fid]);
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
  const localTeam = players.find((p) => p.id === state.session.localPlayerId)?.teamId;
  const rating = (p: Player) =>
    rows[p.id]?.info?.elo ?? match?.players.find((player) => player.id === p.id)?.oldRating ?? null;
  const elapsed =
    view === 'current' && state.session.phase === 'match' && match?.startedAt && !match.endedAt
      ? Math.max(0, (now - match.startedAt) / 1000)
      : (match?.durationSec ?? null);
  return (
    <Card
      className="session-card"
      title={view === 'previous' ? t('previous') : t('current')}
      icon={<Crosshair size={19} />}
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
          <Button
            className="button-borderless"
            disabled={!previous || pending}
            onClick={previousView}
            aria-pressed={view === 'previous'}
          >
            <History size={15} aria-hidden="true" />
            {view === 'previous' ? t('back') : t('previous')}
          </Button>
          <Button
            variant="primary"
            disabled={pending || !players.length}
            onClick={() => void query(view)}
          >
            <RefreshCw size={15} className={pending ? 'spinner' : ''} aria-hidden="true" />
            {pending ? t('loading') : t('query')}
          </Button>
        </>
      }
    >
      <div className="session-banner">
        <div className="session-banner-content">
          <div className="session-kicker">
            <span
              className={`status-dot ${view === 'current' && state.session.phase === 'match' ? 'status-success' : ''}`}
              aria-hidden="true"
            />
            {t(
              view === 'previous'
                ? 'previous'
                : state.session.phase === 'match'
                  ? 'liveMatch'
                  : 'waiting',
            )}
            {match?.fid && <span className="match-id">#{match.fid}</span>}
          </div>
          <h3>{match?.map || t('sessionOverview')}</h3>
          <div className="match-meta">
            {match && (
              <span>
                <MapPin size={13} aria-hidden="true" />
                {t(match.mode)}
              </span>
            )}
            <span>
              <Users size={13} aria-hidden="true" />
              {t('playersCount', { n: players.length })}
            </span>
            {elapsed !== null && (
              <span>
                <Clock3 size={13} aria-hidden="true" />
                {formatDuration(elapsed)}
              </span>
            )}
            {(match?.localDeck || state.session.localDeck) && (
              <span>{match?.localDeck || state.session.localDeck}</span>
            )}
          </div>
        </div>
        <svg className="terrain-art" viewBox="0 0 260 140" fill="none" aria-hidden="true">
          <path
            d="M-20 95C40 120 10 30 70 50S110 125 160 90 170 15 250 30M-15 108C45 135 20 45 70 62S118 143 169 105 182 30 270 42M-5 80C35 95 4 15 62 37S106 107 145 76 168-5 250 15M-10 65C35 74 3-5 57 20S98 91 137 61 165-18 240 0M-20 120C45 150 29 58 72 77S128 160 180 117 196 45 275 58"
            stroke="currentColor"
            opacity=".22"
          />
          <path
            d="M72 98 114 64 176 78 219 44"
            stroke="currentColor"
            strokeDasharray="3 5"
            opacity=".55"
          />
          <circle cx="176" cy="78" r="18" stroke="currentColor" opacity=".3" />
          <circle cx="176" cy="78" r="6" stroke="currentColor" />
          <circle cx="176" cy="78" r="2" fill="currentColor" />
          <path d="M67 93 77 103M77 93 67 103M214 39 224 49M224 39 214 49" stroke="currentColor" />
        </svg>
      </div>
      {!players.length ? (
        <Empty icon={<Crosshair size={28} />} description={t('waitingHint')}>
          {t('waiting')}
        </Empty>
      ) : (
        <div className="team-grid">
          {([0, 1, 100, null] as const).map((team) => {
            const list = players.filter((p) => p.teamId === team);
            if (!list.length) return null;
            return (
              <div className={`team-column team-${team}`} key={String(team)}>
                <div className="team-title">
                  <h3>
                    <span className="team-indicator" aria-hidden="true" />
                    {teamLabel(team)}{' '}
                    <small>
                      {team === 0 || team === 1
                        ? t(
                            team === localTeam
                              ? 'friendlyTeam'
                              : localTeam === 0 || localTeam === 1
                                ? 'enemyTeam'
                                : 'playersCount',
                            { n: list.length },
                          )
                        : t('playersCount', { n: list.length })}
                    </small>
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
                    className="text-button icon-button"
                  >
                    <Copy size={14} aria-hidden="true" />
                  </Button>
                </div>
                <div className="team-rating">
                  <span>{t('teamRating')}</span>
                  <strong>
                    {list.every((p) => rating(p) !== null)
                      ? formatMetric(
                          list.reduce((sum, p) => sum + (rating(p) ?? 0), 0) / list.length,
                          0,
                        )
                      : '—'}
                  </strong>
                  <small>
                    {list.length} / {list.length}
                  </small>
                </div>
                {list.map((p) => {
                  const row = rows[p.id],
                    info = row?.info;
                  return (
                    <div
                      className={`player-card ${p.id === state.session.localPlayerId ? 'is-you' : ''}`}
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
                        <span className="player-avatar" aria-hidden="true">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="player-identity">
                          <strong>
                            {p.name}
                            {p.id === state.session.localPlayerId && (
                              <Badge tone="success">{t('you')}</Badge>
                            )}
                          </strong>
                          <small className="muted">
                            #{p.id}
                            {info && (
                              <>
                                {' '}
                                · {t(info.fallback ? 'winRate' : 'recentWinRate')}{' '}
                                {formatMetric(info.winRate, 0)}% · {t('latestKd')}{' '}
                                {formatMetric(info.kd)}
                              </>
                            )}
                          </small>
                          {row?.error && <small className="text-danger">{row.error}</small>}
                        </span>
                        <span className="player-rating">
                          <strong>{formatMetric(rating(p), 0)}</strong>
                          <small>ELO</small>
                        </span>
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
      <div className="session-footnote">
        <span className="status-dot status-success" aria-hidden="true" />
        {state.session.localName ? `${t('account')}: ${state.session.localName}` : t('noAccount')}
        <span>{t('historical')}</span>
      </div>
    </Card>
  );
}
