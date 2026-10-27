import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw as faArrowsRotate,
  MapPin as faLocationDot,
  Copy as faCopy,
  History as faClockRotateLeft,
  Clock as faClock,
  Users as faUsers,
  Radar as faSatelliteDish,
  Layers,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import { TooltipButton } from '../../components/Tooltip';
import type { Match, Player } from '@ba/contracts';
import { formatDuration, formatMetric, teamLabel, matchTitles } from '@ba/shared';
import { useApp } from '../../app/state';
import { Card, Button, Empty } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { MatchAwards } from '../matches/MatchAwards';
import { Item, ItemContent, ItemActions } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useRosterHeight } from './useRosterHeight';
export function SessionPanel({ standalone = false }: { standalone?: boolean }) {
  const { state, api, openModal, notify } = useApp(),
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
  useEffect(() => {
    if (view !== 'previous' || !previous?.fid) return;
    let cancelled = false;
    void api
      .invoke('matches.detail', { fid: previous.fid, force: false })
      .then((detail) => {
        if (!cancelled) setPrevious((current) => (current?.fid === detail.fid ? detail : current));
      })
      .catch((error) => {
        if (!cancelled) notify(String(error), true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, view, previous?.fid]);
  const players: Player[] =
      view === 'previous'
        ? previous?.players || []
        : (state.session.current?.players ?? state.session.lobbyPlayers),
    match = view === 'previous' ? previous : state.session.current;
  const { layout, reservedHeight } = useRosterHeight(players.length > 0, !standalone);
  const titles = useMemo(
    () => (match?.endedAt ? (match.titles ?? matchTitles(match)) : {}),
    [match],
  );
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
  const rows = state.rosters[view].rows;
  const localPlayerId = state.session.localPlayerId ?? match?.localPlayerId;
  const localTeam = players.find((p) => p.id === localPlayerId)?.teamId;
  const rating = (p: Player) =>
    rows[p.id]?.info?.elo ?? match?.players.find((player) => player.id === p.id)?.oldRating ?? null;
  const elapsed =
    view === 'current' && state.session.phase === 'match' && match?.startedAt && !match.endedAt
      ? Math.max(0, (now - match.startedAt) / 1000)
      : (match?.durationSec ?? null);
  const title = view === 'previous' ? t('previous') : t('current');
  const actions = (
    <>
      <Button
        size="sm"
        className="button-borderless"
        disabled={!previous || pending}
        onClick={previousView}
        aria-pressed={view === 'previous'}
      >
        <Icon icon={faClockRotateLeft} size={15} aria-hidden="true" />
        {view === 'previous' ? t('back') : t('previous')}
      </Button>
      <Button
        variant="default"
        size="sm"
        disabled={pending || !players.length}
        aria-busy={pending}
        onClick={() => void query(view)}
      >
        <Icon icon={faArrowsRotate} size={15} spin={pending} aria-hidden="true" />
        {t('query')}
      </Button>
    </>
  );
  const content = (
    <>
      <div className="session-banner">
        {players.length > 0 && (
          <div className="session-banner-content">
            <div className="session-kicker">
              {t(
                view === 'previous'
                  ? 'previous'
                  : state.session.phase === 'match'
                    ? 'liveMatch'
                    : 'waiting',
              )}
              {match?.fid && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="match-id"
                  aria-label={`${t('copy')} ${t('matchId')}: ${match.fid}`}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(match.fid!)
                      .then(() => notify(t('copied')))
                      .catch((error) => notify(String(error), true))
                  }
                >
                  #{match.fid}
                </Button>
              )}
            </div>
            <h2>{match?.map || t('sessionOverview')}</h2>
            <div className="match-meta">
              {match && (
                <span>
                  <Icon icon={faLocationDot} size={13} aria-hidden="true" />
                  {t(match.mode)}
                </span>
              )}
              <span>
                <Icon icon={faUsers} size={13} aria-hidden="true" />
                {t('playersCount', { n: players.length })}
              </span>
              {elapsed !== null && (
                <span>
                  <Icon icon={faClock} size={13} aria-hidden="true" />
                  {formatDuration(elapsed)}
                </span>
              )}
              {(match?.localDeck || state.session.localDeck) && (
                <span>
                  <Layers size={13} aria-hidden="true" />
                  {match?.localDeck || state.session.localDeck}
                </span>
              )}
            </div>
          </div>
        )}
        <div className="session-actions">{actions}</div>
      </div>
      {players.length > 0 && <Separator />}
      {!players.length ? (
        <Empty
          icon={<Icon icon={faSatelliteDish} size={28} />}
          iconSize="lg"
          description={t('waitingHint')}
        >
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
                    {(team === 0 || team === 1) && (
                      <span className="team-indicator" aria-hidden="true" />
                    )}
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
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
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
                    <Icon icon={faCopy} size={14} aria-hidden="true" />
                  </Button>
                </div>
                {list.map((p) => {
                  const row = rows[p.id],
                    info = row?.info,
                    analysis =
                      row?.error ||
                      (info && (
                        <>
                          {t(info.fallback ? 'winRate' : 'recentWinRate')}{' '}
                          {formatMetric(info.winRate, 0)}% · {t('latestKd')} {formatMetric(info.kd)}
                        </>
                      ));
                  return (
                    <Item
                      variant={p.id === localPlayerId ? 'muted' : 'default'}
                      size="xs"
                      className="player-card"
                      key={p.id}
                    >
                      <ItemContent>
                        <div className="player-identity">
                          <div className="player-heading">
                            <TooltipButton
                              variant="link"
                              className="player-name-button h-auto px-0 py-0"
                              tooltip={
                                <>
                                  <span className="button-tooltip-label">
                                    {p.name} · #{p.id}
                                  </span>
                                  {analysis && (
                                    <span className="button-tooltip-detail">{analysis}</span>
                                  )}
                                </>
                              }
                              onClick={() => openModal({ type: 'profile', id: p.id, name: p.name })}
                            >
                              <span className="player-name">{p.name}</span>
                            </TooltipButton>
                            <MatchAwards
                              key={`${match?.id}:${p.id}`}
                              titles={titles[p.id] ?? []}
                              scoreLabels={
                                match?.endedAt !== null && match?.endedAt !== undefined
                                  ? match.scoreLabels?.[p.id]
                                  : undefined
                              }
                            />
                          </div>
                          <div className="player-meta">
                            <small className="player-id muted">#{p.id}</small>
                            <small className="player-analysis muted">
                              <span className="player-analysis-placeholder" aria-hidden="true">
                                {t('recentWinRate')} 100% · {t('latestKd')} 999.99
                              </span>
                              <span
                                className={
                                  row?.error ? 'player-analysis-error text-danger' : undefined
                                }
                              >
                                {analysis}
                              </span>
                            </small>
                          </div>
                        </div>
                      </ItemContent>
                      <ItemActions>
                        <span className="player-rating">
                          <strong>{formatMetric(rating(p), 0)}</strong>
                          <small>ELO</small>
                        </span>
                      </ItemActions>
                    </Item>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
  if (standalone) {
    return (
      <section className="session-panel session-roster" aria-label={title}>
        {content}
      </section>
    );
  }
  return (
    <Card
      className={cn('session-card session-roster', players.length === 0 && 'session-empty')}
      contentClassName="session-content"
      title={title}
      showHeader={false}
    >
      <div
        ref={layout}
        className="session-layout"
        style={{ minHeight: players.length === 0 ? (reservedHeight ?? undefined) : undefined }}
      >
        {content}
      </div>
    </Card>
  );
}
