import { useId, useRef, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useI18n } from '../../hooks/useI18n';

export function rosterErrorLabel(error: string, t: ReturnType<typeof useI18n>['t']) {
  const status = /BATrace HTTP (\d{3})/.exec(error)?.[1];
  return status
    ? t(Number(status) >= 500 ? 'rosterServiceFailure' : 'rosterRequestFailure', { status })
    : /invalid (?:JSON|player analysis)/i.test(error)
      ? t('rosterInvalidResponse')
      : /No analysis|incomplete player analysis/i.test(error)
        ? t('rosterAnalysisUnavailable')
        : t('rosterFailureSummary');
}

export function RosterIdentity({
  id,
  name,
  team,
  status,
  error,
  analysis,
}: {
  id: string;
  name: string;
  team: string;
  status: string;
  error?: string;
  analysis?: ReactNode;
}) {
  const { t } = useI18n();
  const title = useId();
  const region = useRef<HTMLDivElement>(null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="roster-identity-trigger"
          aria-label={t('rosterIdentityAction', { name, id })}
        >
          <Info aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-labelledby={title}
        className="roster-identity-popover"
        align="start"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          region.current?.focus();
        }}
      >
        <PopoverHeader>
          <PopoverTitle id={title}>{t('profileIdentity')}</PopoverTitle>
        </PopoverHeader>
        <div
          ref={region}
          role="region"
          tabIndex={0}
          aria-label={t('profileIdentity')}
          className="roster-identity-reading"
        >
          <strong data-roster-full-name="">{name}</strong>
          <code>#{id}</code>
          <p>
            {t('team')}: {team}
          </p>
          {status && (!error || status !== t('rosterQueryFailed')) && <p>{status}</p>}
          {!error && analysis && <p data-roster-full-analysis="">{analysis}</p>}
          {error && (
            <>
              <p>{rosterErrorLabel(error, t)}</p>
              <p>{t('rosterQueryFailed')}</p>
              <p className="text-muted-foreground">{t('rosterTechnicalDetails')}</p>
              <pre>{error}</pre>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
