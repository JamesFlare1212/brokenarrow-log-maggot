import { Separator } from '@/components/ui/separator';
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Card as ReplayCard,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  CardMedia,
} from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Video as faVideo,
  Play,
  FolderOpen as faFolderOpen,
  RefreshCw as faArrowsRotate,
  SlidersHorizontal as faSliders,
  LayoutGrid,
  List,
} from 'lucide-react';
import { Icon } from '../../components/Icon';
import { TooltipButton } from '../../components/Tooltip';
import { RECORDING_CODEC_LABELS, type Replay } from '@ba/contracts';
import { formatSize, formatTime, formatDuration } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { LoadingStatus } from '../../components/LoadingState';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, Button, Toggle, Notice, Empty, Badge, Menu, Field } from '../../components/ui';
const replayPlayClasses =
  'replay-play [.replay-grid_&]:w-full [.replay-grid_&]:flex-col [.replay-grid_&]:items-stretch [.replay-grid_&]:gap-0 [.replay-grid_&]:rounded-[calc(var(--radius-xl)-1px)] [.replay-grid_&]:border-0 [.replay-grid_&]:focus-visible:inset-ring-2 [.replay-grid_&]:focus-visible:inset-ring-ring flex h-auto min-w-0 flex-1 rounded-[calc(var(--radius-lg)+1px)] items-center justify-start gap-4 p-0 text-left';
const replayThumbnailClasses =
  'replay-thumbnail [.replay-list:not(.replay-grid)_&]:self-stretch [.replay-grid_&]:w-full [.replay-grid_&]:min-w-0 [.replay-grid_&>svg]:size-8 [.replay-grid_&>svg]:text-muted-foreground relative flex w-24 min-w-24 aspect-video items-center justify-center gap-2 rounded-lg bg-muted [.replay-grid_&]:rounded-t-none';

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
    <ReplayCard className="replay-grid-card h-full gap-0 p-0">
      <CardHeader className="sr-only">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="replay-grid-content relative flex flex-1 flex-col p-0 [&>[data-slot=tooltip-trigger]]:flex-1">
        {children}
      </CardContent>
    </ReplayCard>
  ) : (
    <>{children}</>
  );
}
function ReplaySkeleton({ view }: { view: 'grid' | 'list' }) {
  return (
    <li
      className={cn(
        'replay-row flex min-w-0 items-center gap-4 [.replay-list:not(.replay-grid)>&]:py-3 [.replay-list:not(.replay-grid)>.replay-row+&]:border-t [.replay-list:not(.replay-grid)>.replay-row+&]:border-t-border',
        view === 'grid' && 'replay-grid-item block min-w-0',
      )}
      aria-hidden="true"
    >
      <ReplaySurface view={view} title="">
        <div className={replayPlayClasses}>
          <Skeleton className={replayThumbnailClasses} />
          <div className="replay-description [.replay-grid_&]:p-3.5 [&_strong]:max-w-full [&_strong]:flex-wrap [&_strong]:flex [&_strong]:items-center [&_strong]:gap-2 [&_small]:whitespace-normal [&_small]:text-muted-foreground [&_small]:text-[0.75rem] flex min-w-0 flex-col items-start gap-1.5 flex-1 [.replay-list:not(.replay-grid)_&]:grid [.replay-list:not(.replay-grid)_&]:grid-cols-[minmax(0,_1fr)_auto] [.replay-list:not(.replay-grid)_&]:items-center [.replay-list:not(.replay-grid)_&>strong]:[grid-area:1_/_1] workspace-max-36:[.replay-list:not(.replay-grid)_&]:flex workspace-max-36:[.replay-list:not(.replay-grid)_&]:flex-col workspace-max-36:[.replay-list:not(.replay-grid)_&]:items-start">
            <strong>
              <Skeleton className="h-5 w-32 max-w-full" />
            </strong>
            <div className="replay-metadata flex flex-wrap items-center gap-y-1 gap-x-3 [.replay-list:not(.replay-grid)_&]:contents workspace-max-36:[.replay-list:not(.replay-grid)_&]:flex">
              <Skeleton className="replay-uploader [.replay-list:not(.replay-grid)_&]:[grid-area:2_/_1] h-4 w-20" />
              <Skeleton className="replay-created [.replay-list:not(.replay-grid)_&]:[grid-area:1_/_2] [.replay-list:not(.replay-grid)_&]:text-right workspace-max-36:[.replay-list:not(.replay-grid)_&]:text-left h-4 w-28" />
              <Skeleton className="replay-file-size [.replay-list:not(.replay-grid)_&]:[grid-area:2_/_2] [.replay-list:not(.replay-grid)_&]:text-right workspace-max-36:[.replay-list:not(.replay-grid)_&]:text-left h-4 w-12" />
            </div>
          </div>
        </div>
        <div className="replay-actions [.replay-grid-content>&]:absolute [.replay-grid-content>&]:top-2 [.replay-grid-content>&]:right-2">
          <Skeleton className="size-8" />
        </div>
      </ReplaySurface>
    </li>
  );
}
export function ReplaysPanel() {
  const confirm = useConfirmation();
  const { api, access, state, openModal, patchConfig, notify } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<Replay[]>();
  const canRecord = access.preference('replayEnabled');
  const openDirectory = () =>
    void api.invoke('replays.open', null).catch((e) => notify(String(e), true));
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
    <div className="replays-panel flex min-w-0 flex-col gap-(--content-gap)">
      {recording.error && <Notice error>{recording.error}</Notice>}
      <div className="replay-workspace grid grid-cols-[minmax(0,_1.65fr)_minmax(16rem,_1fr)] gap-(--content-gap) items-stretch workspace-max-48:grid-cols-1">
        <ReplayCard className="replay-preview-card" aria-label={t('preview')}>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {t('preview')}
            </CardTitle>
            {state.preview && recording.phase === 'recording' && (
              <CardDescription>{t(state.preview.hasAudio ? 'audio' : 'audioOff')}</CardDescription>
            )}
          </CardHeader>
          <CardMedia className="recording-preview recording-preview-media flex aspect-video min-h-52 max-h-76 items-center justify-center [&_img]:w-full [&_img]:h-full [&_img]:object-contain">
            {state.preview && recording.phase === 'recording' ? (
              <img src={state.preview.dataUrl} alt={t('preview')} />
            ) : (
              <Empty icon={<Icon icon={faVideo} />} iconSize="lg" description={t('recordingHint')}>
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
          </CardMedia>
        </ReplayCard>
        <Card title={t('recordingBehavior')} className="recording-status-card">
          <div className="recording-controls flex flex-col gap-4">
            <Toggle
              id="auto-record"
              label={t('autoRecord')}
              labelClickable={false}
              disabled={!canRecord}
              checked={state.config.replayEnabled}
              onChange={(value) => void patchConfig({ replayEnabled: value }).catch(() => {})}
            />
            <div className="recording-state flex items-center gap-2 flex-wrap" role="status">
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
                  {formatDuration(recording.seconds)}
                  {recording.codec && <> · {RECORDING_CODEC_LABELS[recording.codec]}</>}
                </span>
              )}
            </div>
            <Button onClick={() => openModal({ type: 'recordingSettings' })}>
              <Icon icon={faSliders} size={16} aria-hidden="true" />
              {t('recordingSettings')}
            </Button>
          </div>
          <Separator />
          <footer className="replay-directory flex min-w-0 flex-col gap-2 [&_input]:min-w-0">
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
                    disabled={!access.method('replays.open')}
                    onClick={openDirectory}
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
        className="replay-library min-w-0"
        description={
          <span className="inline-flex items-center gap-2">
            {t('storageUsed')}
            {loading ? <Skeleton className="h-4 w-16" aria-hidden="true" /> : formatSize(total)}
          </span>
        }
        actions={
          <>
            <ToggleGroup
              size="lg"
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
            <div className="actions flex items-center gap-2 flex-wrap [.add-match-form_&]:justify-end [.dialog-body>&:last-child]:justify-end viewport-max-767:[.profile-toolbar>&]:gap-1.5">
              <Button size="lg" disabled={!access.method('replays.open')} onClick={openDirectory}>
                <Icon icon={faFolderOpen} size={16} aria-hidden="true" />
                {t('folder')}
              </Button>
              <Button size="lg" onClick={refresh} disabled={request.pending}>
                <Icon icon={faArrowsRotate} size={16} spin={request.pending} aria-hidden="true" />
                {t('refresh')}
              </Button>
              <Menu size="icon-lg">
                <Button
                  variant="destructive"
                  disabled={!access.method('replays.clean')}
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
                  disabled={!access.method('replays.clean')}
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
            className={cn(
              'replay-list flex flex-col gap-0',
              view === 'grid' &&
                'replay-grid grid grid-cols-[repeat(auto-fill,_minmax(min(100%,_14rem),_1fr))] gap-(--content-gap)',
            )}
            aria-busy="true"
            aria-label={t('recordingLibrary')}
          >
            {Array.from({ length: 6 }, (_, index) => (
              <ReplaySkeleton key={index} view={view} />
            ))}
          </ul>
        ) : list.length ? (
          <ul
            className={cn(
              'replay-list flex flex-col gap-0',
              view === 'grid' &&
                'replay-grid grid grid-cols-[repeat(auto-fill,_minmax(min(100%,_14rem),_1fr))] gap-(--content-gap)',
            )}
            aria-label={t('recordingLibrary')}
          >
            {list.map((r) => (
              <li
                className={cn(
                  'replay-row flex min-w-0 items-center gap-4 [.replay-list:not(.replay-grid)>&]:py-3 [.replay-list:not(.replay-grid)>.replay-row+&]:border-t [.replay-list:not(.replay-grid)>.replay-row+&]:border-t-border',
                  view === 'grid' && 'replay-grid-item block min-w-0',
                )}
                key={r.id}
              >
                <ReplaySurface view={view} title={r.map || r.uploaderName}>
                  <TooltipButton
                    variant="ghost"
                    className={replayPlayClasses}
                    aria-label={`${t('play')}: ${r.map || r.uploaderName}`}
                    disabled={!access.method('replays.play')}
                    onClick={() =>
                      openModal({ type: 'replay', id: r.id, title: r.map || r.uploaderName })
                    }
                  >
                    <span className={replayThumbnailClasses} aria-hidden="true">
                      <Play size={18} />
                      <span className="replay-duration absolute right-1 bottom-1 rounded-sm bg-background px-1 py-0.25 text-[0.75rem] text-muted-foreground [.replay-grid_&]:text-foreground">
                        {formatDuration(r.durationSec)}
                      </span>
                    </span>
                    <span className="replay-description [.replay-grid_&]:p-3.5 [&_strong]:max-w-full [&_strong]:flex-wrap [&_strong]:flex [&_strong]:items-center [&_strong]:gap-2 [&_small]:whitespace-normal [&_small]:text-muted-foreground [&_small]:text-[0.75rem] flex min-w-0 flex-col items-start gap-1.5 flex-1 [.replay-list:not(.replay-grid)_&]:grid [.replay-list:not(.replay-grid)_&]:grid-cols-[minmax(0,_1fr)_auto] [.replay-list:not(.replay-grid)_&]:items-center [.replay-list:not(.replay-grid)_&>strong]:[grid-area:1_/_1] workspace-max-36:[.replay-list:not(.replay-grid)_&]:flex workspace-max-36:[.replay-list:not(.replay-grid)_&]:flex-col workspace-max-36:[.replay-list:not(.replay-grid)_&]:items-start">
                      <strong>
                        <span className="truncate">{r.map || '#' + (r.fid || '—')}</span>
                        {r.test && <Badge>{t('testReplay')}</Badge>}
                      </strong>
                      <small className="replay-metadata flex flex-wrap items-center gap-y-1 gap-x-3 [.replay-list:not(.replay-grid)_&]:contents workspace-max-36:[.replay-list:not(.replay-grid)_&]:flex">
                        <span className="replay-uploader [.replay-list:not(.replay-grid)_&]:[grid-area:2_/_1]">
                          {r.uploaderName}
                        </span>
                        <span className="replay-created [.replay-list:not(.replay-grid)_&]:[grid-area:1_/_2] [.replay-list:not(.replay-grid)_&]:text-right workspace-max-36:[.replay-list:not(.replay-grid)_&]:text-left">
                          {formatTime(r.createdAt, locale)}
                        </span>
                        <span className="replay-file-size [.replay-list:not(.replay-grid)_&]:[grid-area:2_/_2] [.replay-list:not(.replay-grid)_&]:text-right workspace-max-36:[.replay-list:not(.replay-grid)_&]:text-left">
                          {formatSize(r.size)}
                        </span>
                      </small>
                    </span>
                  </TooltipButton>
                  <div className="replay-actions [.replay-grid-content>&]:absolute [.replay-grid-content>&]:top-2 [.replay-grid-content>&]:right-2">
                    <Menu label={`${t('actions')}: ${r.map || r.id}`}>
                      {r.fid && (
                        <Button onClick={() => openModal({ type: 'match', fid: r.fid || '' })}>
                          {t('matchDetail')}
                        </Button>
                      )}
                      <Button disabled={!access.method('replays.open')} onClick={openDirectory}>
                        {t('folder')}
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={!access.method('replays.delete')}
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
              description={t(canRecord ? 'recordingHint' : 'devModeHint.captured')}
              action={
                canRecord && (
                  <Button onClick={() => openModal({ type: 'recordingSettings', enable: true })}>
                    {t('enableRecording')}
                  </Button>
                )
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
