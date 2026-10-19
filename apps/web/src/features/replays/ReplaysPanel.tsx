import { useEffect } from 'react';
import {
  faVideo,
  faPlay,
  faFolderOpen,
  faArrowsRotate,
  faSliders,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import { TooltipButton } from '../../components/Tooltip';
import type { Replay } from '@ba/contracts';
import { formatSize, formatTime, formatDuration } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Button, Toggle, Notice, Loading, Empty, Badge, Menu } from '../../components/ui';
export function ReplaysPanel() {
  const confirm = useConfirmation();
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
    <div className="replays-panel">
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
      {recording.error && <Notice error>{recording.error}</Notice>}
      <figure className="recording-preview">
        <div className="recording-preview-media">
          {state.preview && recording.phase === 'recording' ? (
            <img src={state.preview.dataUrl} alt={t('preview')} />
          ) : (
            <span className="muted">
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
            </span>
          )}
        </div>
        <figcaption>
          {t('preview')}
          {state.preview && recording.phase === 'recording' && (
            <> · {t(state.preview.hasAudio ? 'audio' : 'audioOff')}</>
          )}
        </figcaption>
      </figure>
      <section className="replay-library" aria-labelledby="replay-library-title">
        <div className="section-heading">
          <h2 id="replay-library-title">
            {t('recordingLibrary')} <Badge>{list.length}</Badge>
            <small>
              {' '}
              · {t('storageUsed')} {formatSize(total)}
            </small>
          </h2>
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
                variant="danger"
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
                variant="danger"
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
        </div>
        {request.pending && !request.data && <Loading />}
        {request.error && <Notice error>{request.error}</Notice>}
        {list.length ? (
          <ul className="replay-list">
            {list.map((r) => (
              <li className="replay-row" key={r.id}>
                <TooltipButton
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
                      {r.map || '#' + (r.fid || '—')}
                      {r.test && <Badge>{t('recordingTest')}</Badge>}
                    </strong>
                    <small>
                      {r.uploaderName} · {formatTime(r.createdAt, locale)} · {formatSize(r.size)}
                    </small>
                  </span>
                </TooltipButton>
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
                    variant="danger"
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
      </section>
      <footer className="replay-directory">
        <label htmlFor="replay-dir-readonly">{t('saveDirectory')}</label>
        <input
          id="replay-dir-readonly"
          value={state.config.replaySaveDir || t('defaultDirectory')}
          readOnly
        />
      </footer>
    </div>
  );
}
