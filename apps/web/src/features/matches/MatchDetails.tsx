import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Play,
  RefreshCw,
} from 'lucide-react';
import { BATRACE_ORIGIN, type Match, type Replay } from '@ba/contracts';
import {
  errorMessage,
  formatDelta,
  formatDuration,
  formatMetric,
  formatTime,
  matchTitles,
  teamLabel,
} from '@ba/shared';
import { createPortal } from 'react-dom';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipButton } from '../../components/Tooltip';
import { Empty, Notice } from '../../components/ui';
import { LoadingStatus } from '../../components/LoadingState';
import { useApp } from '../../app/state';
import { useRequest } from '../../hooks/useRequest';
import { useI18n } from '../../hooks/useI18n';
import { cn } from '@/lib/utils';
import { eloChangeClass } from '@/lib/elo';
import { MatchScoreboard } from './MatchScoreboard';
import { MatchTimeline } from './MatchTimeline';
import { matchMetricGroups, type MatchMetricGroup } from './detail-model';

export function MatchDetails({
  matchId,
  summary,
  actionsHost,
  onPrevious,
  onNext,
  position,
  total,
  renderDialog,
}: {
  matchId: string;
  summary?: Match;
  actionsHost?: HTMLElement | null;
  onPrevious?: () => void;
  onNext?: () => void;
  position?: number;
  total?: number;
  renderDialog?: (content: ReactNode, actions: ReactNode) => ReactNode;
}) {
  const { api, access, state, openModal, notify } = useApp();
  const { t, locale } = useI18n();
  const request = useRequest<Match>();
  const replayRequest = useRequest<Replay[]>();
  const [view, setView] = useState<MatchMetricGroup | 'timeline'>('core');
  const [timelineRefresh, setTimelineRefresh] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const togglePlayer = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const heading = useRef<HTMLHeadingElement>(null);
  const localRequest = !/^\d+$/.test(matchId);
  useEffect(() => {
    void request.load(() =>
      localRequest
        ? api.invoke('matches.local', { id: matchId })
        : api.invoke('matches.detail', { fid: matchId, force: false }),
    );
  }, [api, matchId, localRequest, request.load]);
  useEffect(() => {
    void replayRequest.load(
      async () =>
        localRequest
          ? []
          : (await api.invoke('replays.list', null)).filter((replay) => replay.fid === matchId),
      true,
    );
  }, [api, matchId, localRequest, state.replaysRevision, replayRequest.load]);
  const archivePage = !renderDialog;
  useEffect(() => {
    if (archivePage) heading.current?.focus({ preventScroll: true });
  }, [archivePage, matchId]);
  const match = request.data ?? summary ?? null;
  const localOnly = match ? !match.fid : localRequest;
  const remoteFid = match?.fid || (!localRequest ? matchId : null);
  const canOpenBatrace = !localOnly && !!remoteFid && match?.mode !== 'pve';
  const loading = !request.data && (request.pending || !request.error);
  const local = match?.players.find((player) => player.id === match.localPlayerId);
  const participant = local && (local.teamId === 0 || local.teamId === 1) ? local : null;
  const titles = useMemo(() => (match ? (match.titles ?? matchTitles(match)) : {}), [match]);
  const delta =
    match && match.eloBefore !== null && match.eloAfter !== null
      ? match.eloAfter - match.eloBefore
      : null;
  const refresh = () => {
    if (localOnly) return;
    setTimelineRefresh((version) => version + 1);
    void request.load(() => api.invoke('matches.detail', { fid: remoteFid!, force: true }), true);
    void replayRequest.load(
      async () =>
        (await api.invoke('replays.list', null)).filter((replay) => replay.fid === remoteFid),
      true,
    );
  };
  const copyId = async () => {
    try {
      if (!remoteFid) return;
      await navigator.clipboard.writeText(remoteFid);
      notify(t('copied'));
    } catch (error) {
      notify(errorMessage(error), true);
    }
  };
  const refreshLabel = t(archivePage ? 'matchRefreshCurrent' : 'refresh');
  const refreshAction = (
    <TooltipButton
      variant="ghost"
      size="icon"
      aria-label={refreshLabel}
      disabled={localOnly || request.pending || replayRequest.pending}
      tooltip={localOnly ? t('matchLocalOnlyHint') : refreshLabel}
      aria-busy={request.pending || replayRequest.pending}
      onClick={refresh}
    >
      <RefreshCw className={cn(request.pending && 'animate-spin')} aria-hidden="true" />
    </TooltipButton>
  );
  const content = (
    <div className="match-details [.match-detail-page>&]:py-6 @container/match-detail flex flex-col gap-5 w-full max-w-384 mx-auto viewport-max-767:[.match-detail-page>&]:py-5">
      {request.pending && <LoadingStatus />}
      {request.error && <Notice error>{request.error}</Notice>}
      {match?.warning && (
        <Notice>
          {match.warning === 'Cached match data; BATrace is unavailable'
            ? t('matchCachedWarning')
            : match.warning}
        </Notice>
      )}
      {localOnly && <Notice>{t('matchLocalOnlyHint')}</Notice>}
      <div className="match-overview flex justify-between items-start gap-4">
        <div className="match-identity min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2
              ref={heading}
              tabIndex={-1}
              className="min-w-0 text-[1.75rem] font-semibold leading-tight wrap-anywhere match-detail-max-36:text-[1.375rem]"
            >
              {!match && loading ? <Skeleton className="h-8 w-48 max-w-full" /> : match?.map || '—'}
            </h2>
            <div className="flex items-center gap-1 text-muted-foreground text-xs">
              {localOnly ? (
                <Badge variant="outline">{t('matchLocalOnly')}</Badge>
              ) : (
                <>
                  <span>#{remoteFid}</span>
                  <TooltipButton
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('matchCopyId')}
                    onClick={() => void copyId()}
                  >
                    <Copy aria-hidden="true" />
                  </TooltipButton>
                </>
              )}
            </div>
          </div>
          <div className="match-metadata flex items-center gap-3 text-muted-foreground text-[0.75rem] flex-wrap mt-1.5 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1 [&_svg]:w-3.5 [&_svg]:h-3.5">
            <Badge variant="secondary">
              {match
                ? t(localOnly && match.mode === 'unknown' ? 'matchUnrecorded' : match.mode)
                : '—'}
            </Badge>
            {localOnly && match?.points != null && (
              <span>
                {t('matchLogPoints')} <span>{formatMetric(match.points)}</span>
              </span>
            )}
            {localOnly && match?.localDeck && (
              <span>
                {t('matchLocalDeck')} <span className="wrap-anywhere">{match.localDeck}</span>
              </span>
            )}
            {match?.restarted ? (
              <span>{t('restarted')}</span>
            ) : match?.outcome === 'spectator' ? (
              <span>{t('spectator')}</span>
            ) : null}
            <span>
              <Clock3 aria-hidden="true" />
              {!match && loading ? (
                <Skeleton className="h-4 w-12" />
              ) : (
                formatDuration(match?.durationSec ?? null)
              )}
            </span>
            <span>
              {!match && loading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                formatTime(match?.endedAt ?? match?.startedAt ?? null, locale)
              )}
            </span>
          </div>
        </div>
        <div className="match-outcome flex min-w-0 max-w-[45%] flex-col text-right wrap-anywhere items-end gap-1.5 [&>strong]:flex [&>strong]:items-baseline [&>strong]:gap-1.5 [&>strong]:text-[1.875rem] [&>strong]:font-semibold [&>strong]:tabular-nums [&>span]:text-[0.75rem] [&_strong>span]:text-[0.75rem] [&_strong>span]:text-muted-foreground [&_strong>span]:font-normal">
          <strong className={eloChangeClass(delta)}>
            {delta === null && loading ? <Skeleton className="h-9 w-24" /> : formatDelta(delta)}
            <span>ELO</span>
          </strong>
          <span className="muted text-muted-foreground">
            {match?.localPersona || local?.name || '—'}
            {participant && ` · ${teamLabel(participant.teamId)}`}
          </span>
        </div>
      </div>
      <Tabs
        value={view}
        onValueChange={(value) => setView(value as typeof view)}
        className="min-w-0 gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 max-w-full overflow-x-auto py-1">
            <TabsList
              variant="line"
              aria-label={t('matchDetailView')}
              data-testid="match-detail-views"
            >
              {(Object.keys(matchMetricGroups) as MatchMetricGroup[]).map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(`matchMetrics.${value}`)}
                </TabsTrigger>
              ))}
              <TabsTrigger value="timeline" className="ms-2">
                {t('matchTimeline')}
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="match-detail-actions ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
            {replayRequest.data?.map((replay, index) => (
              <Button
                variant={index === 0 ? 'default' : 'outline'}
                key={replay.id}
                disabled={!access.method('replays.play')}
                onClick={() =>
                  openModal({
                    type: 'replay',
                    id: replay.id,
                    title: replay.uploaderName || replay.map,
                  })
                }
              >
                <Play data-icon="inline-start" aria-hidden="true" />
                {t('matchWatchReplay')}
                {replayRequest.data!.length > 1 &&
                  ` · ${replay.uploaderName || teamLabel(replay.teamId)}`}
              </Button>
            ))}
            {!replayRequest.data && replayRequest.pending && <Skeleton className="h-8 w-28" />}
            <Button
              variant="outline"
              aria-label={t('openBatrace')}
              className="@max-[38rem]/match-detail:size-(--control-standard) @max-[38rem]/match-detail:p-0"
              disabled={!canOpenBatrace || !access.method('external.open')}
              onClick={() =>
                void api
                  .invoke('external.open', { url: `${BATRACE_ORIGIN}/match/${remoteFid}` })
                  .catch((error) => notify(errorMessage(error), true))
              }
            >
              <span aria-hidden="true" className="@max-[38rem]/match-detail:hidden">
                BATrace
              </span>
              <ExternalLink aria-hidden="true" />
            </Button>
          </div>
        </div>
        {replayRequest.error && (
          <Notice error>
            {t('matchReplayError')}: {replayRequest.error}
          </Notice>
        )}
        {(Object.keys(matchMetricGroups) as MatchMetricGroup[]).map((value) => (
          <TabsContent key={value} value={value} className="min-w-0">
            <section className="match-players" aria-label={t('matchScoreboard')}>
              {match?.players.length || loading ? (
                <MatchScoreboard
                  match={match}
                  titles={titles}
                  group={value}
                  loading={loading}
                  expanded={expanded}
                  onTogglePlayer={togglePlayer}
                />
              ) : (
                <Empty>{t('noMatchStatistics')}</Empty>
              )}
            </section>
          </TabsContent>
        ))}
        <TabsContent value="timeline" className="min-w-0">
          <MatchTimeline
            key={matchId}
            fid={localRequest ? null : matchId}
            mode={match?.fid === matchId ? match.mode : undefined}
            refreshVersion={timelineRefresh}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
  if (renderDialog) return renderDialog(content, refreshAction);
  return (
    <>
      {actionsHost &&
        createPortal(
          <>
            <div
              role="group"
              aria-label={t('matchDetail')}
              className="match-detail-navigation flex shrink-0 items-center gap-1 @max-[24rem]/topbar:gap-0"
            >
              {position !== undefined && total !== undefined && (
                <span className="mr-1 text-xs text-muted-foreground tabular-nums whitespace-nowrap @max-[23rem]/topbar:sr-only">
                  {position > 0 ? `${position} / ${total}` : '—'}
                </span>
              )}
              <TooltipButton
                variant="ghost"
                size="icon"
                aria-label={t('matchPrevious')}
                disabled={!onPrevious}
                onClick={onPrevious}
              >
                <ChevronLeft aria-hidden="true" />
              </TooltipButton>
              <TooltipButton
                variant="ghost"
                size="icon"
                aria-label={t('matchNext')}
                disabled={!onNext}
                onClick={onNext}
              >
                <ChevronRight aria-hidden="true" />
              </TooltipButton>
              {refreshAction}
            </div>
            <Separator
              orientation="vertical"
              className="ml-2 data-vertical:h-4 data-vertical:self-center @max-[24rem]/topbar:ml-1"
            />
          </>,
          actionsHost,
        )}
      {content}
    </>
  );
}
