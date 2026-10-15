import { useEffect } from 'react';
import { Video, Play, FolderOpen, RefreshCw, Settings2 } from 'lucide-react';
import type { Replay } from '@ba/contracts';
import { formatSize, formatTime, formatDuration } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import {
  Button,
  Card,
  Field,
  Toggle,
  Notice,
  Loading,
  Empty,
  Badge,
  Menu,
} from '../../components/ui';
export function ReplaysPanel() {
  const { api, state, openModal, patchConfig, notify } = useApp(),
    { t, locale } = useI18n(),
    request = useRequest<Replay[]>();
  const refresh = () => void request.load(() => api.invoke('replays.list', null), true);
  useEffect(() => {
    refresh();
  }, [api, state.replaysRevision, state.config.replaySaveDir]);
  const list = request.data || [],
    total = list.reduce((sum, r) => sum + r.size, 0),
    recording = state.recording;
  return (
    <Card
      title={t('replays')}
      icon={<Video size={19} />}
      actions={
        <Button onClick={() => openModal({ type: 'recordingSettings' })}>
          <Settings2 size={16} aria-hidden="true" />
          {t('recordingSettings')}
        </Button>
      }
    >
      <div className="recording-controls">
        <Toggle
          id="auto-record"
          label={t('autoRecord')}
          checked={state.config.replayEnabled}
          onChange={(value) => {
            if (value) openModal({ type: 'recordingSettings', enable: true });
            else void patchConfig({ replayEnabled: false });
          }}
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
      </div>
      {recording.error && <Notice error>{recording.error}</Notice>}
      {state.preview && recording.phase === 'recording' && (
        <figure className="recording-preview">
          <img src={state.preview.dataUrl} alt={t('preview')} />
          <figcaption>
            {t('preview')} · {t(state.preview.hasAudio ? 'audio' : 'audioOff')}
          </figcaption>
        </figure>
      )}
      <div className="section-heading">
        <h3>
          {t('recordingLibrary')} <Badge>{list.length}</Badge>
          <small>
            {' '}
            · {t('storageUsed')} {formatSize(total)}
          </small>
        </h3>
        <div className="actions">
          <Button
            onClick={() =>
              void api.invoke('replays.open', null).catch((e) => notify(String(e), true))
            }
          >
            <FolderOpen size={16} aria-hidden="true" />
            {t('folder')}
          </Button>
          <Button onClick={refresh} disabled={request.pending}>
            <RefreshCw size={16} className={request.pending ? 'spinner' : ''} aria-hidden="true" />
            {t('refresh')}
          </Button>
          <Menu>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(t('cleanAll') + '?'))
                  void api
                    .invoke('replays.clean', { days: 0 })
                    .then(() => refresh())
                    .catch((e) => notify(String(e), true));
              }}
            >
              {t('cleanAll')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(t('clean30') + '?'))
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
      </div>
      {request.pending && !request.data && <Loading />}
      {request.error && <Notice error>{request.error}</Notice>}
      {list.length ? (
        <div className="replay-list">
          {list.map((r) => (
            <div className="replay-row" key={r.id}>
              <button
                className="replay-thumbnail"
                aria-label={`${t('play')}: ${r.map || r.uploaderName}`}
                onClick={() =>
                  openModal({ type: 'replay', id: r.id, title: r.map || r.uploaderName })
                }
              >
                <Video size={36} strokeWidth={1.25} aria-hidden="true" />
                <Badge>{formatDuration(r.durationSec)}</Badge>
              </button>
              <div className="replay-description">
                <strong>
                  {r.map || '#' + (r.fid || '—')}
                  {r.test && <Badge>{t('recordingTest')}</Badge>}
                </strong>
                <small>
                  {r.uploaderName} · {formatTime(r.createdAt, locale)} · {formatSize(r.size)}
                </small>
              </div>
              <Button
                onClick={() =>
                  openModal({ type: 'replay', id: r.id, title: r.map || r.uploaderName })
                }
              >
                <Play size={15} aria-hidden="true" />
                {t('play')}
              </Button>
              <Menu label={`${t('actions')}: ${r.map || r.id}`}>
                {r.fid && (
                  <Button onClick={() => openModal({ type: 'match', fid: r.fid || '' })}>
                    {t('matchDetail')}
                  </Button>
                )}
                <Button onClick={() => void api.invoke('replays.open', null)}>{t('folder')}</Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(t('deleteConfirm')))
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
          ))}
        </div>
      ) : (
        !request.pending && (
          <Empty
            icon={<Video size={28} />}
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
      <Field id="replay-dir-readonly" label={t('saveDirectory')}>
        <input
          id="replay-dir-readonly"
          value={state.config.replaySaveDir || t('defaultDirectory')}
          readOnly
        />
      </Field>
    </Card>
  );
}
