import { Separator } from '@/components/ui/separator';
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group';
import { useEffect, useState, type ReactNode } from 'react';
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
import type { Replay } from '@ba/contracts';
import { formatSize, formatTime, formatDuration } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { LoadingStatus } from '../../components/LoadingState';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, Button, Toggle, Notice, Empty, Badge, Menu, Field } from '../../components/ui';
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
function ReplaySkeleton({ view }: { view: 'grid' | 'list' }) {
  return (
    <li className={cn('replay-row', view === 'grid' && 'replay-grid-item')} aria-hidden="true">
      <ReplaySurface view={view} title="">
        <div className="replay-play">
          <Skeleton className="replay-thumbnail" />
          <div className="replay-description">
            <strong>
              <Skeleton className="h-5 w-32 max-w-full" />
            </strong>
            <div className="replay-metadata">
              <Skeleton className="replay-uploader h-4 w-20" />
              <Skeleton className="replay-created h-4 w-28" />
              <Skeleton className="replay-file-size h-4 w-12" />
            </div>
          </div>
        </div>
        <div className="replay-actions">
          <Skeleton className="size-8" />
        </div>
      </ReplaySurface>
    </li>
  );
}
export function ReplaysPanel() {
  const confirm = useConfirmation();
  const { api, state, openModal, patchConfig, notify } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<Replay[]>();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const refresh = () => void request.load(() => api.invoke('replays.list', null), true);
  useEffect(() => {
    refresh();
  }, [api, state.replaysRevision, state.config.replaySaveDir]);
  const list = request.data || [],
    total = list.reduce((sum, r) => sum + r.size, 0),
    recording = state.recording,
    loading = !request.data && (request.pending || !request.error);
  return (
    <div className="replays-panel">
      {recording.error && <Notice error>{recording.error}</Notice>}
      <div className="replay-workspace">
        <Card
          title={t('preview')}
          className="replay-preview-card"
          description={
            state.preview && recording.phase === 'recording'
              ? t(state.preview.hasAudio ? 'audio' : 'audioOff')
              : undefined
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
            <Toggle
              id="auto-record"
              label={t('autoRecord')}
              labelClickable={false}
              checked={state.config.replayEnabled}
              onChange={(value) => void patchConfig({ replayEnabled: value }).catch(() => {})}
            />
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
                      : state.config.replayEnabled
                        ? t('waiting')
                        : t('recordingOff')}
              </Badge>
              {recording.phase === 'recording' && (
                <span>
                  {formatDuration(recording.seconds)} · {recording.sourceId}
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
                  value={state.config.replaySaveDir || t('defaultDirectory')}
                  readOnly
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-sm"
                    aria-label={t('folder')}
                    onClick={() =>
                      void api
                        .invoke('replays.open', null)
                        .catch((error) => notify(String(error), true))
                    }
                  >
                    <Icon icon={faFolderOpen} />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </footer>
        </Card>
      </div>
      <Card
        title={t('recordingLibrary')}
        className="replay-library"
        description={
          <span className="inline-flex items-center gap-2">
            {t('storageUsed')}
            {loading ? <Skeleton className="h-4 w-16" aria-hidden="true" /> : formatSize(total)}
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
            {loading ? (
              <Skeleton className="h-5 w-8" aria-hidden="true" />
            ) : (
              <Badge>{list.length}</Badge>
            )}
            <div className="actions">
              <Button
                onClick={() =>
                  void api.invoke('replays.open', null).catch((e) => notify(String(e), true))
                }
              >
                <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                {t('folder')}
              </Button>
              <Button onClick={refresh} disabled={request.pending}>
                <Icon icon={faArrowsRotate} size={16} spin={request.pending} aria-hidden="true" />
                {t('refresh')}
              </Button>
              <Menu>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t('cleanAll'),
                        description: t('confirmation.deleteHint'),
                        confirmLabel: t('cleanAll'),
                      })
                    )
                      void api
                        .invoke('replays.clean', { days: 0 })
                        .then(() => refresh())
                        .catch((e) => notify(String(e), true));
                  }}
                >
                  {t('cleanAll')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t('clean30'),
                        description: t('confirmation.deleteHint'),
                        confirmLabel: t('clean30'),
                      })
                    )
                      void api
                        .invoke('replays.clean', { days: 30 })
                        .then(() => refresh())
                        .catch((e) => notify(String(e), true));
                  }}
                >
                  {t('clean30')}
                </Button>
              </Menu>
            </div>
          </>
        }
      >
        {loading && <LoadingStatus />}
        {request.error && <Notice error>{request.error}</Notice>}
        {loading ? (
          <ul
            className={cn('replay-list', view === 'grid' && 'replay-grid')}
            aria-busy="true"
            aria-label={t('recordingLibrary')}
          >
            {Array.from({ length: 6 }, (_, index) => (
              <ReplaySkeleton key={index} view={view} />
            ))}
          </ul>
        ) : list.length ? (
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
                    aria-label={`${t('play')}: ${r.map || r.uploaderName}`}
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
                        <span className="replay-uploader">{r.uploaderName}</span>
                        <span className="replay-created">{formatTime(r.createdAt, locale)}</span>
                        <span className="replay-file-size">{formatSize(r.size)}</span>
                      </small>
                    </span>
                  </TooltipButton>
                  <div className="replay-actions">
                    <Menu label={`${t('actions')}: ${r.map || r.id}`}>
                      {r.fid && (
                        <Button onClick={() => openModal({ type: 'match', fid: r.fid || '' })}>
                          {t('matchDetail')}
                        </Button>
                      )}
                      <Button onClick={() => void api.invoke('replays.open', null)}>
                        {t('folder')}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: t('confirmation.deleteReplay'),
                              description: t('confirmation.deleteHint'),
                              detail: `${r.map || r.uploaderName} · ${r.id}`,
                              confirmLabel: t('delete'),
                            })
                          )
                            void api
                              .invoke('replays.delete', { name: r.id })
                              .then(() => refresh())
                              .catch((e) => notify(String(e), true));
                        }}
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
          !request.pending && (
            <Empty
              icon={<Icon icon={faVideo} size={28} />}
              description={t('recordingHint')}
              action={
                <Button onClick={() => openModal({ type: 'recordingSettings', enable: true })}>
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
