import { useId, useState, type ReactNode } from 'react';
import type { DisplayPreview } from '@ba/contracts';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { FieldGroup, FieldError } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { RefreshCw } from 'lucide-react';
import { Button, Field } from '../../components/ui';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useDisplayPreview } from './useDisplayPreview';

export function RecordingDisplayPicker({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  const { api } = useApp(),
    { t } = useI18n(),
    id = useId(),
    statusId = useId();
  const request = useDisplayPreview(api, value),
    snapshot = request.data;
  const [failedImage, setFailedImage] = useState<DisplayPreview | null>(null);
  const selected = request.choices.find(
    (display) => display.id === value || display.displayId === value,
  );
  const missing = !!value && !selected;
  const imageFailed = !!snapshot && failedImage === snapshot;
  const showImage = !!snapshot?.thumbnail && !imageFailed;
  return (
    <FieldGroup>
      <Field id={id} label={t('display')}>
        <NativeSelect
          id={id}
          data-recording-display-select
          className="w-full min-w-0 max-w-full"
          value={selected?.id ?? value}
          aria-describedby={statusId}
          onChange={(event) => onChange(event.target.value)}
        >
          <NativeSelectOption value="">{t('autoDisplay')}</NativeSelectOption>
          {missing && (
            <NativeSelectOption value={value}>
              {t(snapshot && !request.error ? 'displayMissingChoice' : 'displayUnconfirmedChoice', {
                id: value,
              })}
            </NativeSelectOption>
          )}
          {request.choices.map((display) => (
            <NativeSelectOption key={display.id} value={display.id}>
              {display.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <div className="recording-video-grid">
        <figure className="display-preview-panel">
          <figcaption className="display-preview-caption">
            <div
              id={statusId}
              className="display-preview-status"
              role="region"
              tabIndex={0}
              aria-label={t('displayPreviewStatus')}
            >
              {snapshot?.sourceId ? (
                <p>
                  {t(request.error ? 'displayPreviewStale' : 'displayPreviewTarget', {
                    display: snapshot.label ?? snapshot.sourceId,
                  })}
                </p>
              ) : (
                <p>
                  {t(
                    request.error
                      ? 'displayPreviewUnconfirmed'
                      : request.pending && !snapshot
                        ? 'displayPreviewLoading'
                        : 'displayPreviewNoSources',
                  )}
                </p>
              )}
              <p>{t(value ? 'displayFixedPolicy' : 'displayAutomaticPolicy')}</p>
              {snapshot?.selection === 'fallback' && (
                <p role="status">
                  {t('displayPreviewFallback', {
                    id: value,
                    display: snapshot.label ?? snapshot.sourceId ?? t('unknown'),
                  })}
                </p>
              )}
              {request.error && (
                <FieldError>
                  {t('displayPreviewRefreshFailed')}{' '}
                  <span>
                    {request.error === 'DISPLAY_PREVIEW_TARGET_CHANGED'
                      ? t('displayPreviewTargetChanged')
                      : request.error}
                  </span>
                </FieldError>
              )}
              {imageFailed && <FieldError>{t('displayPreviewImageFailed')}</FieldError>}
            </div>
            <Button
              size="sm"
              aria-disabled={request.pending}
              aria-busy={request.pending}
              onClick={(event) => {
                if (request.pending) {
                  event.preventDefault();
                  return;
                }
                request.refresh();
              }}
            >
              {request.pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {t('refreshDisplays')}
            </Button>
          </figcaption>
          <div className="display-preview-slot" aria-busy={request.pending}>
            {showImage ? (
              <img
                className="display-preview"
                key={snapshot!.sourceId}
                src={snapshot!.thumbnail!}
                alt={t('displayPreviewFor', {
                  display: snapshot!.label ?? snapshot!.sourceId ?? value,
                })}
                onError={() => setFailedImage(snapshot)}
              />
            ) : request.pending && !snapshot ? (
              <Skeleton className="size-full" />
            ) : (
              <span className="muted">{t('previewUnavailable')}</span>
            )}
          </div>
        </figure>
        {children}
      </div>
    </FieldGroup>
  );
}
