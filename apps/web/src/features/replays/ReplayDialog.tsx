import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Button, Loading, Notice } from '../../components/ui';
export function ReplayDialog({ id, title }: { id: string; title: string }) {
  const { api, closeModal } = useApp(),
    { t } = useI18n(),
    request = useRequest<{ url: string }>(),
    video = useRef<HTMLVideoElement>(null),
    [speed, setSpeed] = useState(1),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void request.load(() => api.invoke('replays.play', { name: id }));
    return () => {
      video.current?.pause();
      video.current?.removeAttribute('src');
      video.current?.load();
    };
  }, [api, id]);
  return (
    <Dialog open onClose={closeModal} title={title || t('play')} className="dialog-wide">
      {request.pending && <Loading />}
      {request.error && <Notice error>{request.error}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {request.data && (
        <>
          <video
            className="replay-video"
            ref={video}
            src={request.data.url}
            controls
            autoPlay
            onError={() => setError(t('error'))}
          />
          <div className="actions" aria-label={t('speed')}>
            {[1, 2, 3].map((value) => (
              <Button
                key={value}
                variant={speed === value ? 'primary' : 'ghost'}
                onClick={() => {
                  setSpeed(value);
                  if (video.current) video.current.playbackRate = value;
                }}
              >
                {value}×
              </Button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
