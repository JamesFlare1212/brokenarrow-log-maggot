import { useEffect, type ReactNode } from 'react';
import {
  ArrowRight,
  Archive,
  Crosshair,
  Layers,
  Search,
  ShieldCheck,
  Trophy,
  Users,
  Video,
  CirclePlay,
  Clock3,
} from 'lucide-react';
import type { Match } from '@ba/contracts';
import { formatDuration, formatMetric, formatTime, outcomeTone } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Badge, Button, Card, Empty, Loading, Notice } from '../../components/ui';
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
    <div className="metric-card">
      <div className="metric-label">
        <span>{label}</span>
        <span className="metric-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <strong className="metric-value">{value}</strong>
      <span className="metric-detail">{detail}</span>
    </div>
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
    (m) => state.session.localPlayerId && m.localPlayerId === state.session.localPlayerId,
  );
  const recent = personal
    .filter(
      (m) => m.endedAt !== null && !m.restarted && (m.outcome === 'win' || m.outcome === 'loss'),
    )
    .slice(0, 12);
  const wins = recent.filter((m) => m.outcome === 'win').length;
  const latest = personal.find((m) => m.endedAt !== null && m.eloAfter !== null);
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
  const count = data === null ? '—' : all.length;
  return (
    <div className="dashboard">
      <div className="metrics-grid" aria-label={t('sessionOverview')}>
        <Metric
          label={t('recentRating')}
          value={formatMetric(latest?.eloAfter ?? null, 0)}
          detail={t('completedMatch')}
          icon={<Crosshair size={18} />}
        />
        <Metric
          label={t('recentWinRate')}
          value={recent.length ? `${Math.round((wins / recent.length) * 100)}%` : '—'}
          detail={
            recent.length ? t('winLossCount', { wins, losses: recent.length - wins }) : t('empty')
          }
          icon={<Trophy size={18} />}
        />
        <Metric
          label={t('archiveCount')}
          value={count}
          detail={t('localArchive')}
          icon={<Archive size={18} />}
        />
        <Metric
          label={t('livePlayers')}
          value={roster.length}
          detail={t(state.session.phase === 'match' ? 'liveMatch' : 'waiting')}
          icon={<Users size={18} />}
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
      <div className="dashboard-grid">
        <SessionPanel />
        <aside className="dashboard-side" aria-label={t('quickTools')}>
          <Card title={t('replays')} icon={<Video size={18} />} className="recording-widget">
            <div
              className={`recording-illustration ${recordingActive ? 'is-recording' : ''}`}
              aria-hidden="true"
            >
              <div className="recording-frame">
                <CirclePlay size={32} strokeWidth={1.25} />
              </div>
              <span className="recording-rec">
                REC <span />
              </span>
            </div>
            <div className="recording-widget-status">
              <span
                className={`status-dot ${recordingActive ? 'status-recording' : state.config.replayEnabled ? 'status-success' : ''}`}
              />
              <strong>{t(recordingLabel)}</strong>
            </div>
            {recordingActive ? (
              <p className="muted">
                <Clock3 size={14} aria-hidden="true" /> {formatDuration(recording.seconds)} ·{' '}
                {recording.map || '—'}
              </p>
            ) : (
              <p className="muted">{t('recordingHint')}</p>
            )}
            {recording.error && <Notice error>{recording.error}</Notice>}
            <Button
              className="widget-action button-borderless"
              onClick={() =>
                openModal({ type: 'recordingSettings', enable: !state.config.replayEnabled })
              }
            >
              {t(state.config.replayEnabled ? 'recordingSettings' : 'enableRecording')}
              <ArrowRight size={15} />
            </Button>
          </Card>
          <Card title={t('quickTools')} className="quick-tools">
            {(
              [
                ['players', <Search size={18} />, 'playerShortcut'],
                ['decks', <Layers size={18} />, 'deckShortcut'],
                ['bans', <ShieldCheck size={18} />, 'banShortcut'],
              ] as const
            ).map(([page, icon, hint]) => (
              <button className="quick-tool" key={page} onClick={() => setPage(page)}>
                <span className="quick-tool-icon" aria-hidden="true">
                  {icon}
                </span>
                <span>
                  <strong>{t(page)}</strong>
                  <small>{t(hint)}</small>
                </span>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            ))}
          </Card>
        </aside>
      </div>
      <Card
        title={t('recent')}
        icon={<Archive size={18} />}
        className="recent-card"
        actions={
          <Button className="text-button" onClick={() => setPage('archive')}>
            {t('viewAll')}
            <ArrowRight size={15} />
          </Button>
        }
      >
        {pending && !data ? (
          <Loading />
        ) : all.length ? (
          <div className="recent-matches">
            {all.slice(0, 3).map((m) => (
              <button
                className="recent-match"
                key={m.id}
                disabled={!m.fid}
                onClick={() => m.fid && openModal({ type: 'match', fid: m.fid })}
              >
                <span
                  className={`recent-match-mark mark-${outcomeTone(m.outcome)}`}
                  aria-hidden="true"
                >
                  <Crosshair size={21} />
                </span>
                <span className="recent-match-description">
                  <strong>{m.map || `#${m.id}`}</strong>
                  <small>
                    {t(m.mode)} · {formatTime(m.endedAt, locale)}
                  </small>
                </span>
                <Badge tone={outcomeTone(m.outcome)}>
                  {m.restarted ? t('restarted') : t(m.outcome)}
                </Badge>
                <span
                  className={`recent-elo ${m.eloAfter !== null && m.eloBefore !== null && m.eloAfter >= m.eloBefore ? 'text-success' : ''}`}
                >
                  {m.eloAfter !== null && m.eloBefore !== null
                    ? `${m.eloAfter - m.eloBefore > 0 ? '+' : ''}${formatMetric(m.eloAfter - m.eloBefore, 0)}`
                    : '—'}{' '}
                  <small>ELO</small>
                </span>
                <ArrowRight size={15} className="muted" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <Empty icon={<Archive size={24} />} description={t('noMatchesHint')}>
            {t('empty')}
          </Empty>
        )}
      </Card>
      <div className="dashboard-optional-panels">
        {state.config.inputHookEnabled && state.config.panelOrder.includes('apm') && <ApmPanel />}
      </div>
    </div>
  );
}
