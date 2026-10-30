import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { BATRACE_ORIGIN, isOnlineMatchId } from '@ba/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw as faArrowsRotate } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { Account, Match, ReplayLibrary } from '@ba/contracts';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  formatMetric,
  formatDelta,
  formatDuration,
  formatTime,
  outcomeTone,
  matchTitles,
  errorMessage,
} from '@ba/shared';
import { replayIdentity, formatReplayTime } from '../replays/labels';
import { localizedTeamLabel } from '../../lib/team-label';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Dialog, Loading, Notice, Badge } from '../../components/ui';
import { TooltipButton } from '../../components/Tooltip';
import { MatchAwards } from './MatchAwards';
import { eloChangeClass } from '@/lib/elo';
import { cn } from '@/lib/utils';
export function MatchDialog({ fid, accountId }: { fid: string; accountId?: string | null }) {
  const { api, state, openModal, closeModal, backModal, notify, setMatchAccount } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<{ key: string; match: Match }>(),
    accounts = useRequest<Account[]>(),
    recordingRequest = useRequest<ReplayLibrary>();
  const [selectedAccount, setSelectedAccount] = useState(accountId || '');
  const online = isOnlineMatchId(fid);
  const manualRefresh = useRef(false);
  const requestKey = `${fid}:${selectedAccount}`;
  const requestOwner = useRef('');
  const loadMatch = (force = false) => {
    requestOwner.current = requestKey;
    return request.load(
      async () => ({
        key: requestKey,
        match: await api.invoke('matches.detail', {
          fid,
          force,
          accountId: selectedAccount || null,
        }),
      }),
      true,
    );
  };
  const directory = useRef(state.config.replaySaveDir);
  const loadRecordings = () => recordingRequest.load(() => api.invoke('replays.list', null), true);
  useEffect(() => {
    void loadMatch();
  }, [api, fid, selectedAccount]);
  useEffect(() => {
    if (state.accountsSnapshot) {
      accounts.invalidate();
      accounts.setData(state.accountsSnapshot);
    } else void accounts.load(() => api.invoke('accounts.list', null), true);
  }, [api, state.accountsRevision]);
  useEffect(() => {
    if (directory.current !== state.config.replaySaveDir) {
      directory.current = state.config.replaySaveDir;
      recordingRequest.invalidate();
    }
    void loadRecordings();
  }, [api, fid, state.replaysRevision, state.config.replaySaveDir]);
  const replays =
    recordingRequest.data?.recordings.filter((recording) => recording.fid === fid) ?? [];
  const match = request.data?.key === requestKey ? request.data.match : null;
  const onlineTarget = online ? fid : match?.fid && isOnlineMatchId(match.fid) ? match.fid : null;
  const requestError = requestOwner.current === requestKey ? request.error : null;
  const perspectiveError = requestError?.includes('MATCH_PERSPECTIVE_UNAVAILABLE');
  const eloDelta =
    match && match.eloAfter !== null && match.eloBefore !== null
      ? match.eloAfter - match.eloBefore
      : null;
  const titles = useMemo(() => (match ? (match.titles ?? matchTitles(match)) : {}), [match]);
  const refreshing = request.pending || recordingRequest.pending;
  const columns = [
    'player',
    'ELO',
    'destruction',
    'losses',
    'objectives',
    'kills',
    'damage',
    'received',
    'D/L',
    'supply',
    'experience',
    'medals',
  ];
  return (
    <Dialog
      open
      onClose={closeModal}
      onBack={backModal}
      title={`${t('matchDetail')} · ${online ? '#' + fid : t('localMatch')}`}
      description={online ? undefined : `${t('localMatchDetails')} ${t('matchId')}: #${fid}`}
      className="dialog-wide match-dialog"
      ready={!!(match || requestError) && !!(recordingRequest.data || recordingRequest.error)}
    >
      {!online && (
        <p className="text-sm wrap-anywhere" data-local-match-id="">
          {t('matchId')}: <code>#{fid}</code>
        </p>
      )}
      <div className="grid min-w-0 gap-2 mb-3">
        <label htmlFor="match-perspective" className="text-sm font-medium">
          {t('matchPerspective')}
        </label>
        <NativeSelect
          id="match-perspective"
          className="w-full max-w-full"
          value={selectedAccount}
          onChange={(event) => {
            setSelectedAccount(event.target.value);
            setMatchAccount?.(event.target.value || null);
          }}
        >
          <NativeSelectOption value="">{t('savedPerspective')}</NativeSelectOption>
          {selectedAccount &&
            !(accounts.data ?? []).some((account) => account.id === selectedAccount) && (
              <NativeSelectOption value={selectedAccount}>#{selectedAccount}</NativeSelectOption>
            )}
          {(accounts.data ?? []).map((account) => (
            <NativeSelectOption key={account.id} value={account.id}>
              {account.name || account.persona || account.id} · #{account.id}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-sm text-muted-foreground wrap-anywhere" role="status">
          {match?.localPlayerId
            ? t('accountScope', {
                name: match.localPersona || match.localPlayerId,
                id: match.localPlayerId,
              })
            : selectedAccount
              ? `#${selectedAccount}`
              : t('savedPerspective')}
        </p>
        {accounts.error && (
          <Notice error>
            {accounts.error}
            <Button
              onClick={() => void accounts.load(() => api.invoke('accounts.list', null), true)}
            >
              {t('retry')}
            </Button>
          </Notice>
        )}
      </div>
      <div className="actions match-dialog-actions">
        <Button
          size="sm"
          disabled={online && refreshing}
          aria-disabled={refreshing}
          aria-busy={refreshing}
          onClick={() => {
            if (refreshing || manualRefresh.current) return;
            manualRefresh.current = true;
            void Promise.allSettled([loadMatch(true), loadRecordings()]).finally(() => {
              manualRefresh.current = false;
            });
          }}
        >
          <Icon icon={faArrowsRotate} size={16} spin={request.pending} aria-hidden="true" />
          {t(online ? 'refresh' : 'localMatchRefresh')}
        </Button>
        {onlineTarget && (
          <Button
            size="sm"
            onClick={() =>
              void api
                .invoke('external.open', { url: `${BATRACE_ORIGIN}/match/${onlineTarget}` })
                .catch((error) => notify(errorMessage(error), true))
            }
          >
            {t('openBatrace')}
          </Button>
        )}
        {replays.map((r) => (
          <Button
            key={r.id}
            data-dialog-focus={`replay:${r.id}`}
            size="sm"
            className="h-auto min-h-8 min-w-0 max-w-full whitespace-normal wrap-anywhere"
            aria-label={`${t('play')}: ${replayIdentity(r, locale)}`}
            title={replayIdentity(r, locale)}
            onClick={() => openModal({ type: 'replay', id: r.id, title: r.uploaderName || r.map })}
          >
            {t('play')} · {r.uploaderName || localizedTeamLabel(r.teamId, locale)} ·{' '}
            {formatReplayTime(r.createdAt, locale)} · {formatDuration(r.durationSec)}
          </Button>
        ))}
      </div>
      {recordingRequest.pending && <p role="status">{t('recordingLinksLoading')}</p>}
      {recordingRequest.error && (
        <Notice error>
          <span>
            {t('recordingLinksUnavailable')} {recordingRequest.error}
          </span>
          <Button onClick={() => void loadRecordings()} disabled={recordingRequest.pending}>
            {t('retry')}
          </Button>
        </Notice>
      )}
      {!match && !requestError && <Loading />}
      {requestError && (
        <Notice error>
          {perspectiveError
            ? t('perspectiveUnavailable')
            : requestError.includes('LOCAL_MATCH_UNAVAILABLE')
              ? t('localMatchUnavailable')
              : requestError}
          {!online && match && <p>{t('localMatchRetained')}</p>}
        </Notice>
      )}
      {match && (
        <>
          {!online && (
            <Notice>
              <p>{t('localMatchDetails')}</p>
              {!onlineTarget && <p>{t('localMatchOnlineUnavailable')}</p>}
              <p>{t('localMatchSavedAt', { time: formatTime(match.updatedAt, locale) })}</p>
            </Notice>
          )}
          {(match.warning || match.warningCode) && (
            <Notice>
              {match.warningCode === 'batrace-cache' ||
              match.warning === 'Cached match data; BATrace is unavailable'
                ? t('cachedMatchWarning')
                : match.warning}
            </Notice>
          )}
          <div className="match-overview">
            <div className="match-overview-heading">
              <div className="match-map">
                <span className="muted">{t('map')}</span>
                <h3>{match.map || '—'}</h3>
              </div>
              <div className="match-overview-badges">
                <Badge tone={outcomeTone(match.outcome)}>{t(match.outcome)}</Badge>
                <Badge>{t(match.mode)}</Badge>
              </div>
            </div>
            <dl className="match-summary">
              <div>
                <dt>{t('duration')}</dt>
                <dd>{formatDuration(match.durationSec)}</dd>
              </div>
              <div>
                <dt>{t('eloDelta')}</dt>
                <dd className={eloChangeClass(eloDelta)}>{formatDelta(eloDelta)}</dd>
              </div>
              <div>
                <dt>{t('account')}</dt>
                <dd>{match.localPersona || '—'}</dd>
              </div>
              <div>
                <dt>{t('time')}</dt>
                <dd>{formatTime(match.endedAt, locale)}</dd>
              </div>
            </dl>
          </div>
          {[match.winnerTeamId === 1 ? 1 : 0, match.winnerTeamId === 1 ? 0 : 1, 100, null].map(
            (team) => {
              const players = match.players.filter((p) => p.teamId === team);
              if (!players.length) return null;
              return (
                <section className={`match-team match-team-${team}`} key={String(team)}>
                  <div className="match-team-heading">
                    <h3>{localizedTeamLabel(team as 0 | 1 | 100 | null, locale)}</h3>
                    <span className="muted">{t('playersCount', { n: players.length })}</span>
                  </div>
                  <div className="table-wrap match-team-table">
                    <Table>
                      <TableCaption className="sr-only">
                        {localizedTeamLabel(team as 0 | 1 | 100 | null, locale)}
                      </TableCaption>
                      <colgroup>
                        <col className="match-player-column" />
                        <col className="match-rating-column" />
                        {columns.slice(2).map((column) => (
                          <col key={column} />
                        ))}
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          {columns.map((k) => (
                            <TableHead
                              scope="col"
                              key={k}
                              className={k === 'ELO' ? 'elo-column' : undefined}
                            >
                              {t(k)}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {players.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="match-player-cell">
                              <div className="match-player-heading">
                                <TooltipButton
                                  data-dialog-focus={`player:${p.id}`}
                                  variant="link"
                                  className="player-name-button match-player-name"
                                  tooltip={`${p.name} · #${p.id}`}
                                  onClick={() =>
                                    openModal({ type: 'profile', id: p.id, name: p.name })
                                  }
                                >
                                  <span className="player-name">{p.name}</span>
                                </TooltipButton>
                                <MatchAwards
                                  key={`${match.id}:${p.id}`}
                                  titles={titles[p.id] ?? []}
                                  scoreLabels={
                                    match.endedAt !== null ? match.scoreLabels?.[p.id] : undefined
                                  }
                                />
                              </div>
                              <small className="player-id muted">#{p.id}</small>
                            </TableCell>
                            <TableCell className="elo-column">
                              {formatMetric(p.newRating)}{' '}
                              <small
                                className={cn(
                                  'muted',
                                  eloChangeClass(
                                    p.newRating !== null && p.oldRating !== null
                                      ? p.newRating - p.oldRating
                                      : null,
                                  ),
                                )}
                              >
                                (
                                {formatDelta(
                                  p.newRating !== null && p.oldRating !== null
                                    ? p.newRating - p.oldRating
                                    : null,
                                )}
                                )
                              </small>
                            </TableCell>
                            {[
                              p.destructionScore,
                              p.lossesScore,
                              p.objectivesCaptured,
                              p.killed,
                              p.damageDealt,
                              p.damageReceived,
                              p.dlRatio,
                              p.supplyPoints,
                              p.exp,
                              p.medals,
                            ].map((value, i) => (
                              <TableCell key={i}>{formatMetric(value, i === 6 ? 2 : 0)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              );
            },
          )}
        </>
      )}
    </Dialog>
  );
}
