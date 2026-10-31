import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Play,
  RefreshCw,
  Shield,
  Swords,
  Trophy,
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  matchMetricGroups,
  matchMetricLabels,
  playerMetric,
  type MatchMetricGroup,
} from './detail-model';

export function MatchDetails({
  matchId,
  summary,
  onBack,
  onPrevious,
  onNext,
  position,
  total,
}: {
  matchId: string;
  summary?: Match;
  onBack?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  position?: number;
  total?: number;
}) {
  const { api, state, openModal, notify } = useApp();
  const { t, locale } = useI18n();
  const request = useRequest<Match>();
  const replayRequest = useRequest<Replay[]>();
  const [group, setGroup] = useState<MatchMetricGroup>('core');
  const [expanded, setExpanded] = useState<string | null>(null);
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
  useEffect(() => {
    if (onBack) heading.current?.focus({ preventScroll: true });
  }, [matchId]);
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
  const outcome = match?.outcome ?? 'unknown';
  const resultLabel = match?.restarted
    ? t('restarted')
    : t(
        outcome === 'win'
          ? 'matchVictory'
          : outcome === 'loss'
            ? 'matchDefeat'
            : localOnly && outcome === 'unknown'
              ? 'matchUnrecorded'
              : outcome,
      );
  const personalMetrics = [
    'destructionScore',
    'lossesScore',
    'dlRatio',
    'objectivesCaptured',
  ] as const;
  return (
    <div className="match-details">
      <div className="match-detail-toolbar">
        {onBack && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            {t('archive')}
          </Button>
        )}
        <div className="match-detail-navigation">
          {position !== undefined && total !== undefined && (
            <span className="muted">{position > 0 ? `${position} / ${total}` : '—'}</span>
          )}
          {onBack && (
            <>
              <TooltipButton
                variant="ghost"
                size="icon-sm"
                aria-label={t('matchPrevious')}
                disabled={!onPrevious}
                onClick={onPrevious}
              >
                <ChevronLeft aria-hidden="true" />
              </TooltipButton>
              <TooltipButton
                variant="ghost"
                size="icon-sm"
                aria-label={t('matchNext')}
                disabled={!onNext}
                onClick={onNext}
              >
                <ChevronRight aria-hidden="true" />
              </TooltipButton>
            </>
          )}
          <TooltipButton
            variant="ghost"
            size="icon-sm"
            aria-label={t('refresh')}
            disabled={localOnly || request.pending || replayRequest.pending}
            tooltip={localOnly ? t('matchLocalOnlyHint') : t('refresh')}
            aria-busy={request.pending || replayRequest.pending}
            onClick={refresh}
          >
            <RefreshCw className={cn(request.pending && 'animate-spin')} aria-hidden="true" />
          </TooltipButton>
        </div>
      </div>
      {request.pending && <LoadingStatus />}
      {request.error && <Notice error>{request.error}</Notice>}
      {match?.warning && <Notice>{match.warning}</Notice>}
      {localOnly && <Notice>{t('matchLocalOnlyHint')}</Notice>}
      <div className="match-overview">
        <div className="match-overview-heading">
          <div className="match-identity">
            <div className="match-kicker">
              {t('matchDetail')}
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
            <h2 ref={heading} tabIndex={-1}>
              {!match && loading ? <Skeleton className="h-8 w-56" /> : match?.map || '—'}
            </h2>
            <div className="match-metadata">
              <Badge variant="secondary">
                {match
                  ? t(localOnly && match.mode === 'unknown' ? 'matchUnrecorded' : match.mode)
                  : '—'}
              </Badge>
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
          <div className="match-outcome">
            <Badge
              variant={
                outcome === 'win' ? 'success' : outcome === 'loss' ? 'destructive' : 'secondary'
              }
            >
              {outcome === 'win' ? <Trophy aria-hidden="true" /> : <Shield aria-hidden="true" />}
              {resultLabel}
            </Badge>
            <strong className={eloChangeClass(delta)}>
              {delta === null && loading ? <Skeleton className="h-9 w-24" /> : formatDelta(delta)}
              <span>ELO</span>
            </strong>
            <span className="muted">
              {match?.localPersona || local?.name || '—'}
              {participant && ` · ${teamLabel(participant.teamId)}`}
            </span>
          </div>
        </div>
        <div className="match-detail-actions">
          {replayRequest.data?.map((replay, index) => (
            <Button
              variant={index === 0 ? 'default' : 'outline'}
              key={replay.id}
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
            disabled={!canOpenBatrace}
            onClick={() =>
              void api
                .invoke('external.open', { url: `${BATRACE_ORIGIN}/match/${remoteFid}` })
                .catch((error) => notify(errorMessage(error), true))
            }
          >
            {t('openBatrace')}
            <ExternalLink data-icon="inline-end" aria-hidden="true" />
          </Button>
          {replayRequest.data && (
            <span className="muted match-replay-caption">
              {t(
                localOnly
                  ? 'matchLocalReplayUnavailable'
                  : replayRequest.data.length
                    ? 'matchReplayCount'
                    : 'matchNoReplay',
                {
                  count: replayRequest.data.length,
                },
              )}
            </span>
          )}
        </div>
        {replayRequest.error && (
          <Notice error>
            {t('matchReplayError')}: {replayRequest.error}
          </Notice>
        )}
        {(participant ||
          (!match && loading) ||
          (localOnly && match && (match.points !== null || match.localDeck))) && (
          <Card size="sm" className="match-personal-card">
            <CardHeader>
              <CardTitle>
                <span className="match-personal-title">
                  <Swords aria-hidden="true" />
                  {t('matchYourPerformance')}
                  <span className="muted">{participant?.name}</span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="match-summary">
                {localOnly ? (
                  <>
                    <div>
                      <dt>{t('matchLogPoints')}</dt>
                      <dd>{formatMetric(match?.points ?? null)}</dd>
                    </div>
                    <div>
                      <dt>{t('matchLocalDeck')}</dt>
                      <dd>{match?.localDeck || t('matchUnrecorded')}</dd>
                    </div>
                  </>
                ) : (
                  personalMetrics.map((metric) => (
                    <div key={metric}>
                      <dt>{t(matchMetricLabels[metric])}</dt>
                      <dd>
                        {!participant || (loading && participant[metric] === null) ? (
                          <Skeleton className="h-7 w-16" />
                        ) : (
                          playerMetric(participant, metric)
                        )}
                      </dd>
                    </div>
                  ))
                )}
              </dl>
            </CardContent>
          </Card>
        )}
      </div>
      <section className="match-players" aria-label={t('matchScoreboard')}>
        <div className="match-section-heading">
          <h3>
            {t('matchScoreboard')}{' '}
            <span className="muted">{match && t('playersCount', { n: match.players.length })}</span>
          </h3>
          <span className="muted">{t('matchExpandHint')}</span>
        </div>
        <Tabs value={group} onValueChange={(value) => setGroup(value as MatchMetricGroup)}>
          <TabsList variant="line" aria-label={t('matchMetricGroup')}>
            {(Object.keys(matchMetricGroups) as MatchMetricGroup[]).map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`matchMetrics.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {(Object.keys(matchMetricGroups) as MatchMetricGroup[]).map((value) => (
            <TabsContent key={value} value={value}>
              {match?.players.length || loading ? (
                <MatchScoreboard
                  match={match}
                  titles={titles}
                  group={value}
                  loading={loading}
                  expanded={expanded}
                  onExpand={setExpanded}
                />
              ) : (
                <Empty>{t('noMatchStatistics')}</Empty>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </section>
      <div className="match-detail-footnote">
        <span>{t('matchRatioHint')}</span>
        <span>{t('matchMissingHint')}</span>
      </div>
    </div>
  );
}
