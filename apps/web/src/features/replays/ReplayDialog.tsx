import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Loading, Notice } from '../../components/ui';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { RecoveryAction } from '../../components/RecoveryAction';
export function ReplayDialog({ id, title }: { id: string; title: string }) {
  const { api, closeModal, backModal } = useApp(),
    { t } = useI18n(),
    request = useRequest<{ url: string }>(),
    video = useRef<HTMLVideoElement>(null),
    reloading = useRef(false),
    position = useRef(0),
    playing = useRef(true),
    mediaFailed = useRef(false),
    playbackGeneration = useRef(0),
    playbackUrl = useRef<string | null>(null),
    [speed, setSpeed] = useState(1),
    [attempt, setAttempt] = useState(0),
    [error, setError] = useState<string | null>(null);
  const bindVideo = useCallback((element: HTMLVideoElement | null) => {
    const previous = video.current;
    video.current = element;
    if (previous && previous !== element) {
      queueMicrotask(() => {
        if (video.current === previous) return;
        previous.pause();
        previous.removeAttribute('src');
        previous.load();
      });
    }
  }, []);
  const release = (url: string) => {
    if (!url) return;
    void api.invoke('replays.release', { url }).catch(() => {
      // Native document teardown also revokes outstanding playback handles.
    });
  };
  const loadPlayback = async () => {
    const generation = ++playbackGeneration.current;
    try {
      const result = await api.invoke('replays.play', { name: id });
      if (generation !== playbackGeneration.current) release(result.url);
      else {
        const previous = playbackUrl.current;
        playbackUrl.current = result.url;
        if (previous && previous !== result.url) release(previous);
      }
      return result;
    } catch (failure) {
      const message = errorMessage(failure);
      if (message === 'REPLAY_PLAYBACK_LIMIT' || message.endsWith(': REPLAY_PLAYBACK_LIMIT'))
        throw new Error(t('replayPlaybackLimit'));
      throw failure;
    }
  };
  const retry = () => {
    if (reloading.current) return;
    reloading.current = true;
    if (video.current && !mediaFailed.current) {
      position.current = video.current.currentTime;
      playing.current = !video.current.paused;
    }
    setError(null);
    void request.load(loadPlayback, true).then((result) => {
      if (result) setAttempt((value) => value + 1);
      reloading.current = false;
    });
  };
  useEffect(() => {
    position.current = 0;
    playing.current = true;
    mediaFailed.current = false;
    reloading.current = false;
    setSpeed(1);
    setError(null);
    void request.load(loadPlayback);
    return () => {
      playbackGeneration.current++;
      const url = playbackUrl.current;
      playbackUrl.current = null;
      if (url) release(url);
    };
  }, [api, id]);
  return (
    <Dialog
      open
      onClose={closeModal}
      onBack={backModal}
      title={title || t('play')}
      className="dialog-wide"
    >
      <div className="replay-stage" aria-busy={request.pending}>
        {request.data && (
          <>
            <video
              key={attempt}
              className="replay-video"
              ref={bindVideo}
              src={request.data.url}
              controls
              autoPlay={playing.current}
              onError={(event) => {
                if (reloading.current || event.currentTarget !== video.current) return;
                mediaFailed.current = true;
                setError(t('error'));
              }}
              onTimeUpdate={(event) => {
                if (!mediaFailed.current && event.currentTarget === video.current)
                  position.current = event.currentTarget.currentTime;
              }}
              onPlay={(event) => {
                if (!mediaFailed.current && event.currentTarget === video.current)
                  playing.current = true;
              }}
              onPause={(event) => {
                if (!mediaFailed.current && event.currentTarget === video.current)
                  playing.current = false;
              }}
              onLoadedMetadata={() => {
                const current = video.current;
                if (!current) return;
                mediaFailed.current = false;
                setError(null);
                current.playbackRate = speed;
                if (position.current > 0)
                  current.currentTime = Number.isFinite(current.duration)
                    ? Math.min(position.current, current.duration)
                    : position.current;
                if (!playing.current) current.pause();
              }}
            />
          </>
        )}
        {request.pending && (
          <div className="replay-status">
            <Loading />
          </div>
        )}
        {!request.pending && (request.error || error) && (
          <div className="replay-status">
            <Notice error>{request.error || error}</Notice>
          </div>
        )}
      </div>
      <RecoveryAction
        available={Boolean(request.error || error)}
        pending={request.pending}
        retryLabel={t('retry')}
        refreshLabel={t('refresh')}
        pendingLabel={t('loading')}
        onRetry={retry}
      />
      <ToggleGroup
        className="shrink-0"
        type="single"
        variant="outline"
        value={String(speed)}
        disabled={!request.data || request.pending}
        aria-label={t('speed')}
        onValueChange={(value) => {
          if (!value) return;
          setSpeed(Number(value));
          if (video.current) video.current.playbackRate = Number(value);
        }}
      >
        {[1, 2, 3].map((value) => (
          <ToggleGroupItem key={value} value={String(value)}>
            {value}×
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Dialog>
  );
}
