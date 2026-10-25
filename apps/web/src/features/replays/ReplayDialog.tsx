import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Button, Loading, Notice } from '../../components/ui';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
export function ReplayDialog({ id, title }: { id: string; title: string }) {
  const { api, closeModal, backModal } = useApp(),
    { t } = useI18n(),
    request = useRequest<{ url: string }>(),
    video = useRef<HTMLVideoElement>(null),
    [speed, setSpeed] = useState(1),
    [attempt, setAttempt] = useState(0),
    [error, setError] = useState<string | null>(null);
  const retry = () => {
    setError(null);
    setAttempt((value) => value + 1);
    void request.load(() => api.invoke('replays.play', { name: id }), true);
  };
  useEffect(() => {
    void request.load(() => api.invoke('replays.play', { name: id }));
    return () => {
      video.current?.pause();
      video.current?.removeAttribute('src');
      video.current?.load();
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
              ref={video}
              src={request.data.url}
              controls
              autoPlay
              onError={() => setError(t('error'))}
              onLoadedMetadata={() => {
                if (video.current) video.current.playbackRate = speed;
              }}
            />
          </>
        )}
        {request.pending && (
          <div className="replay-status">
            <Loading />
          </div>
        )}
        {(request.error || error) && (
          <div className="replay-status">
            <Notice error>{request.error || error}</Notice>
            <Button onClick={retry} disabled={request.pending}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
      <ToggleGroup
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
