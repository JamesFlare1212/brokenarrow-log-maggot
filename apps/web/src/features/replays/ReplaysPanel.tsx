import { Separator } from '@/components/ui/separator';
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card as ReplayCard, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Video as faVideo,
  Play as faPlay,
  FolderOpen as faFolderOpen,
  RefreshCw as faArrowsRotate,
  SlidersHorizontal as faSliders,
  LayoutGrid,
  List,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import { TooltipButton } from '../../components/Tooltip';
import type { ReplayLibrary, ReplayDeleteResult } from '@ba/contracts';
import { errorMessage, formatSize, formatTime, formatDuration } from '@ba/shared';
import { replayIdentity } from './labels';
import { RecordingMigrationResult } from './RecordingMigrationResult';
import { AutoRecordingControl } from './AutoRecordingControl';
import { RecordingCaptureFeedback } from './RecordingCaptureFeedback';
import { RecordingAudioSummary } from './RecordingAudioFeedback';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { localizedTeamLabel } from '../../lib/team-label';
import { useRequest } from '../../hooks/useRequest';
import { Card, Button, Notice, Loading, Empty, Badge, Menu, Field } from '../../components/ui';
function ReplaySurface({
  view,
  title,
  children,
}: {
  view: 'grid' | 'list';
  title: string;
  children: ReactNode;
}) {
  return view === 'grid' ? (
    <ReplayCard className="replay-grid-card">
      <CardHeader className="sr-only">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="replay-grid-content">{children}</CardContent>
    </ReplayCard>
  ) : (
    <>{children}</>
  );
}
export function ReplaysPanel() {
  const confirm = useConfirmation();
  const { api, state, openModal, notify } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<ReplayLibrary>();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [busy, setBusy] = useState(false),
    [operationError, setOperationError] = useState<string | null>(null),
    [outcome, setOutcome] = useState<ReplayDeleteResult | null>(null);
  const busyRef = useRef(false);
  const configuredDirectory = useRef(state.config.replaySaveDir);
  const order = useRef<{ directory: string; names: string[] } | null>(null);
  const generation = useRef(0);
  const feedback = (error: unknown) => {
    const message = errorMessage(error);
    for (const code of [
      'REPLAY_DIRECTORY_CHANGED',
      'REPLAY_TARGET_CHANGED',
      'REPLAY_DELETE_EXPIRED',
      'REPLAY_METADATA_DELETE_FAILED',
      'REPLAY_METADATA_RECOVERY_FAILED',
      'REPLAY_FILE_DELETE_FAILED',
    ])
      if (message.includes(code)) return t(code);
    return message;
  };
  const refresh = (manual = false) => {
    const id = ++generation.current;
    return request.load(async () => {
      const library = await api.invoke('replays.list', null);
      if (id !== generation.current) return library;
      const previous =
        order.current?.directory === library.directory && !manual ? order.current.names : [];
      const byId = new Map(library.recordings.map((recording) => [recording.id, recording]));
      const names = [
        ...previous.filter((name) => byId.has(name)),
        ...library.recordings
          .map((recording) => recording.id)
          .filter((name) => !previous.includes(name)),
      ];
      order.current = { directory: library.directory, names };
      return { ...library, recordings: names.map((name) => byId.get(name)!) };
    }, true);
  };
  useEffect(() => {
    if (configuredDirectory.current !== state.config.replaySaveDir) {
      configuredDirectory.current = state.config.replaySaveDir;
      generation.current++;
      order.current = null;
      request.invalidate();
    }
    void refresh();
  }, [api, state.replaysRevision, state.config.replaySaveDir]);
  const list = request.data?.recordings || [],
    total = list.reduce((sum, r) => sum + r.size, 0),
    recording = state.recording;
  const removeRecordings = async (names: string[] | null, days: number) => {
    const directory = request.data?.directory;
    if (busyRef.current || !directory) return;
    busyRef.current = true;
    setBusy(true);
    setOperationError(null);
    setOutcome(null);
    try {
      const plan = names
        ? await api.invoke('replays.planDelete', { directory, names })
        : await api.invoke('replays.planClean', { directory, days });
      if (!plan.recordings.length) {
        notify(t('recordingCleanupEmpty'));
        return;
      }
      const title = names ? t('confirmation.deleteReplay') : t(days === 0 ? 'cleanAll' : 'clean30');
      const detail = [
        t('recordingCleanupDirectory', { directory: plan.directory }),
        t('recordingCleanupCount', { count: plan.recordings.length }),
        t('recordingCleanupScope'),
        ...plan.recordings.map(
          (recording) =>
            `${replayIdentity(recording, locale)} · ${t(recording.dateSource === 'recording' ? 'recordingDate' : 'recordingModifiedDate')}`,
        ),
      ].join('\n');
      if (
        !(await confirm({
          title,
          description: t('confirmation.deleteHint'),
          detail,
          confirmLabel: names ? t('delete') : title,
        }))
      )
        return;
      const result = names
        ? await api.invoke('replays.delete', { token: plan.token })
        : await api.invoke('replays.clean', { token: plan.token });
      setOutcome(result);
      request.setData((library) =>
        library?.directory === result.directory
          ? {
              ...library,
              recordings: library.recordings.filter(
                (recording) =>
                  !result.completed.includes(recording.id) &&
                  !result.skipped.includes(recording.id),
              ),
            }
          : library,
      );
      notify(
        t(result.failed.length ? 'recordingCleanupPartial' : 'success'),
        result.failed.length > 0,
      );
    } catch (error) {
      const message = feedback(error);
      setOperationError(message);
      notify(message, true);
    } finally {
      await refresh();
      busyRef.current = false;
      setBusy(false);
    }
  };
  const openFolder = () =>
    void api.invoke('replays.open', null).catch((error) => notify(feedback(error), true));
  return (
    <div className="replays-panel">
      <RecordingCaptureFeedback />
      <div className="replay-workspace">
        <Card
          title={t('preview')}
          className="replay-preview-card"
          description={
            state.preview && recording.phase === 'recording' ? <RecordingAudioSummary /> : undefined
          }
        >
          <figure className="recording-preview">
            <div className="recording-preview-media">
              {state.preview && recording.phase === 'recording' ? (
                <img src={state.preview.dataUrl} alt={t('preview')} />
              ) : (
                <Empty
                  icon={<Icon icon={faVideo} />}
                  iconSize="lg"
                  description={t('recordingHint')}
                >
                  {t(
                    recording.phase === 'recording' || recording.phase === 'starting'
                      ? 'previewWaiting'
                      : recording.phase === 'stopping'
                        ? 'stopping'
                        : recording.phase === 'error'
                          ? 'previewUnavailable'
                          : state.config.replayEnabled
                            ? 'previewIdle'
                            : 'recordingOff',
                  )}
                </Empty>
              )}
            </div>
          </figure>
        </Card>
        <Card title={t('recordingBehavior')} className="recording-status-card">
          <div className="recording-controls">
            <AutoRecordingControl id="auto-record" />
            <div className="recording-state" role="status">
              <Badge
                tone={
                  recording.phase === 'recording'
                    ? 'danger'
                    : recording.phase === 'error'
                      ? 'warning'
                      : 'muted'
                }
              >
                {recording.phase === 'recording'
                  ? t('recording')
                  : recording.phase === 'starting'
                    ? t('starting')
                    : recording.phase === 'stopping'
                      ? t('stopping')
                      : recording.phase === 'error'
                        ? t('recordingFailed')
                        : state.config.replayEnabled
                          ? t('waiting')
                          : t('recordingOff')}
              </Badge>
              {recording.phase === 'recording' && (
                <span>
                  {formatDuration(recording.seconds)} ·{' '}
                  {recording.display?.label ?? recording.sourceId}
                </span>
              )}
            </div>
            <Button onClick={() => openModal({ type: 'recordingSettings' })}>
              <Icon icon={faSliders} size={16} aria-hidden="true" />
              {t('recordingSettings')}
            </Button>
          </div>
          <Separator />
          <footer className="replay-directory">
            <Field id="replay-dir-readonly" label={t('saveDirectory')}>
              <InputGroup>
                <InputGroupInput
                  id="replay-dir-readonly"
                  value={
                    request.data?.directory || state.config.replaySaveDir || t('defaultDirectory')
                  }
                  readOnly
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-sm" aria-label={t('folder')} onClick={openFolder}>
                    <Icon icon={faFolderOpen} />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </footer>
        </Card>
      </div>
      <RecordingMigrationResult result={request.data?.migration} />
      <Card
        title={t('recordingLibrary')}
        className="replay-library"
        description={
          <span className="flex flex-col gap-1">
            <span>
              {t('storageUsed')} {request.data ? formatSize(total) : '—'}
            </span>
            <span>{t('recordingOrderHint')}</span>
          </span>
        }
        actions={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              aria-label={t('replayView')}
              value={view}
              onValueChange={(value) => {
                if (value === 'grid' || value === 'list') setView(value);
              }}
            >
              <ToggleGroupItem value="grid" aria-label={t('gridView')}>
                <LayoutGrid aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label={t('listView')}>
                <List aria-hidden="true" />
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="min-w-10 tabular-nums">
              <Badge>{request.data ? list.length : '—'}</Badge>
            </span>
            <div className="actions">
              <Button onClick={openFolder}>
                <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                {t('folder')}
              </Button>
              <Button
                id="replays-refresh"
                aria-disabled={request.pending || busy}
                aria-busy={request.pending}
                onClick={() => {
                  if (!request.pending && !busy) void refresh(true);
                }}
              >
                <Icon icon={faArrowsRotate} size={16} spin={request.pending} aria-hidden="true" />
                {t('refresh')}
              </Button>
              <Menu disabled={busy || !list.length || request.pending}>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void removeRecordings(null, 0)}
                >
                  {t('cleanAll')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void removeRecordings(null, 30)}
                >
                  {t('clean30')}
                </Button>
              </Menu>
            </div>
          </>
        }
      >
        {request.pending && !request.data && <Loading />}
        {request.error && (
          <Notice error>
            <div className="flex min-w-0 flex-1 flex-col gap-2 wrap-anywhere">
              <p>{request.error}</p>
              {request.data !== null && <p>{t('listReadRetained')}</p>}
            </div>
          </Notice>
        )}
        {operationError && (
          <Notice error>
            <span className="min-w-0 wrap-anywhere">{operationError}</span>
          </Notice>
        )}
        {outcome && (
          <Notice error={outcome.failed.length > 0}>
            <div className="flex min-w-0 flex-1 flex-col gap-2 wrap-anywhere">
              <p>{t('recordingCleanupDirectory', { directory: outcome.directory })}</p>
              <p>
                {t('recordingCleanupSummary', {
                  completed: outcome.completed.length,
                  failed: outcome.failed.length,
                  skipped: outcome.skipped.length,
                })}
              </p>
              {outcome.completed.length > 0 && (
                <p>
                  {t('deckCompletedFiles')} {outcome.completed.join(', ')}
                </p>
              )}
              {outcome.failed.length > 0 && (
                <ul>
                  {outcome.failed.map((failure) => (
                    <li key={failure.name}>
                      {failure.name}: {feedback(failure.message)}
                    </li>
                  ))}
                </ul>
              )}
              {outcome.skipped.length > 0 && (
                <p>
                  {t('recordingCleanupSkipped')} {outcome.skipped.join(', ')}
                </p>
              )}
            </div>
          </Notice>
        )}
        {list.length ? (
          <ul
            className={cn('replay-list', view === 'grid' && 'replay-grid')}
            aria-label={t('recordingLibrary')}
          >
            {list.map((r) => (
              <li className={cn('replay-row', view === 'grid' && 'replay-grid-item')} key={r.id}>
                <ReplaySurface view={view} title={r.map || r.uploaderName}>
                  <TooltipButton
                    variant="ghost"
                    className="replay-play"
                    aria-label={`${t('play')}: ${replayIdentity(r, locale)}`}
                    tooltip={replayIdentity(r, locale)}
                    disabled={busy}
                    onClick={() =>
                      openModal({ type: 'replay', id: r.id, title: r.map || r.uploaderName })
                    }
                  >
                    <span className="replay-thumbnail" aria-hidden="true">
                      <Icon icon={faPlay} size={18} />
                      <span className="replay-duration">{formatDuration(r.durationSec)}</span>
                    </span>
                    <span className="replay-description">
                      <strong>
                        <span className="truncate">{r.map || '#' + (r.fid || '—')}</span>
                        {r.test && <Badge>{t('testReplay')}</Badge>}
                      </strong>
                      <small className="replay-metadata">
                        <span className="replay-uploader">
                          {r.uploaderName || localizedTeamLabel(r.teamId, locale)}
                        </span>
                        <span className="replay-created">{formatTime(r.createdAt, locale)}</span>
                        {r.dateSource === 'modified' && <span>{t('recordingModifiedDate')}</span>}
                        <span className="replay-file-size">{formatSize(r.size)}</span>
                      </small>
                    </span>
                  </TooltipButton>
                  <div className="replay-actions">
                    <Menu label={`${t('actions')}: ${replayIdentity(r, locale)}`} disabled={busy}>
                      {r.fid && (
                        <Button onClick={() => openModal({ type: 'match', fid: r.fid || '' })}>
                          {t('matchDetail')}
                        </Button>
                      )}
                      <Button onClick={openFolder}>{t('folder')}</Button>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void removeRecordings([r.id], 0)}
                      >
                        {t('delete')}
                      </Button>
                    </Menu>
                  </div>
                </ReplaySurface>
              </li>
            ))}
          </ul>
        ) : (
          request.data !== null &&
          !request.pending &&
          !request.error && (
            <Empty
              icon={<Icon icon={faVideo} size={28} />}
              description={t('recordingHint')}
              action={
                <Button onClick={() => openModal({ type: 'recordingSettings' })}>
                  {t('enableRecording')}
                </Button>
              }
            >
              {t('empty')}
            </Empty>
          )
        )}
      </Card>
    </div>
  );
}
