import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import type { Match, Player } from '@ba/contracts';
import {
  currentRosterKey,
  previousRosterKey,
  formatDuration,
  formatMetric,
  formatPercent,
  formatTime,
  matchTitles,
} from '@ba/shared';
import { localizedTeamLabel } from '../../lib/team-label';
import { useApp } from '../../app/state';
import { Card, Button, Empty } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { useClipboard } from '../../hooks/useClipboard';
import { MatchAwards } from '../matches/MatchAwards';
import { Button as PrimitiveButton } from '@/components/ui/button';
import { Item, ItemContent, ItemActions } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { useRosterSlots } from './useRosterSlots';
import { RosterIdentity, rosterErrorLabel } from './RosterIdentity';
export function SessionPanel({ standalone = false }: { standalone?: boolean }) {
  const { state, api, openModal, notify } = useApp(),
    { t, locale } = useI18n();
  const copy = useClipboard();
  const [previous, setPrevious] = useState<Match | null>(null),
    [view, setView] = useState<'current' | 'previous'>('current'),
    [request, setRequest] = useState<{ id: string; sourceKey: string } | null>(null),
    [now, setNow] = useState(Date.now());
  const lastPrevious = useRef<string | null>(null);
  const statusId = useId();
  useEffect(() => {
    if (state.session.phase !== 'match' || view !== 'current') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.session.phase, view]);
  useEffect(() => {
    let cancelled = false;
    void api
      .invoke('matches.list', {})
      .then((matches) => {
        if (!cancelled)
          setPrevious(
            matches.find((m) => m.fid !== null && m.fid !== state.session.current?.fid) || null,
          );
      })
      .catch((e) => {
        if (!cancelled) notify(String(e), true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, state.matchesRevision, state.session.current?.fid, state.session.generation]);
  useEffect(() => {
    if (view !== 'previous' || !previous?.fid) return;
    let cancelled = false;
    void api
      .invoke('matches.detail', {
        fid: previous.fid,
        force: false,
        accountId: previous.localPlayerId,
      })
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
  const roster: Player[] =
      view === 'previous'
        ? previous?.players || []
        : (state.session.current?.players ?? state.session.lobbyPlayers),
    match = view === 'previous' ? previous : state.session.current;
  const isLobby = view === 'current' && state.session.phase === 'lobby' && !match;
  const players: Player[] = isLobby ? roster.map((player) => ({ ...player, teamId: 0 })) : roster;
  const rosterScope =
    view === 'previous'
      ? JSON.stringify(['previous', previous?.fid ?? previous?.id])
      : JSON.stringify([
          'current',
          state.session.generation,
          state.session.lobbyId,
          match?.id,
          state.session.phase,
        ]);
  const { slots, compact, vacancies } = useRosterSlots(rosterScope, players);
  const press = useRef<{ scope: string; key: string } | null>(null);
  const titles = useMemo(
    () => (match?.endedAt ? (match.titles ?? matchTitles(match)) : {}),
    [match],
  );
  const sourceKey =
    view === 'current' ? currentRosterKey(state.session) : previousRosterKey(previous?.fid, roster);
  const batch = state.rosters[view];
  const rows = batch.sourceKey === sourceKey ? batch.rows : {};
  const pendingIds = batch.sourceKey === sourceKey ? batch.pendingIds : [];
  const retryAt = batch.sourceKey === sourceKey ? batch.retryAt : null;
  const failedCount = players.filter((player) => rows[player.id]?.error).length;
  const pending = request?.sourceKey === sourceKey || pendingIds.length > 0;
  const runQuery = useCallback(
    async (
      context: 'current' | 'previous',
      queryPlayers: Player[],
      fid: string | null | undefined,
      key: string,
    ) => {
      const id = crypto.randomUUID();
      setRequest({ id, sourceKey: key });
      try {
        await api.invoke('session.query', {
          requestId: id,
          context,
          ...(context === 'previous' ? { players: queryPlayers, fid: fid || undefined } : {}),
        });
      } catch (e) {
        notify(String(e), true);
      } finally {
        setRequest((current) => (current?.id === id ? null : current));
      }
    },
    [api, notify],
  );
  useEffect(() => {
    if (view !== 'previous' || !previous) return;
    const key = previousRosterKey(previous.fid, previous.players);
    if (lastPrevious.current === key) return;
    lastPrevious.current = key;
    void runQuery('previous', previous.players, previous.fid, key);
  }, [view, previous, runQuery]);
  const query = () => {
    if (!pending && players.length) void runQuery(view, players, previous?.fid, sourceKey);
  };
  const previousView = () => {
    if (pending) return;
    if (view === 'previous') {
      setView('current');
      return;
    }
    if (!previous) return;
    setView('previous');
  };
  const localPlayerId = state.session.localPlayerId ?? match?.localPlayerId;
  const localTeam = players.find((p) => p.id === localPlayerId)?.teamId;
  const rating = (p: Player) =>
    rows[p.id]?.info?.elo ?? match?.players.find((player) => player.id === p.id)?.oldRating ?? null;
  const usesMatchRating = (p: Player) =>
    rows[p.id]?.info?.elo == null &&
    match?.players.some((player) => player.id === p.id && player.oldRating != null);
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
        aria-label={t('rosterCompact')}
        aria-disabled={!vacancies}
        tooltip={t('rosterCompactHint')}
        onClick={() => {
          if (vacancies) {
            press.current = null;
            compact();
          }
        }}
      >
        {t('rosterCompact')}
      </Button>
      <Button
        size="sm"
        className="button-borderless"
        aria-disabled={pending || (view !== 'previous' && !previous)}
        onClick={previousView}
        aria-pressed={view === 'previous'}
      >
        <Icon icon={faClockRotateLeft} size={15} aria-hidden="true" />
        {view === 'previous' ? t('back') : t('previous')}
      </Button>
      <Button
        variant="default"
        size="sm"
        aria-disabled={pending || !players.length}
        aria-busy={pending}
        onClick={query}
      >
        <Icon icon={faArrowsRotate} size={15} spin={pending} aria-hidden="true" />
        {t('query')}
      </Button>
    </>
  );
  const content = (
    <div className="session-layout">
      <div className="session-banner">
        {slots.length > 0 && (
          <div className="session-banner-content">
            <div className="session-kicker">
              {t(
                view === 'current' && (state.watcher.error || state.watcher.live === false)
                  ? 'logLastKnownRoom'
                  : view === 'previous'
                    ? 'previous'
                    : state.session.phase === 'match'
                      ? 'liveMatch'
                      : isLobby
                        ? 'waitingForMatch'
                        : 'waiting',
              )}
              {match?.fid && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="match-id"
                  aria-label={`${t('copy')} ${t('matchId')}: ${match.fid}`}
                  onClick={() => void copy(match.fid!)}
                >
                  #{match.fid}
                </Button>
              )}
            </div>
            <h2>{match?.map || t(isLobby ? 'partyLobby' : 'sessionOverview')}</h2>
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
      {slots.length > 0 && <Separator />}
      {!slots.length ? (
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
            const teamSlots = slots.filter((slot) => slot.player.teamId === team);
            if (!teamSlots.length) return null;
            const label = localizedTeamLabel(team, locale);
            return (
              <div className={`team-column team-${team}`} key={String(team)}>
                <div className="team-title">
                  <h3>
                    {(team === 0 || team === 1) && (
                      <span className="team-indicator" aria-hidden="true" />
                    )}
                    {label}{' '}
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
                      {list.length > 0 && list.every((p) => rating(p) !== null)
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
                    aria-label={t('copy') + ' ' + label}
                    aria-disabled={!list.length}
                    onClick={() => {
                      if (!list.length) return;
                      void copy(
                        list
                          .map(
                            (p) =>
                              `${p.name} ${formatMetric(rating(p), 0)}${usesMatchRating(p) ? ' (' + t('matchStartingRating') + ')' : rows[p.id]?.info?.stale || pendingIds.includes(p.id) ? ' (' + t(pendingIds.includes(p.id) ? 'rosterRefreshing' : 'stale') + ')' : ''}`,
                          )
                          .join(', '),
                      );
                    }}
                  >
                    <Icon icon={faCopy} size={14} aria-hidden="true" />
                  </Button>
                </div>
                {teamSlots.map(({ player: p, active, key: slotKey }) => {
                  const row = rows[p.id],
                    info = row?.info,
                    awaiting = pendingIds.includes(p.id),
                    analysis =
                      (row?.error ? rosterErrorLabel(row.error, t) : null) ||
                      (info && (
                        <>
                          {t(info.fallback ? 'winRate' : 'recentWinRate')}{' '}
                          {formatPercent(info.winRate)} · {t('latestKd')} {formatMetric(info.kd)}
                        </>
                      ));
                  const elsewhere = players.find((player) => player.id === p.id);
                  const membership = active
                    ? ''
                    : elsewhere
                      ? t('rosterPlayerMoved', {
                          team: localizedTeamLabel(elsewhere.teamId, locale),
                        })
                      : t('rosterPlayerLeft');
                  const status =
                    membership ||
                    (awaiting
                      ? t(info ? 'rosterRefreshingPrevious' : 'rosterPlayerLoading', {
                          time: info ? formatTime(info.updatedAt, locale) : '',
                        })
                      : info?.stale
                        ? `${t('stale')} · ${formatTime(info.updatedAt, locale)}`
                        : row?.error
                          ? t('rosterQueryFailed')
                          : '');
                  return (
                    <Item
                      variant={p.id === localPlayerId ? 'muted' : 'default'}
                      size="xs"
                      className="player-card"
                      key={slotKey}
                      data-player-id={p.id}
                      data-player-active={active}
                    >
                      <PrimitiveButton
                        type="button"
                        variant="ghost"
                        className="player-card-trigger"
                        aria-label={`${p.name} · #${p.id} · ${label}`}
                        aria-describedby={`${statusId}-${slotKey}`}
                        aria-disabled={!active}
                        aria-haspopup="dialog"
                        onPointerDown={() => {
                          press.current = { scope: rosterScope, key: slotKey };
                        }}
                        onPointerCancel={() => {
                          press.current = null;
                        }}
                        onClick={(event) => {
                          if (
                            !active ||
                            (event.detail > 0 &&
                              (press.current?.scope !== rosterScope ||
                                press.current.key !== slotKey))
                          )
                            return;
                          press.current = null;
                          openModal({ type: 'profile', id: p.id, name: p.name });
                        }}
                      />
                      <ItemContent>
                        <div className="player-identity">
                          <div className="player-heading">
                            <span className="player-name min-w-0 font-medium text-primary">
                              {p.name}
                            </span>
                            <RosterIdentity
                              id={p.id}
                              name={p.name}
                              team={label}
                              status={status}
                              error={active ? (row?.error ?? undefined) : undefined}
                              analysis={active ? analysis : null}
                            />
                            {active && (
                              <MatchAwards
                                key={`${match?.id}:${p.id}`}
                                titles={titles[p.id] ?? []}
                                scoreLabels={
                                  match?.endedAt !== null && match?.endedAt !== undefined
                                    ? match.scoreLabels?.[p.id]
                                    : undefined
                                }
                              />
                            )}
                          </div>
                          <small
                            id={`${statusId}-${slotKey}`}
                            className="player-query-status text-muted-foreground"
                          >
                            {status}
                          </small>
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
                                {active ? analysis : null}
                              </span>
                            </small>
                          </div>
                        </div>
                      </ItemContent>
                      <ItemActions>
                        <span className="player-rating">
                          <strong>{formatMetric(active ? rating(p) : null, 0)}</strong>
                          <small className="whitespace-nowrap">
                            {usesMatchRating(p) ? t('matchStartingRating') : 'ELO'}
                          </small>
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
      {pending && (
        <p role="status" className="text-sm text-muted-foreground wrap-anywhere">
          {pendingIds.length
            ? t('rosterQueryProgress', {
                done: Object.keys(rows).filter((id) => !pendingIds.includes(id)).length,
                total:
                  Object.keys(rows).filter((id) => !pendingIds.includes(id)).length +
                  pendingIds.length,
              })
            : t('rosterQueryLoading')}
        </p>
      )}
      {!pending && failedCount > 0 && (
        <p role="status" className="text-sm text-muted-foreground wrap-anywhere">
          {t(retryAt ? 'rosterRetryScheduled' : 'rosterQueryIncomplete', {
            n: failedCount,
            time: retryAt ? new Date(retryAt).toLocaleTimeString(locale) : '',
          })}
        </p>
      )}
      {players.some(
        (player) =>
          rows[player.id]?.info?.stale || (pendingIds.includes(player.id) && rows[player.id]?.info),
      ) && (
        <p className="text-sm text-muted-foreground wrap-anywhere">{t('rosterMixedFreshness')}</p>
      )}
    </div>
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
      className="session-card session-roster"
      contentClassName="session-content"
      title={title}
      showHeader={false}
    >
      {content}
    </Card>
  );
}
