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
import type { Match, Player } from '@ba/contracts';
import { formatDuration, formatMetric, teamLabel, matchTitles } from '@ba/shared';
import { useApp } from '../../app/state';
import { Card, Button, Empty } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { MatchAwards } from '../matches/MatchAwards';
import { Button as PrimitiveButton } from '@/components/ui/button';
import { Item, ItemContent, ItemActions } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
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
  const roster: Player[] =
      view === 'previous'
        ? previous?.players || []
        : (state.session.current?.players ?? state.session.lobbyPlayers),
    match = view === 'previous' ? previous : state.session.current;
  const isLobby = view === 'current' && state.session.phase === 'lobby' && !match;
  const players: Player[] = isLobby ? roster.map((player) => ({ ...player, teamId: 0 })) : roster;
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
    <div
      className="session-layout flex min-w-0 flex-col gap-(--session-layout-gap) min-h-[calc(_var(--session-banner-height)+2_*_var(--session-layout-gap)+var(--session-separator-height)+var(--session-roster-height)_)] [.page-current_&[data-empty='true']]:min-h-0 [&>[data-slot='separator']]:h-(--session-separator-height) [&>[data-slot='empty']]:py-8 [&>[data-slot='empty']]:max-h-[max(9.5rem,_calc(100svh_-_28rem))] [@media(max-height:44rem)]:[&>[data-slot='empty']]:py-4"
      data-empty={!players.length && !pending && !match && !isLobby}
    >
      <div className="session-banner flex flex-wrap items-start justify-between gap-4 [&_h2]:text-[1.25rem] [&_h2]:leading-[var(--session-map-line-height)] [&_h2]:font-semibold [&_h2]:tracking-[-0.025em]">
        {players.length > 0 && (
          <div className="session-banner-content flex min-w-0 [flex:1_1_16rem] flex-col gap-(--session-banner-content-gap)">
            <div className="session-kicker flex items-center gap-2 flex-wrap text-muted-foreground text-[0.75rem] min-h-(--session-kicker-height) leading-[var(--session-kicker-line-height)]">
              {t(
                view === 'previous'
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
                  className="match-id [.session-kicker_&]:h-auto [.session-kicker_&]:p-0 [.session-kicker_&]:leading-[inherit]"
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
            <h2>{match?.map || t(isLobby ? 'partyLobby' : 'sessionOverview')}</h2>
            <div className="match-meta flex items-center gap-2 flex-wrap text-muted-foreground text-[0.75rem] leading-[var(--session-meta-line-height)] [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5">
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
        <div className="session-actions flex flex-wrap items-center justify-end gap-2 ml-auto">
          {actions}
        </div>
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
        <div className="team-grid grid grid-cols-2 gap-(--content-gap) [.session-roster_&]:gap-(--session-team-grid-gap) workspace-max-48:grid-cols-1 viewport-max-767:grid-cols-1 viewport-max-767:gap-6">
          {([0, 1, 100, null] as const).map((team) => {
            const list = players.filter((p) => p.teamId === team);
            if (!list.length) return null;
            const label = teamLabel(team);
            return (
              <div
                className={`team-column flex min-w-0 flex-col gap-(--session-player-gap) team-${team}`}
                key={String(team)}
              >
                <div className="team-title flex items-center gap-2 justify-between min-h-(--session-team-heading-height) px-2.5 border-x border-x-transparent mb-(--session-team-heading-margin) [&_h3]:flex [&_h3]:items-center [&_h3]:gap-2 [&_h3]:flex-1 [&_h3]:min-w-0 [&_h3]:flex-wrap [&_h3]:text-[0.875rem] [&_h3]:font-medium [&_h3_small]:text-[0.75rem] [&_h3_small]:text-muted-foreground [&_h3_small]:min-w-0 [&_h3_small]:wrap-anywhere session-roster-max-24:grid session-roster-max-24:grid-cols-[minmax(0,_1fr)_auto] session-roster-max-24:gap-y-1 session-roster-max-24:gap-x-2 session-roster-max-24:[&_h3]:col-start-1 session-roster-max-24:[&_h3]:row-start-1 session-roster-max-24:[&>button]:col-start-2 session-roster-max-24:[&>button]:row-start-1 session-roster-max-24:[&>button]:row-span-2">
                  <h3>
                    {(team === 0 || team === 1) && (
                      <span
                        className="team-indicator w-0.75 h-3.5 shrink-0 rounded-sm bg-info [.team-1_&]:bg-[oklch(from_var(--info)_l_c_25)]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="team-name shrink-0 whitespace-nowrap">{label}</span>{' '}
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
                  <div className="team-rating flex items-center gap-2 text-[0.75rem] text-muted-foreground whitespace-nowrap session-roster-max-24:col-start-1 session-roster-max-24:row-start-2">
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
                    aria-label={t('copy') + ' ' + label}
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
                      className="player-card min-w-0 relative min-h-(--session-player-height) flex-nowrap py-(--session-player-padding) [border-block-width:var(--session-player-border)] [&>[data-slot='item-content']]:relative [&>[data-slot='item-content']]:pointer-events-none [&>[data-slot='item-content']]:min-w-0 [&>[data-slot='item-actions']]:relative [&>[data-slot='item-actions']]:pointer-events-none"
                      key={p.id}
                    >
                      <PrimitiveButton
                        type="button"
                        variant="ghost"
                        className="player-card-trigger absolute inset-0 size-full rounded-[inherit]"
                        aria-label={p.name}
                        aria-haspopup="dialog"
                        onClick={() => openModal({ type: 'profile', id: p.id, name: p.name })}
                      />
                      <ItemContent>
                        <div className="player-identity min-w-0 flex flex-col gap-0.5">
                          <div className="player-heading flex items-center gap-1 min-w-0 flex-wrap">
                            <span className="player-name block max-w-full whitespace-normal wrap-anywhere min-w-0 font-medium text-primary">
                              {p.name}
                            </span>
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
                          <div className="player-meta flex items-center gap-2 text-[0.75rem] text-muted-foreground flex-wrap">
                            <span className="player-id muted text-muted-foreground">#{p.id}</span>
                            <span className="player-analysis muted text-muted-foreground">
                              <span
                                className="player-analysis-placeholder hidden"
                                aria-hidden="true"
                              >
                                {t('recentWinRate')} 100% · {t('latestKd')} 999.99
                              </span>
                              <span
                                className={
                                  row?.error ? 'player-analysis-error text-destructive' : undefined
                                }
                              >
                                {analysis}
                              </span>
                            </span>
                          </div>
                        </div>
                      </ItemContent>
                      <ItemActions>
                        <span className="player-rating flex flex-col items-end gap-(--session-rating-gap) tabular-nums [&_strong]:text-[1.125rem] [&_strong]:leading-[var(--session-rating-line-height)] [&_strong]:font-semibold [&_small]:leading-[var(--session-rating-label-line-height)] [&_small]:text-muted-foreground">
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
    </div>
  );
  if (standalone) {
    return (
      <section
        className="session-panel flex min-w-0 flex-col gap-(--content-gap) session-roster @container/session-roster"
        aria-label={title}
      >
        {content}
      </section>
    );
  }
  return (
    <Card
      className="session-card session-roster @container/session-roster"
      contentClassName="session-content"
      title={title}
      showHeader={false}
    >
      {content}
    </Card>
  );
}
