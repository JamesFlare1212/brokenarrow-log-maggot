import { useEffect, type ReactNode } from 'react';
import {
  ArrowRight,
  Archive,
  Crosshair,
  Layers,
  Search,
  Settings,
  ShieldCheck,
  Trophy,
  Video,
} from 'lucide-react';
import type { Match } from '@ba/contracts';
import { formatDuration, formatMetric, formatTime } from '@ba/shared';
import { cn } from '@/lib/utils';
import { eloChangeClass } from '@/lib/elo';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Card, Empty, Notice } from '../../components/ui';
import { LoadingStatus, ListSkeletonRows } from '../../components/LoadingState';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card as MetricCard,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { SessionPanel } from '../session/SessionPanel';

function Metric({
  label,
  value,
  detail,
  icon,
  pending = false,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: ReactNode;
  pending?: boolean;
}) {
  return (
    <MetricCard size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>{icon}</CardAction>
      </CardHeader>
      <CardContent className="metric-content [&>strong]:shrink-0 [&>strong]:whitespace-nowrap viewport-max-479:flex-col viewport-max-479:items-start viewport-max-479:gap-1 flex items-baseline justify-between gap-3">
        <strong className="text-3xl font-semibold tracking-tight tabular-nums" aria-busy={pending}>
          {pending ? <Skeleton className="h-9 w-20" aria-hidden="true" /> : value}
        </strong>
        <div className="metric-detail whitespace-nowrap metric-max-16:hidden text-xs text-muted-foreground">
          {pending ? <Skeleton className="h-4 w-20" aria-hidden="true" /> : detail}
        </div>
      </CardContent>
    </MetricCard>
  );
}

export function Dashboard() {
  const { api, state, setPage, openModal } = useApp(),
    { t, locale } = useI18n();
  const { data, pending, error, load } = useRequest<Match[]>();
  const {
    data: replayCount,
    pending: replaysPending,
    error: replaysError,
    load: loadReplayCount,
  } = useRequest<number>();
  useEffect(() => {
    void load(() => api.invoke('matches.list', {}), true);
  }, [api, state.matchesRevision, load]);
  const fetchReplayCount = () => api.invoke('replays.directory', null).then(({ count }) => count);
  useEffect(() => {
    void loadReplayCount(fetchReplayCount, true);
  }, [api, state.replaysRevision, state.config.replaySaveDir, loadReplayCount]);
  const all = [...(data || [])].sort(
    (a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0),
  );
  const loading = !data && (pending || !error);
  const accountId = state.session.localPlayerId ?? state.activeAccountId;
  const personal = all.filter((match) => accountId && match.localPlayerId === accountId);
  const recent = personal
    .filter(
      (match) =>
        match.endedAt !== null &&
        !match.restarted &&
        (match.outcome === 'win' || match.outcome === 'loss'),
    )
    .slice(0, 12);
  const wins = recent.filter((match) => match.outcome === 'win').length;
  const latest = personal.find((match) => match.endedAt !== null && match.eloAfter !== null);
  const recording = state.recording;
  const recordingActive = recording.phase === 'recording';
  const recordingLabel = recordingActive
    ? 'recording'
    : recording.phase === 'starting'
      ? 'starting'
      : recording.phase === 'stopping'
        ? 'stopping'
        : state.config.replayEnabled
          ? 'recordingReady'
          : 'recordingOff';
  return (
    <div className="dashboard flex min-w-0 flex-col gap-(--content-gap)">
      {loading && <LoadingStatus />}
      <div
        className="metrics-grid grid grid-cols-4 gap-(--content-gap) [&>[data-slot='card']]:@container/metric [&>[data-slot='card']]:min-w-0 viewport-max-767:grid-cols-2 workspace-max-36:grid-cols-2"
        aria-label={t('sessionOverview')}
      >
        <Metric
          label={t('recentRating')}
          pending={loading}
          value={formatMetric(latest?.eloAfter ?? null, 0)}
          detail={t('completedMatch')}
          icon={<Crosshair size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('recentWinRate')}
          pending={loading}
          value={recent.length ? `${Math.round((wins / recent.length) * 100)}%` : '—'}
          detail={
            recent.length ? t('winLossCount', { wins, losses: recent.length - wins }) : t('empty')
          }
          icon={<Trophy size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('archiveCount')}
          pending={loading}
          value={data === null ? '—' : all.length}
          detail={t('localArchive')}
          icon={<Archive size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('replays')}
          pending={replayCount === null && (replaysPending || !replaysError)}
          value={replayCount ?? '—'}
          detail={t('recordingLibrary')}
          icon={<Video size={16} aria-hidden="true" />}
        />
      </div>
      {error && (
        <Notice error>
          {error}
          <Button onClick={() => void load(() => api.invoke('matches.list', {}), true)}>
            {t('retry')}
          </Button>
        </Notice>
      )}
      {replaysError && (
        <Notice error>
          {replaysError}
          <Button onClick={() => void loadReplayCount(fetchReplayCount, true)}>{t('retry')}</Button>
        </Notice>
      )}
      <SessionPanel />
      <div className="dashboard-grid grid grid-cols-[minmax(0,_1.7fr)_minmax(17rem,_1fr)] items-stretch gap-(--content-gap) workspace-max-48:grid-cols-1">
        <Card
          title={t('recent')}
          icon={<Archive />}
          className="recent-card"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setPage('archive')}>
              {t('viewAll')}
              <ArrowRight data-icon="inline-end" />
            </Button>
          }
        >
          {loading ? (
            <ListSkeletonRows
              className="recent-matches gap-1 has-data-[size=sm]:gap-1 has-data-[size=xs]:gap-1"
              rowClassName="recent-match-loading min-h-17 py-2.5 px-3"
            />
          ) : all.length ? (
            <ItemGroup className="recent-matches gap-1 has-data-[size=sm]:gap-1 has-data-[size=xs]:gap-1">
              {all.slice(0, 3).map((match) => (
                <Item size="sm" asChild key={match.id}>
                  <Button
                    variant="ghost"
                    className="recent-match min-h-17 [&_[data-slot='item-content']]:min-w-0 viewport-max-479:[&>[data-slot='item-media']]:hidden h-auto w-full justify-start"
                    onClick={() => openModal({ type: 'match', fid: match.fid || match.id })}
                  >
                    <ItemContent>
                      <ItemTitle>{match.map || `#${match.id}`}</ItemTitle>
                      <ItemDescription>
                        {t(match.mode)} · {formatTime(match.endedAt, locale)}
                      </ItemDescription>
                    </ItemContent>
                    <span
                      className={cn(
                        'recent-elo w-20 shrink-0 text-right tabular-nums viewport-max-479:w-16',
                        eloChangeClass(
                          match.eloAfter !== null && match.eloBefore !== null
                            ? match.eloAfter - match.eloBefore
                            : null,
                        ),
                      )}
                    >
                      {match.eloAfter !== null && match.eloBefore !== null
                        ? `${match.eloAfter - match.eloBefore > 0 ? '+' : ''}${formatMetric(match.eloAfter - match.eloBefore, 0)}`
                        : '—'}{' '}
                      <small>ELO</small>
                    </span>
                  </Button>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <Empty icon={<Archive />} description={t('noMatchesHint')}>
              {t('empty')}
            </Empty>
          )}
        </Card>
        <aside
          className="dashboard-side flex min-w-0 flex-col gap-(--content-gap)"
          aria-label={t('quickTools')}
        >
          <Card
            title={t('quickTools')}
            showHeader={false}
            className="quick-tools [.dashboard-side>&]:flex-1 [&_[data-slot='item-group']]:gap-0.5"
            contentClassName="gap-2"
          >
            <Item size="xs">
              <ItemMedia variant="icon">
                <Video />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t('replays')}</ItemTitle>
                <ItemDescription>
                  {t(recordingLabel)}
                  {recordingActive && <> · {formatDuration(recording.seconds)}</>}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t(
                    state.config.replayEnabled ? 'recordingSettings' : 'enableRecording',
                  )}
                  onClick={() =>
                    openModal({ type: 'recordingSettings', enable: !state.config.replayEnabled })
                  }
                >
                  <Settings />
                </Button>
              </ItemActions>
            </Item>
            {recording.error && <Notice error>{recording.error}</Notice>}
            <Separator />
            <ItemGroup>
              {(
                [
                  { page: 'players', icon: Search, hint: 'playerShortcut' },
                  { page: 'decks', icon: Layers, hint: 'deckShortcut' },
                  { page: 'bans', icon: ShieldCheck, hint: 'banShortcut' },
                ] as const
              ).map(({ page, icon: ToolIcon, hint }) => (
                <Item size="xs" asChild key={page}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start"
                    onClick={() => setPage(page)}
                  >
                    <ItemMedia variant="icon">
                      <ToolIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t(page)}</ItemTitle>
                      <ItemDescription>{t(hint)}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ArrowRight />
                    </ItemActions>
                  </Button>
                </Item>
              ))}
            </ItemGroup>
          </Card>
        </aside>
      </div>
    </div>
  );
}
