import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowRight, Archive, Crosshair, Trophy, Users } from 'lucide-react';
import type { Match } from '@ba/contracts';
import { formatMetric, formatTime } from '@ba/shared';
import { cn } from '@/lib/utils';
import { eloChangeClass } from '@/lib/elo';
import { useApp } from '../../app/state';
import { OverviewQuickTools } from './OverviewQuickTools';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Card, Empty, Loading, Notice } from '../../components/ui';
import {
  Card as MetricCard,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { SessionPanel } from '../session/SessionPanel';

interface ArchiveSnapshot {
  revision: number;
  rows: Match[];
}
interface PersonalSnapshot extends ArchiveSnapshot {
  accountId: string;
  context: number;
}

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
  const archiveRequest = useRequest<ArchiveSnapshot>();
  const archiveOwner = useRef<number | null>(null);
  const accountId = state.session.localPlayerId ?? null;
  const accountName = state.session.localName || accountId || t('unknown');
  const personalRequest = useRequest<PersonalSnapshot>();
  const personalKey = accountId
    ? `${accountId}:${state.matchesRevision}:${state.accountContextRevision}`
    : null;
  const personalOwner = useRef<string | null>(null);
  const scopeLabel = useRef<HTMLParagraphElement>(null);
  const focusedHistoryControl = useRef<HTMLElement | null>(null);
  const loadArchive = () => {
    const revision = state.matchesRevision;
    archiveOwner.current = revision;
    return archiveRequest.load(
      async () => ({ revision, rows: await api.invoke('matches.list', {}) }),
      true,
    );
  };
  const loadPersonal = () => {
    if (!accountId) {
      personalOwner.current = null;
      personalRequest.invalidate();
      return;
    }
    personalOwner.current = personalKey;
    const revision = state.matchesRevision,
      context = state.accountContextRevision;
    return personalRequest.load(async () => {
      const rows = await api.invoke('matches.list', { accountId });
      if (rows.some((match) => match.localPlayerId !== accountId))
        throw new Error(t('perspectiveUnavailable'));
      return { accountId, revision, context, rows };
    }, true);
  };
  useEffect(() => {
    void loadArchive();
  }, [api, state.matchesRevision, archiveRequest.load]);
  useEffect(() => {
    void loadPersonal();
  }, [api, accountId, state.matchesRevision, state.accountContextRevision]);
  const data =
    archiveRequest.data?.revision === state.matchesRevision ? archiveRequest.data.rows : null;
  const error = archiveOwner.current === state.matchesRevision ? archiveRequest.error : null;
  const personalAvailable =
    personalRequest.data?.accountId === accountId &&
    personalRequest.data?.revision === state.matchesRevision &&
    personalRequest.data?.context === state.accountContextRevision;
  const all = [...(data ?? [])].sort(
    (a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0),
  );
  const personal = [...(personalAvailable ? personalRequest.data!.rows : [])].sort(
    (a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0),
  );
  const personalError = personalOwner.current === personalKey ? personalRequest.error : null;
  const personalLoading =
    !!accountId &&
    !personalError &&
    (personalOwner.current !== personalKey || personalRequest.pending || !personalAvailable);
  useLayoutEffect(() => {
    if (
      focusedHistoryControl.current &&
      !focusedHistoryControl.current.isConnected &&
      document.activeElement === document.body
    ) {
      scopeLabel.current?.focus({ preventScroll: true });
      scopeLabel.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'instant',
      });
      focusedHistoryControl.current = null;
    }
  });
  const recent = personal
    .filter(
      (match) =>
        match.endedAt !== null &&
        !match.restarted &&
        (match.outcome === 'win' || match.outcome === 'loss'),
    )
    .slice(0, 12);
  const wins = recent.filter((match) => match.outcome === 'win').length;
  const latest = personal.find((match) => match.endedAt !== null);
  const roster = state.session.current?.players ?? state.session.lobbyPlayers;
  return (
    <div className="dashboard">
      <OverviewQuickTools />
      <p
        ref={scopeLabel}
        tabIndex={-1}
        role="status"
        className="text-sm text-muted-foreground wrap-anywhere"
      >
        {accountId
          ? t('accountScope', { name: accountName, id: accountId })
          : t('accountIdentityNeeded')}
      </p>
      <div className="metrics-grid" aria-label={t('sessionOverview')}>
        <Metric
          label={t('recentRating')}
          value={formatMetric(latest?.eloAfter ?? null, 0)}
          detail={t(
            !accountId
              ? 'accountIdentityNeeded'
              : !personalAvailable
                ? personalError
                  ? 'overviewStatsUnavailable'
                  : 'overviewStatsUpdating'
                : !latest
                  ? 'empty'
                  : latest.eloAfter === null
                    ? 'latestRatingUnavailable'
                    : 'completedMatch',
          )}
          icon={<Crosshair size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('recentWinRate')}
          value={recent.length ? `${Math.round((wins / recent.length) * 100)}%` : '—'}
          detail={
            !accountId
              ? t('accountIdentityNeeded')
              : !personalAvailable
                ? t(personalError ? 'overviewStatsUnavailable' : 'overviewStatsUpdating')
                : recent.length
                  ? t('winLossCount', { wins, losses: recent.length - wins })
                  : t('empty')
          }
          icon={<Trophy size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('archiveCount')}
          value={data === null ? '—' : all.length}
          detail={t(
            data === null
              ? error
                ? 'overviewArchiveUnavailable'
                : 'overviewArchiveUpdating'
              : 'allAccountArchive',
          )}
          icon={<Archive size={16} aria-hidden="true" />}
        />
        <Metric
          label={t('livePlayers')}
          value={roster.length}
          detail={t(
            state.session.phase === 'match'
              ? 'liveMatch'
              : state.session.phase === 'lobby'
                ? 'partyLobby'
                : 'waiting',
          )}
          icon={<Users size={16} aria-hidden="true" />}
        />
      </div>
      {error && (
        <Notice error>
          {error}
          <Button
            onFocus={(event) => {
              focusedHistoryControl.current = event.currentTarget;
            }}
            onClick={() => void loadArchive()}
          >
            {t('retry')}
          </Button>
        </Notice>
      )}
      <SessionPanel />
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
        {!accountId ? (
          <Empty icon={<Archive />}>{t('accountIdentityNeeded')}</Empty>
        ) : personalLoading && !personal.length ? (
          <Loading />
        ) : personalError && !personal.length ? (
          <Notice error>
            {personalError}
            <Button
              onFocus={(event) => {
                focusedHistoryControl.current = event.currentTarget;
              }}
              onClick={() => void loadPersonal()}
            >
              {t('retry')}
            </Button>
          </Notice>
        ) : personal.length ? (
          <ItemGroup className="recent-matches">
            {personalError && (
              <Notice error>
                {personalError}
                <Button
                  onFocus={(event) => {
                    focusedHistoryControl.current = event.currentTarget;
                  }}
                  onClick={() => void loadPersonal()}
                >
                  {t('retry')}
                </Button>
              </Notice>
            )}
            {personal.slice(0, 3).map((match) => (
              <Item size="sm" asChild key={match.id}>
                <Button
                  variant="ghost"
                  className="recent-match h-auto w-full justify-start"
                  disabled={!match.fid}
                  onFocus={(event) => {
                    focusedHistoryControl.current = event.currentTarget;
                  }}
                  onClick={() =>
                    match.fid && openModal({ type: 'match', fid: match.fid, accountId })
                  }
                >
                  <ItemContent>
                    <ItemTitle>{match.map || `#${match.id}`}</ItemTitle>
                    <ItemDescription>
                      {t(match.mode)} · {formatTime(match.endedAt, locale)} ·{' '}
                      {t('accountScope', {
                        name: match.localPersona || accountName,
                        id: accountId,
                      })}
                    </ItemDescription>
                  </ItemContent>
                  <span
                    className={cn(
                      'recent-elo',
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
    </div>
  );
}
