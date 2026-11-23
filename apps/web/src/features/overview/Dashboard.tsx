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
import { formatDuration, formatMetric } from '@ba/shared';
import { RecentMatchTable } from './RecentMatchTable';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Card, Empty, Notice } from '../../components/ui';
import { LoadingStatus } from '../../components/LoadingState';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card as SurfaceCard,
  CardAction,
  CardContent,
  CardDescription,
  CardTitle,
  CardHeader,
} from '@/components/ui/card';
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
    <SurfaceCard size="sm">
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
    </SurfaceCard>
  );
}

export function Dashboard() {
  const { api, state, setPage, openModal } = useApp(),
    { t } = useI18n();
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
          {loading || all.length ? (
            <RecentMatchTable matches={all.slice(0, 3)} loading={loading} />
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
          <SurfaceCard className="quick-tools flex-1">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
                <Video aria-hidden="true" />
                {t('replays')}
              </CardTitle>
              <CardDescription>
                {t(recordingLabel)}
                {recordingActive && <> · {formatDuration(recording.seconds)}</>}
              </CardDescription>
              <CardAction className="self-center">
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
                  <Settings aria-hidden="true" />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              {recording.error && <Notice error>{recording.error}</Notice>}
              <nav
                aria-label={t('quickTools')}
                className="grid flex-1 auto-rows-fr gap-2 border-t border-border pt-3 workspace-max-48:grid-cols-3"
              >
                {(
                  [
                    { page: 'players', icon: Search },
                    { page: 'decks', icon: Layers },
                    { page: 'bans', icon: ShieldCheck },
                  ] as const
                ).map(({ page, icon: ToolIcon }) => (
                  <Button
                    key={page}
                    variant="ghost"
                    className="h-auto min-h-9 min-w-0 justify-start gap-3 px-3 py-2 whitespace-normal workspace-max-48:min-h-16 workspace-max-48:flex-col workspace-max-48:justify-center workspace-max-48:gap-2 workspace-max-48:px-1 workspace-max-48:text-xs"
                    onClick={() => setPage(page)}
                  >
                    <ToolIcon aria-hidden="true" className="text-muted-foreground" />
                    {t(page)}
                  </Button>
                ))}
              </nav>
            </CardContent>
          </SurfaceCard>
        </aside>
      </div>
    </div>
  );
}
