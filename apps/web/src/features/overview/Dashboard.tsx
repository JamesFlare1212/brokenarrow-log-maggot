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
  Users,
  Video,
} from 'lucide-react';
import type { Match } from '@ba/contracts';
import { formatDuration, formatMetric, formatTime, outcomeTone } from '@ba/shared';
import { cn } from '@/lib/utils';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Badge, Button, Card, Empty, Loading, Notice } from '../../components/ui';
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
import { ApmPanel } from '../apm/ApmPanel';

function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: ReactNode;
}) {
  return (
    <MetricCard size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>{icon}</CardAction>
      </CardHeader>
      <CardContent className="metric-content flex items-baseline justify-between gap-3">
        <strong className="text-3xl font-semibold tracking-tight tabular-nums">{value}</strong>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </MetricCard>
  );
}

export function Dashboard() {
  const { api, state, setPage, openModal } = useApp(),
    { t, locale } = useI18n();
  const { data, pending, error, load } = useRequest<Match[]>();
  useEffect(() => {
    void load(() => api.invoke('matches.list', {}), true);
  }, [api, state.matchesRevision, load]);
  const all = [...(data || [])].sort(
    (a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0),
  );
  const personal = all.filter(
    (match) => state.session.localPlayerId && match.localPlayerId === state.session.localPlayerId,
  );
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
  const roster = state.session.current?.players ?? state.session.lobbyPlayers;
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
    <div className="dashboard">
      <div className="metrics-grid" aria-label={t('sessionOverview')}>
        <Metric
          label={t('recentRating')}
          value={formatMetric(latest?.eloAfter ?? null, 0)}
          detail={t('completedMatch')}
          icon={<Crosshair size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('recentWinRate')}
          value={recent.length ? `${Math.round((wins / recent.length) * 100)}%` : '—'}
          detail={
            recent.length ? t('winLossCount', { wins, losses: recent.length - wins }) : t('empty')
          }
          icon={<Trophy size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('archiveCount')}
          value={data === null ? '—' : all.length}
          detail={t('localArchive')}
          icon={<Archive size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('livePlayers')}
          value={roster.length}
          detail={t(state.session.phase === 'match' ? 'liveMatch' : 'waiting')}
          icon={<Users size={16} aria-hidden="true" />}
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
      <SessionPanel />
      <div className="dashboard-grid">
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
          {pending && !data ? (
            <Loading />
          ) : all.length ? (
            <ItemGroup className="recent-matches">
              {all.slice(0, 3).map((match) => (
                <Item size="sm" asChild key={match.id}>
                  <Button
                    variant="ghost"
                    className="recent-match h-auto w-full justify-start"
                    disabled={!match.fid}
                    onClick={() => match.fid && openModal({ type: 'match', fid: match.fid })}
                  >
                    <ItemContent>
                      <ItemTitle>{match.map || `#${match.id}`}</ItemTitle>
                      <ItemDescription>
                        {t(match.mode)} · {formatTime(match.endedAt, locale)}
                      </ItemDescription>
                    </ItemContent>
                    <Badge tone={outcomeTone(match.outcome)}>
                      {match.restarted ? t('restarted') : t(match.outcome)}
                    </Badge>
                    <span
                      className={cn(
                        'recent-elo',
                        match.eloAfter !== null &&
                          match.eloBefore !== null &&
                          (match.eloAfter >= match.eloBefore ? 'text-success' : 'text-danger'),
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
        <aside className="dashboard-side" aria-label={t('quickTools')}>
          <Card title={t('quickTools')} className="quick-tools" contentClassName="gap-2">
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
      {state.config.inputHookEnabled && state.config.panelOrder.includes('apm') && <ApmPanel />}
    </div>
  );
}
